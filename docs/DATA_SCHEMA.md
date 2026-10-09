# Data, contracts, and rules

## Disclosure (state this plainly wherever this project is described)

No real Account Aggregator, Sahamati, or FIP integration exists anywhere in
this repo, and none is planned. Building on live AA rails requires the
operating company to already be regulated by RBI/SEBI/IRDAI/PFRDA;
Sahamati certification through an empanelled auditor typically takes
5-10 months and year-one costs run ₹5-25 lakhs+
([CASParser, State of Account Aggregator 2026](https://casparser.in/blog/state-of-account-aggregator-2026/)).
That is flatly out of reach for a hackathon team, not just difficult.

This project is instead built against **the real AA data model**: every
AA-registered FI type follows a consistent three-part
Profile/Summary/Transactions (or equivalent) schema
([Setu Docs, FI data types](https://docs.setu.co/data/account-aggregator/fi-data-types)),
and `GSTR1_3B` (GST returns) is one of the officially supported FI types
connected via GSTN. `data/synthetic/borrowers.py` generates
schema-accurate synthetic data for `DEPOSIT`, `GSTR1_3B`, `MUTUAL_FUNDS`,
and `INSURANCE_POLICIES` - seeded, representative data standing in for real
filings we cannot access.

## FI-schema shapes (synthetic)

**DEPOSIT** (bank):
```json
{
  "fi_type": "DEPOSIT",
  "profile": {"account_holder": "...", "account_number_masked": "XXXX1234", "bank": "..."},
  "summary": {"current_balance": 210000.0, "currency": "INR"},
  "transactions": [
    {"txn_id": "txn_881", "date": "2026-06-05", "amount": 163000.0, "type": "CREDIT", "narration": "..."}
  ]
}
```

**GSTR1_3B** (GST/tax):
```json
{
  "fi_type": "GSTR1_3B",
  "profile": {"gstin": "...", "legal_name": "..."},
  "summary": {"filing_frequency": "monthly"},
  "returns": [
    {"period": "2026-06", "declared_turnover": 178000.0, "filed_on_time": true}
  ]
}
```

**MUTUAL_FUNDS** / **INSURANCE_POLICIES**: see `data/synthetic/borrowers.py`
for the exact shape (`holdings` / `policies` lists plus a `summary` total).

## Real-document upload (`POST /borrowers/upload`)

The three planted demo borrowers and the five edge cases below are synthetic
(see the disclosure above). `POST /borrowers/upload` is the real-world path:
it accepts an actual bank statement, GST return, and (optionally) a mutual
fund statement / insurance policy - PDF, image, or spreadsheet (xlsx/xlsm/csv) - reads them live with
Gemini (`agents/extraction.py`), and maps the extracted fields into the
exact same FI-schema shape documented above. From that point on it is
indistinguishable from any other case: the same `fi_data/{borrower_id}`
Firestore document, the same three specialist agents, the same
`agents/rules.py` table, the same consent-decay math, the same orchestrator.

What the model is and is not allowed to do when reading an upload:
- It extracts fields that are actually printed on the document (dates,
  amounts, CREDIT/DEBIT, declared turnover, scheme/policy names, sums
  assured) and is told to leave a field empty rather than guess one that
  isn't legible.
- It never invents a `txn_id` or `policy_id` - most real statements don't
  print the kind of internal reference this system uses for ledger
  citations, so `agents/extraction.py` assigns a local key
  (`up_txn_001`, ...) after extraction. That key is a pointer this feature
  creates, not a fact claimed about the document.
- Bank statement + GST return are required (they drive the two core
  cross-checked signals, income-vs-revenue divergence and
  declared-vs-actual mismatch); mutual fund / insurance are optional and
  simply leave that source empty - the same deterministic "low" / "gap"
  classification a real borrower without those products would get.
- Consent for an upload is freshly granted for 90 days at upload time
  (`agents/extraction.py::build_consent_block`) - a real policy choice this
  feature makes, not a claim about any borrower.

An extraction failure (unreadable scan, wrong document type, a malformed
model response) returns one honest `422` naming which document failed,
never a fabricated result standing in for one.

## Sub-agent output contract

Every specialist returns structured claims, never prose. Sums, averages,
and trends are computed by a deterministic tool function first
(`agents/tools.py`), so the model can only cite a number, never invent one.

```json
{
  "agent": "bank_statement_agent",
  "borrower_id": "b_contradiction",
  "claims": [
    {
      "metric": "income_trend",
      "value": "stable",
      "magnitude_pct": 2.1,
      "evidence": [{"transaction_ids": ["txn_901", "txn_902"], "period": "2026-06 to 2026-09"}],
      "confidence": 0.86
    }
  ]
}
```

Full pydantic definition: `agents/schemas.py` (`AgentFindings`, `Claim`,
`Evidence`).

## Orchestrator: deterministic rules, then LLM

| Rule | Signals compared | Condition | Action |
|---|---|---|---|
| Income vs. revenue divergence | `bank.income_trend`, `gst.revenue_trend` | Bank stable/rising while GST declining | Flag contradiction, cap confidence at 0.5 |
| Declared vs. actual mismatch | `gst.declared_turnover`, `bank.total_credits` | Gap exceeds 15% | Flag contradiction, request manual review |
| Asset cushion vs. cash flow | `investment.liquid_assets`, `bank.cash_flow_volatility` | High volatility + high liquid assets claimed, no drawdown evidence | Flag contradiction |
| Insurance coverage gap | `investment.insurance_coverage`, loan amount requested | Coverage well below the requested loan size | Note as risk factor, not a hard contradiction |

Implementation: `agents/rules.py::evaluate_rules`. The rule table catches
what we already know matters; the orchestrator's inner LLM pass
(`orchestrator_subtler_reasoning` in `agents/orchestrator_agent.py`) is for
the subtler cases this table misses, and is explicitly told not to re-flag
anything the table already covers.

### Worked example (the demo's centerpiece, `b_contradiction`)

Bank shows **stable** income (**+2.1%**); GST shows **declining** revenue
(**-11.0%**) over the same period. `tests/test_tools.py` and
`tests/test_rules.py` assert this exact reproduction from the synthetic
data in `data/synthetic/borrowers.py::build_b_contradiction`.

## Consent-expiry confidence decay

Confidence holds at full strength until a source's consent is close to
expiring, then decays linearly, forcing re-consent before a stale source
can quietly carry a decision. For each source, with `d` = days remaining
until that source's consent expires:

```
c(d) = 1        if d > 7
     = d / 7     if 0 < d <= 7
     = 0         if d <= 0
```

The final confidence is the model's own confidence multiplied by the
**weakest** source's `c(d)` - one stale consent caps the whole decision, it
does not average out against fresher sources. Implementation:
`agents/consent.py`.

## Explainability ledger

An append-only Firestore collection (`ledger`), one document per pipeline
step, immutable once written.

```json
{
  "step_id": "stp_00042",
  "borrower_id": "b_contradiction",
  "agent": "orchestrator_agent",
  "timestamp": "2026-10-07T09:14:22Z",
  "action": "flag_contradiction",
  "input_refs": ["claims/b_contradiction/bank_findings", "claims/b_contradiction/gst_findings"],
  "claim": {
    "metric": "income_vs_revenue",
    "finding": "Bank shows stable income (+2.1%); GST shows declining revenue (-11%)",
    "evidence": [{"source": "bank_findings", "field": "income_trend"}, {"source": "gst_findings", "field": "revenue_trend"}]
  },
  "confidence": 0.5,
  "notes": "Contradiction rule: income vs. revenue divergence"
}
```

Steps 1-3 (each specialist sub-agent) get one ledger entry per claim,
written automatically as soon as that agent finishes
(`agents/ledger.py::record_agent_claims_callback`, wired as each agent's
`after_agent_callback`). Step 4 (orchestrator) writes one entry per
contradiction/risk factor plus one for the consent-decay application. Step
5 is the final decision entry. See `agents/config.py` for the Firestore
collection layout.

## Planted demo borrowers

Per the build brief: "plant these three deliberately, don't leave it to
random generation" (`data/synthetic/borrowers.py`):

1. **`b_clean`** - all three sources agree, healthy signals, consent fresh.
   Straightforward approve.
2. **`b_contradiction`** - bank stable (+2.1%), GST declining (-11%). The
   demo's centerpiece contradiction.
3. **`b_stale_consent`** - otherwise healthy, but the bank source's
   consent has 2 days left. Demonstrates confidence decay and the
   re-consent prompt.

Regenerate + self-verify locally with:
```bash
python -m data.synthetic.generate
```
Seed Firestore for a live demo with:
```bash
python -m infra.seed_firestore
```

## Definition of done for the golden path (Phase 2 gate, Oct 10)

Given `b_contradiction`'s id, a single `POST /borrowers/b_contradiction/evaluate`
call returns a final decision with a populated ledger that a judge can open
and see the exact bank transaction and GST period that disagree. Nothing
else - not UI polish, not the other two borrowers - matters more than this
one path working end to end.
