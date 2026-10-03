"""The orchestrator/synthesizer agent.

"Orchestrator: deterministic rules first, LLM reasoning second." This is a
custom ADK agent (a BaseAgent, not a plain LlmAgent) because it is a hybrid:

  1. Run the fixed rule table (agents/rules.py) against the three specialist
     sub-agents' findings - the contradictions we already know matter, kept
     fully auditable and outside model judgement.
  2. Delegate to a wrapped inner LlmAgent for a subtler-reasoning pass over
     the same three findings, for the cases the rule table misses.
  3. Apply the consent-expiry confidence decay (agents/consent.py).
  4. Decide the outcome and write the explainability ledger + final
     decision to Firestore.

It runs as the second sub-agent of the top-level SequentialAgent in
pipeline.py, after the ParallelAgent group of the three specialists, per the
brief's `[Parallel Workers] -> [Synthesizer Agent]` pattern.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import AsyncGenerator

from google.adk.agents import LlmAgent
from google.adk.agents.base_agent import BaseAgent
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.genai import types

from agents import config, tools
from agents.consent import apply_decay, build_consent_status
from agents.firestore_gateway import get_consent, get_fi_data, set_decision
from agents.ledger import parse_findings_payload, write_entry
from agents.rules import evaluate_rules
from agents.schemas import AgentFindings, Decision

SUBTLER_REASONING_INSTRUCTION = """You are the orchestrator's second-pass reasoning step in a
credit-underwriting pipeline. A fixed rule table has already checked these
four things and you must NOT re-flag them: (1) bank income vs. GST revenue
divergence, (2) declared GST turnover vs. actual bank credits, (3) claimed
liquid-asset cushion vs. cash-flow volatility, (4) insurance coverage vs.
loan size.

Given these three specialist findings for one borrower:

Bank statement agent findings: {bank_findings}
GST/tax agent findings: {gst_findings}
Mutual fund/insurance agent findings: {investment_findings}

Look for any OTHER contradiction between sources that the four rules above
would not catch - for example a filing-consistency issue that reads oddly
against the bank's cash-flow pattern. Respond with ONLY a JSON object:
{{"additional_findings": [{{"metric": "<name>", "finding": "<one sentence, citing the specific evidence>", "sources": ["bank_findings"|"gst_findings"|"investment_findings", ...]}}]}}
If you find nothing beyond the four rules, respond with {{"additional_findings": []}}.
Do not invent a number that is not present in the findings above."""


def build_subtler_reasoning_agent() -> LlmAgent:
    return LlmAgent(
        name="orchestrator_subtler_reasoning",
        model=config.build_orchestrator_model(),
        description="Second-pass LLM reasoning for cross-source contradictions the fixed rule table misses.",
        instruction=SUBTLER_REASONING_INSTRUCTION,
        output_key="orchestrator_subtler_findings",
    )


class OrchestratorAgent(BaseAgent):
    """Deterministic contradiction rules + a subtler-reasoning LLM pass +
    consent decay, writing the explainability ledger and final decision."""

    subtler_reasoning_agent: LlmAgent

    def __init__(self, **data):
        data.setdefault("name", "orchestrator_agent")
        data.setdefault(
            "description",
            "Cross-checks specialist findings for contradictions and produces the final decision.",
        )
        subtler = data.get("subtler_reasoning_agent") or build_subtler_reasoning_agent()
        data["subtler_reasoning_agent"] = subtler
        data.setdefault("sub_agents", [subtler])
        super().__init__(**data)

    async def _run_async_impl(self, ctx) -> AsyncGenerator[Event, None]:
        borrower_id = ctx.session.state["borrower_id"]

        # bank/gst agents have output_schema set so ADK hands back a validated
        # dict; investment_agent doesn't (see its build function - output_schema
        # + AFC never converged live for that one), so its state value is a raw
        # JSON string. parse_findings_payload handles both uniformly.
        bank_findings = AgentFindings.model_validate(parse_findings_payload(ctx.session.state["bank_findings"]))
        gst_findings = AgentFindings.model_validate(parse_findings_payload(ctx.session.state["gst_findings"]))
        investment_findings = AgentFindings.model_validate(
            parse_findings_payload(ctx.session.state["investment_findings"])
        )

        fi_data = get_fi_data(borrower_id)
        loan_amount_requested = fi_data["loan_amount_requested"]
        gap = tools.compute_declared_vs_actual_gap(
            fi_data["sources"]["GSTR1_3B"]["returns"], fi_data["sources"]["DEPOSIT"]["transactions"]
        )

        # Step 1: deterministic rules, fully auditable, no model judgement.
        contradictions, risk_factors = evaluate_rules(
            bank_findings, gst_findings, investment_findings, gap, loan_amount_requested
        )

        for c in contradictions:
            write_entry(
                borrower_id=borrower_id,
                agent="orchestrator_agent",
                action="flag_contradiction",
                input_refs=[f"claims/{borrower_id}/{e.source}" for e in c.evidence if e.source],
                claim=c.model_dump(),
                confidence=0.5,
                notes=f"Contradiction rule: {c.rule}",
            )
        for r in risk_factors:
            write_entry(
                borrower_id=borrower_id,
                agent="orchestrator_agent",
                action="note_risk_factor",
                input_refs=[f"claims/{borrower_id}/{e.source}" for e in r.evidence if e.source],
                claim=r.model_dump(),
                confidence=0.7,
                notes=f"Risk factor rule: {r.rule}",
            )

        # Step 2: subtler-reasoning LLM pass, delegated to the inner agent.
        async for event in self.subtler_reasoning_agent.run_async(ctx):
            yield event

        subtler = ctx.session.state.get("orchestrator_subtler_findings") or {}
        additional_findings = subtler.get("additional_findings", []) if isinstance(subtler, dict) else []
        for finding in additional_findings:
            write_entry(
                borrower_id=borrower_id,
                agent="orchestrator_agent",
                action="flag_subtler_contradiction",
                input_refs=[f"claims/{borrower_id}/{s}" for s in finding.get("sources", [])],
                claim=finding,
                confidence=0.6,
                notes="Found by orchestrator's subtler-reasoning pass (not the fixed rule table)",
            )

        # Step 3: consent-expiry confidence decay - one stale source caps
        # the whole decision, it does not get averaged away.
        consent_data = get_consent(borrower_id)
        consent_statuses = [
            build_consent_status(source, meta["fi_type"], meta["expires_at"])
            for source, meta in consent_data.items()
        ]
        all_claim_confidences = [
            c.confidence for f in (bank_findings, gst_findings, investment_findings) for c in f.claims
        ]
        model_confidence = min(all_claim_confidences) if all_claim_confidences else 0.5
        if contradictions:
            model_confidence = min(model_confidence, 0.5)  # hard-contradiction cap from the rule table

        final_confidence, weakest = apply_decay(model_confidence, consent_statuses)

        write_entry(
            borrower_id=borrower_id,
            agent="orchestrator_agent",
            action="apply_consent_decay",
            input_refs=[f"consent/{borrower_id}"],
            claim={
                "model_confidence": model_confidence,
                "weakest_source": weakest.source if weakest else None,
                "weakest_days_remaining": weakest.days_remaining if weakest else None,
                "confidence_multiplier": weakest.confidence_multiplier if weakest else 1.0,
                "final_confidence": final_confidence,
            },
            confidence=final_confidence,
            notes="c(d) = 1 if d>7, d/7 if 0<d<=7, 0 if d<=0; final = model_confidence * weakest source's c(d)",
        )

        # Step 4: decide the outcome.
        hard_manual_review = any(c.action == "request_manual_review" for c in contradictions)
        if final_confidence <= 0.0:
            outcome = "decline"
        elif hard_manual_review or contradictions or final_confidence < 0.6:
            outcome = "manual_review"
        else:
            outcome = "approve"

        decision = Decision(
            borrower_id=borrower_id,
            outcome=outcome,
            final_confidence=final_confidence,
            model_confidence=model_confidence,
            weakest_consent_source=weakest.source if weakest else None,
            contradictions=contradictions,
            risk_factors=risk_factors,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

        final_entry = write_entry(
            borrower_id=borrower_id,
            agent="orchestrator_agent",
            action="final_decision",
            input_refs=[f"claims/{borrower_id}/bank_findings", f"claims/{borrower_id}/gst_findings", f"claims/{borrower_id}/investment_findings"],
            claim=decision.model_dump(),
            confidence=final_confidence,
            notes=f"outcome={outcome}",
        )
        decision.ledger_step_ids = [final_entry.step_id]
        set_decision(borrower_id, decision.model_dump())

        summary = (
            f"Decision for {borrower_id}: {outcome} "
            f"(final_confidence={final_confidence}, contradictions={len(contradictions)})"
        )
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            branch=ctx.branch,
            content=types.Content(role="model", parts=[types.Part.from_text(text=summary)]),
            actions=EventActions(state_delta={"decision": decision.model_dump()}),
        )
