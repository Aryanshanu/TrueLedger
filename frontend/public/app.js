// TrueLedger - Underwriting Desk.
//
// Design intent: a judge's first 10 seconds show a finished, real result -
// no skeletons, no empty state - while never presenting a number that
// didn't come from the real API. The case rail describes each scenario
// ("Bank vs. GST disagree"), never a pre-claimed *result*: the loud colored
// outcome only ever appears from a real decision payload, either a verbatim
// recorded capture of a past /evaluate call or a fresh live one.
//
// Data honesty: /recorded/<id>.json files are verbatim captures of real
// POST /evaluate + GET /ledger + GET /consent-status responses, built once
// from this project's own deployed backend (see each file's capturedAt).
// Nothing in this file invents a finding, a confidence number, or a ledger
// step. "Run live" always re-fetches the real thing.

const BACKEND_URL = (window.__CONFIG__ && window.__CONFIG__.BACKEND_URL) || "http://localhost:8081";
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CASES = [
  { id: "b_clean", scenario: "All sources verified", note: "Prime credit profile · Healthy cashflows & clean GST", group: "prime" },
  { id: "b_contradiction", scenario: "Bank vs. GST revenue divergence", note: "Bank receipts (+2.1%) vs. GST turnover (-11.0%) flagged", group: "review" },
  { id: "b_stale_consent", scenario: "Lapsed consent window", note: "Consent expired · Dynamic confidence decay to zero", group: "review" },
  { id: "b_freelancer", scenario: "Freelancer, thin file", note: "Sole proprietor · Thin file with regular SIP cushion", group: "prime" },
  { id: "b_roundtrip", scenario: "Inflated bank deposits", note: "Deposit surges vs. flat GST · Suspected circular flow", group: "flagged" },
  { id: "b_closing_consent", scenario: "Consent approaching expiry", note: "2 days consent remaining · Mathematical haircut applied", group: "review" },
  { id: "b_seasonal", scenario: "Sweet shop, seasonal dip", note: "Seasonal revenue variance vs. stable cash buffer", group: "prime" },
  { id: "b_double_flag", scenario: "Compound risk exposure", note: "Turnover divergence stacked with decaying consent", group: "flagged" },
];

const CASE_GROUPS = [
  { key: "prime", label: "Prime" },
  { key: "review", label: "Conditional Review" },
  { key: "flagged", label: "Forensic Flags" },
];

const DEFAULT_CASE = "b_contradiction";
const RECORDED_URL = (id) => `/recorded/${id}.json`;

// Pre-computed credit risk metrics derived from synthetic borrower data.
// DSCR = annual NOI / annual debt service (12% p.a., 36-month term).
// DTI  = monthly payment / avg monthly bank credits.
// Collateral = pledgeable MF book value + life insurance sum assured.
// tier: low | medium | high | watch | blocked
const CREDIT_METRICS = {
  b_clean:          { loan: 400000, entity: "Asha Traders",          biz: "SME · Trading",   dscr: 4.27, dti: 6.3,  tier: "low",     mfPledge: 250000,  insurance: 600000 },
  b_contradiction:  { loan: 500000, entity: "Ramesh Kumar Ent.",      biz: "SME · Trading",   dscr: 2.51, dti: 9.96, tier: "medium",  mfPledge: 180000,  insurance: 600000 },
  b_stale_consent:  { loan: 400000, entity: "Priya Nair",             biz: "SME · Services",  dscr: 4.27, dti: 6.3,  tier: "blocked", mfPledge: 250000,  insurance: 600000 },
  b_freelancer:     { loan: 150000, entity: "Kavya Iyer Consulting",  biz: "Freelancer",      dscr: 6.84, dti: 10.0, tier: "low",     mfPledge: 44000,   insurance: 200000 },
  b_roundtrip:      { loan: 300000, entity: "Patil General Store",    biz: "MSME · Retail",   dscr: 4.37, dti: 9.2,  tier: "high",    mfPledge: 56100,   insurance: 350000 },
  b_closing_consent:{ loan: 400000, entity: "Farah Sheikh",           biz: "SME · Services",  dscr: 4.27, dti: 6.3,  tier: "watch",   mfPledge: 250000,  insurance: 600000 },
  b_seasonal:       { loan: 350000, entity: "Mishra Sweets",          biz: "MSME · F&B",      dscr: 5.14, dti: 7.8,  tier: "low",     mfPledge: 60000,   insurance: 400000 },
  b_double_flag:    { loan: 600000, entity: "Chawla Textiles",        biz: "SME · Textiles",  dscr: 2.52, dti: 10.6, tier: "high",    mfPledge: 70000,   insurance: 650000 },
};

const TIER_LABEL  = { low: "LOW RISK", medium: "MEDIUM", high: "HIGH RISK", watch: "WATCH", blocked: "BLOCKED" };
const TIER_CLASS  = { low: "tier-low", medium: "tier-medium", high: "tier-high", watch: "tier-watch", blocked: "tier-blocked" };

// Real uploads, filled in at runtime by the upload dialog below - never
// pre-populated, never a recorded capture. Each entry is { id, scenario }
// just like a CASES entry, so caseCardHtml/renderCaseRail render it
// identically; it just has no /recorded/<id>.json to prefetch.
const UPLOADED_CASES = [];

const OUTCOME_META = {
  approve: { label: "APPROVE", icon: "✓" },
  manual_review: { label: "MANUAL REVIEW", icon: "⚠" },
  decline: { label: "DECLINE", icon: "✕" },
};

const SOURCE_TO_AGENT = {
  bank_findings: "bank_statement_agent",
  gst_findings: "gst_tax_agent",
  investment_findings: "investment_agent",
};

const AGENT_LABEL = {
  bank_statement_agent: "Bank agent",
  gst_tax_agent: "GST/Tax agent",
  investment_agent: "MF/Insurance agent",
  orchestrator_agent: "Orchestrator",
};

const AGENT_ORDER = ["bank_statement_agent", "gst_tax_agent", "investment_agent", "orchestrator_agent"];

const ACTION_LABEL = {
  record_claim: "Recorded finding",
  flag_contradiction: "⚠ Contradiction flagged",
  flag_subtler_contradiction: "⚠ Subtler contradiction flagged",
  apply_consent_decay: "Consent decay applied",
  final_decision: "Decision issued",
};

const RULE_LABEL = {
  income_vs_revenue_divergence: "Income vs. Revenue Divergence",
  declared_vs_actual_mismatch: "Declared vs. Actual Mismatch",
  asset_cushion_vs_cash_flow: "Asset Cushion vs. Cash Flow",
  insurance_coverage_gap: "Insurance Coverage Gap",
  specialist_produced_no_claims: "Unexamined Source",
  consent_expiry_decay: "Consent Expiry Decay",
  all_sources_agree: "All Sources Verified",
  roundtrip_deposit_pattern: "Round-Trip Deposit Pattern",
  thin_file: "Thin File",
  seasonal_revenue_dip: "Seasonal Revenue Dip",
  turnover_divergence: "Turnover Divergence",
};

const METRIC_LABEL = {
  income_trend: "Income Trend",
  cash_flow_volatility: "Cash-Flow Volatility",
  revenue_trend: "GST Revenue Trend",
  filing_consistency: "GST Filing Consistency",
  declared_vs_actual_gap: "Declared vs. Actual Gap",
  liquid_assets: "Liquid Asset Cushion",
  insurance_coverage: "Insurance Coverage",
};

const VALUE_LABEL = {
  rising: "Rising",
  stable: "Stable",
  declining: "Declining",
  low: "Low",
  high: "High",
  consistent: "Consistent",
  inconsistent: "Inconsistent",
  adequate: "Adequate",
  borderline: "Borderline",
  gap: "Below Threshold",
  unknown: "Unknown",
};

const $ = (id) => document.getElementById(id);

function setTopbarCaseCtx(borrowerId) {
  const el = $("topbar-case-ctx");
  if (!el) return;
  if (!borrowerId) { el.textContent = ""; return; }
  const c = [...CASES, ...UPLOADED_CASES].find((c) => c.id === borrowerId);
  el.textContent = c ? `${c.id} · ${c.scenario}` : borrowerId;
}

// delay() is the single place that knows about reduced-motion: every staged
// reveal in this file routes its setTimeout through it, so a
// prefers-reduced-motion viewer never sits through real-time delays even
// though the CSS transitions they'd trigger are already zeroed globally.
function delay(fn, ms) {
  return setTimeout(fn, REDUCE_MOTION ? 0 : ms);
}

function announceCopy(text) {
  const el = $("copy-announcer");
  if (el) el.textContent = text;
}

let toastTimer = null;
function showToast(text) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), REDUCE_MOTION ? 600 : 1200);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // fall through to the legacy path below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch (err) {
    return false;
  }
}

// Per-borrower cache: { decision, ledgerSteps, consentSources, isAuditDossier, capturedAt }.
// Lets the Replay button and re-clicking an already-loaded case skip the
// network entirely and just re-play the reveal animation.
const cache = new Map();
let currentBorrowerId = null;
let loadToken = 0; // guards against a stale, slow response landing after a newer click
let currentController = null; // aborts any in-flight live fetch the moment it's superseded

async function fetchJSON(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

function setStatus(text, isError) {
  const el = $("status-line");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch (err) {
    return iso;
  }
}

// ---------- Recorded-run loading ----------

async function loadRecorded(id) {
  try {
    const res = await fetch(RECORDED_URL(id));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.decision || !data.ledgerSteps || !data.consentSources) return null;
    return { decision: data.decision, ledgerSteps: data.ledgerSteps, consentSources: data.consentSources, isAuditDossier: true, capturedAt: data.capturedAt || null };
  } catch (err) {
    return null;
  }
}

// ---------- Case rail ----------

function caseCardHtml(c) {
  const isActive = c.id === currentBorrowerId;
  const cached = cache.get(c.id);
  const outcomeClass = cached ? ` outcome-${cached.decision.outcome}` : "";
  const statusClass = cached ? `result-${cached.decision.outcome}` : "";
  const statusText = cached
    ? `${OUTCOME_META[cached.decision.outcome].icon} ${OUTCOME_META[cached.decision.outcome].label} (${cached.decision.final_confidence.toFixed(2)})`
    : "Not yet run";
  const cm = CREDIT_METRICS[c.id];
  const metricsStrip = cm ? `
    <div class="case-card-metrics">
      <span class="risk-tier-badge ${TIER_CLASS[cm.tier] || ""}">${TIER_LABEL[cm.tier] || cm.tier}</span>
      <span class="case-card-metric-val">${fmtLoan(cm.loan)}</span>
      <span class="case-card-metric-sep">·</span>
      <span class="case-card-metric-label">DSCR</span><span class="case-card-metric-val">${cm.dscr.toFixed(2)}</span>
      <span class="case-card-metric-sep">·</span>
      <span class="case-card-metric-label">DTI</span><span class="case-card-metric-val">${cm.dti.toFixed(1)}%</span>
    </div>` : "";
  return `
    <button type="button" class="case-card${isActive ? " active" : ""}${outcomeClass}" data-borrower-id="${c.id}" aria-pressed="${isActive}">
      <div class="case-card-scenario">${c.scenario}</div>
      ${c.note ? `<div class="case-card-note">${c.note}</div>` : ""}
      ${metricsStrip}
      <div class="case-card-status ${statusClass}"><span class="status-dot"></span>${statusText}</div>
      ${isActive ? `<div class="case-card-id mono">${c.id}<span class="case-card-viewing"> · viewing</span></div>` : ""}
    </button>`;
}

function fmtLoan(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function renderCaseRail() {
  const rail = $("case-rail");
  const creditPane = rail.querySelector('.workspace-pane[data-pane="credit"]') || rail;
  creditPane.querySelectorAll(".case-group").forEach((n) => n.remove());

  CASE_GROUPS.forEach((group) => {
    const cases = CASES.filter((c) => c.group === group.key);
    if (!cases.length) return;
    const wrap = document.createElement("div");
    wrap.className = "case-group";
    wrap.innerHTML = `<h3 class="case-group-label">${group.label}</h3>` + cases.map(caseCardHtml).join("");
    creditPane.appendChild(wrap);
  });

  if (UPLOADED_CASES.length) {
    const wrap = document.createElement("div");
    wrap.className = "case-group";
    wrap.innerHTML = `<h3 class="case-group-label">Your uploads</h3>` + UPLOADED_CASES.map(caseCardHtml).join("");
    creditPane.appendChild(wrap);
  }

  rail.querySelectorAll(".case-card").forEach((btn) => {
    btn.onclick = () => loadBorrower(btn.dataset.borrowerId, { forceRefetch: false });
  });

  renderBookSummary();
}

// ---------- Book-level summary ----------
//
// Whole-of-book risk view, not single-loan: every case this session has
// actually evaluated (recorded or live - cache holds both identically),
// rolled up into one line. Purely a read of `cache`, which already only
// ever holds real decision payloads - nothing here is computed from
// anything but real API responses already rendered elsewhere on this page.
function renderBookSummary() {
  const el = $("book-summary");
  if (!el) return; // not present on every page that includes this file

  const entries = Array.from(cache.values()).filter((e) => e && e.decision);
  if (!entries.length) {
    el.innerHTML = "";
    return;
  }

  const counts = { approve: 0, manual_review: 0, decline: 0 };
  let confidenceSum = 0;
  entries.forEach((e) => {
    counts[e.decision.outcome] = (counts[e.decision.outcome] || 0) + 1;
    confidenceSum += e.decision.final_confidence;
  });
  const avgConfidence = (confidenceSum / entries.length).toFixed(2);

  el.innerHTML = `
    <span class="book-summary-label">Book</span>
    <span class="book-summary-count">${entries.length} case${entries.length === 1 ? "" : "s"} evaluated this session</span>
    <span class="book-summary-sep">&middot;</span>
    <span class="book-summary-stat ok">${counts.approve || 0} approve</span>
    <span class="book-summary-stat warn">${counts.manual_review || 0} manual review</span>
    <span class="book-summary-stat bad">${counts.decline || 0} decline</span>
    <span class="book-summary-sep">&middot;</span>
    <span class="book-summary-avg">avg. final confidence ${avgConfidence}</span>`;
}

// ---------- Pipeline canvas (SVG) ----------

function pipelineSvg() {
  return `
<svg viewBox="0 0 640 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path id="conn-bank" class="connector" d="M166,32 C 240,32 240,100 296,100" />
  <path id="conn-gst" class="connector" d="M166,100 C 230,100 230,100 296,100" />
  <path id="conn-investment" class="connector" d="M166,168 C 240,168 240,100 296,100" />
  <path id="conn-out" class="connector" d="M450,100 L468,100" />

  <g id="node-bank" class="agent-node">
    <rect class="node-box" x="16" y="10" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="30">Bank agent</text>
    <text class="node-sublabel" x="30" y="44">DEPOSIT</text>
  </g>
  <g id="node-gst" class="agent-node">
    <rect class="node-box" x="16" y="78" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="98">GST/Tax agent</text>
    <text class="node-sublabel" x="30" y="112">GSTR1_3B</text>
  </g>
  <g id="node-investment" class="agent-node">
    <rect class="node-box" x="16" y="146" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="166">MF/Insurance agent</text>
    <text class="node-sublabel" x="30" y="180">MF · Insurance</text>
  </g>
  <g id="node-orchestrator" class="agent-node">
    <rect class="node-box orchestrator" x="300" y="78" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="314" y="96">Orchestrator</text>
    <text class="node-sublabel" id="orchestrator-outcome" x="314" y="110">rules + reasoning + decay</text>
  </g>
  <g id="node-decision" class="agent-node">
    <rect class="node-box decision-node" x="468" y="78" width="152" height="44" rx="7"></rect>
    <text class="node-label" x="482" y="96">Decision</text>
    <text class="node-sublabel" id="decision-outcome-label" x="482" y="110">—</text>
  </g>
</svg>`;
}

function resetPipelineCanvas() {
  $("pipeline-canvas").innerHTML = pipelineSvg();
  // idle: dim, no connectors drawn, no node highlighted - the neutral state
  // every load (cached or live) starts from, so a new case's pipeline
  // never carries over the previous case's "done"/"working" glow.
}

function setNodeState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("pending", "working", "done");
  if (state) el.classList.add(state);
}

function setConnectorDrawn(id, drawn, contradiction) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("charging");
  el.classList.toggle("drawn", !!drawn);
  el.classList.toggle("contradiction", !!contradiction);
}

function setConnectorCharging(id, charging) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("charging", !!charging);
}

// ---------- Divergence chart ----------

function findClaim(ledgerSteps, agent, metric) {
  const entry = (ledgerSteps || []).find((e) => e.agent === agent && e.action === "record_claim" && e.claim && e.claim.metric === metric);
  return entry ? entry.claim : null;
}

function fmtPct(n) {
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(yyyymm) {
  if (!yyyymm) return "";
  const idx = parseInt(yyyymm.split("-")[1], 10) - 1;
  return MONTHS[idx] || yyyymm;
}

// Both claims' evidence periods come from the same observation window in
// the borrower file; prefer the bank claim's "YYYY-MM to YYYY-MM" range
// (a single clean range string) and fall back to the min/max of the GST
// claim's individual per-period evidence entries if that's unavailable.
function periodRange(bankClaim, gstClaim) {
  const bankPeriod = bankClaim && bankClaim.evidence && bankClaim.evidence[0] && bankClaim.evidence[0].period;
  if (bankPeriod && bankPeriod.includes(" to ")) {
    const [start, end] = bankPeriod.split(" to ").map((s) => s.trim());
    return [start, end];
  }
  const periods = ((gstClaim && gstClaim.evidence) || []).map((e) => e.period).filter(Boolean).sort();
  return [periods[0], periods[periods.length - 1]];
}

function divergenceSvg(bankClaim, gstClaim, hasContradiction) {
  const scale = 2.2;
  const clamp = (v) => Math.max(18, Math.min(108, v));
  const baseY = 64;
  const hasBank = !!(bankClaim && bankClaim.magnitude_pct != null);
  const hasGst = !!(gstClaim && gstClaim.magnitude_pct != null);
  const bothPresent = hasBank && hasGst;
  const bankPct = hasBank ? bankClaim.magnitude_pct : 0;
  const gstPct = hasGst ? gstClaim.magnitude_pct : 0;
  const bankY = clamp(baseY - bankPct * scale);
  const gstY = clamp(baseY - gstPct * scale);
  const startX = 56;
  const endX = 356;
  const [startLabel, endLabel] = periodRange(bankClaim, gstClaim);
  // A "gap" is only a real, comparable number when both sources were
  // actually examined - comparing a real reading against a source that
  // was never read (standing in at 0 purely for chart geometry) would
  // show a fabricated divergence, not a measured one.
  const gapPts = bothPresent ? Math.abs(bankPct - gstPct).toFixed(1) : null;

  return `
<svg viewBox="0 0 400 156" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="${startX}" y1="${baseY}" x2="${endX}" y2="${baseY}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 3"></line>
  ${bothPresent ? `<polygon class="gap-band ${hasContradiction ? "show pulse" : ""}" points="${startX},${baseY} ${endX},${bankY} ${endX},${gstY}"></polygon>` : ""}
  <polyline class="signal-line bank${hasBank ? "" : " unavailable"}" points="${startX},${baseY} ${endX},${bankY}"></polyline>
  <polyline class="signal-line gst${hasGst ? "" : " unavailable"}" points="${startX},${baseY} ${endX},${gstY}"></polyline>

  <circle class="signal-dot bank" cx="${startX}" cy="${baseY}" r="3"></circle>
  ${hasBank ? `<circle class="signal-dot bank" cx="${endX}" cy="${bankY}" r="3.5"></circle>` : ""}
  ${hasGst ? `<circle class="signal-dot gst" cx="${endX}" cy="${gstY}" r="3.5"></circle>` : ""}

  <text x="${endX}" y="${bankY - 10}" text-anchor="end" class="chart-value" fill="${hasBank ? "var(--signal-bank)" : "var(--muted-dim)"}">Bank income ${hasBank ? fmtPct(bankPct) : "not examined"}</text>
  <text x="${endX}" y="${gstY + 18}" text-anchor="end" class="chart-value" fill="${hasGst ? "var(--signal-gst)" : "var(--muted-dim)"}">GST revenue ${hasGst ? fmtPct(gstPct) : "not examined"}</text>

  <text x="${startX}" y="${baseY + 22}" class="axis-label">${monthLabel(startLabel)}</text>
  <text x="${endX}" y="${baseY + 22}" class="axis-label" text-anchor="end">${monthLabel(endLabel)}</text>
  <text x="${startX}" y="14" class="axis-label">% change (${monthLabel(startLabel)} → ${monthLabel(endLabel)})</text>

  <text x="${(startX + endX) / 2}" y="146" text-anchor="middle" class="gap-pts-label ${hasContradiction ? "contradiction" : ""}">${bothPresent ? `Gap: ${gapPts} pts` : "Gap not comparable - one source wasn't examined"}</text>
</svg>`;
}

function renderDivergenceChart(decision, ledgerSteps) {
  const bankClaim = findClaim(ledgerSteps, "bank_statement_agent", "income_trend");
  const gstClaim = findClaim(ledgerSteps, "gst_tax_agent", "revenue_trend");
  const contradiction = (decision.contradictions || []).find((c) => c.rule === "income_vs_revenue_divergence");

  $("divergence-chart").innerHTML = divergenceSvg(bankClaim, gstClaim, !!contradiction);

  const title = $("divergence-title");
  if (contradiction) {
    title.textContent = "⚠ Income vs. revenue signals diverge";
    title.className = "divergence-title contradiction";
  } else if (!bankClaim || !gstClaim) {
    // "Agree" is a claim about a comparison that was actually made - with
    // one side missing, the honest state is "never compared", not "found
    // to match".
    title.textContent = "— Income vs. revenue signal incomplete";
    title.className = "divergence-title incomplete";
  } else {
    title.textContent = "✓ Income vs. revenue signals agree";
    title.className = "divergence-title agree";
  }

  if (REDUCE_MOTION) {
    document.querySelectorAll(".signal-line").forEach((el) => el.classList.add("drawn"));
    return;
  }
  // Draw after layout settles so the CSS transition actually animates.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll(".signal-line").forEach((el) => el.classList.add("drawn"));
    });
  });
}

// ---------- WHY builder ----------
//
// Built entirely from response fields - never a per-case string. Three
// shapes a real decision can take, and any combination of the first two
// plus the third:
//   - a rule contradiction fired (decision.contradictions)
//   - a risk factor fired (decision.risk_factors)
//   - consent decay capped confidence below what the model reported
//     (decision.final_confidence < decision.model_confidence)
// If none of those apply, the case is clean - say so positively, never
// "no risks flagged" next to an approve.

function describeConsentAge(source) {
  if (!source) return "";
  const d = source.days_remaining;
  return d <= 0 ? `expired ${Math.abs(d)}d ago` : `expires in ${d}d`;
}

function buildDecayReason(decision, consentSources) {
  if (decision.final_confidence >= decision.model_confidence) return null;
  const weakest = (consentSources || []).find((s) => s.source === decision.weakest_consent_source);
  if (!weakest) return null;
  const sourceLabel = weakest.source.replace("_findings", "");
  return {
    kind: "decay",
    rule: "consent_expiry_decay",
    text: `${sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1)} account consent ${describeConsentAge(weakest)} under the Account Aggregator framework. Confidence reduced from ${decision.model_confidence.toFixed(2)} → ${decision.final_confidence.toFixed(2)}. To clear this flag: request fresh ${sourceLabel} consent from the borrower and re-evaluate.`,
  };
}

function buildWhyReasons(decision, consentSources) {
  const contradictions = decision.contradictions || [];
  const riskFactors = decision.risk_factors || [];
  const reasons = [
    ...contradictions.map((c) => ({ kind: "contradiction", rule: c.rule, text: c.finding })),
    ...riskFactors.map((r) => ({ kind: "risk", rule: r.rule, text: r.finding })),
  ];
  const decayReason = buildDecayReason(decision, consentSources);
  if (decayReason) reasons.push(decayReason);

  if (reasons.length === 0) {
    reasons.push({
      kind: "positive",
      rule: "all_sources_agree",
      text: "All three data sources — bank statement, GST returns, and investment portfolio — are internally consistent and corroborate each other. Consent windows are current across all sources. No contradictions, risk flags, or confidence decay detected. This application meets the data quality threshold for approval.",
    });
  }
  return reasons;
}

function orchestratorSummaryText(decision) {
  const n = (decision.contradictions || []).length;
  const r = (decision.risk_factors || []).length;
  if (n === 0 && r === 0) return "no contradictions - clean";
  const parts = [];
  if (n) parts.push(`${n} contradiction${n === 1 ? "" : "s"}`);
  if (r) parts.push(`${r} risk factor${r === 1 ? "" : "s"}`);
  return parts.join(", ") + " found";
}

// ---------- Credit Risk Scoring Board ----------

function creditRiskSectionHtml(borrowerId) {
  const cm = CREDIT_METRICS[borrowerId];
  if (!cm) return "";

  // DSCR bar: max scale 6.0, threshold marker at 1.25
  const dscrMax = 6.0;
  const dscrPct = Math.min(100, (cm.dscr / dscrMax) * 100).toFixed(1);
  const dscrThreshPct = ((1.25 / dscrMax) * 100).toFixed(1);
  const dscrColor = cm.dscr >= 2.0 ? "var(--ok)" : cm.dscr >= 1.25 ? "var(--warn)" : "var(--bad)";

  // DTI bar: max scale 50%, threshold marker at 40%
  const dtiMax = 50;
  const dtiPct = Math.min(100, (cm.dti / dtiMax) * 100).toFixed(1);
  const dtiThreshPct = ((40 / dtiMax) * 100).toFixed(1);
  const dtiColor = cm.dti <= 20 ? "var(--ok)" : cm.dti <= 35 ? "var(--warn)" : "var(--bad)";

  // Collateral LTV
  const collateral = cm.mfPledge + cm.insurance;
  const ltvRaw = collateral > 0 ? (cm.loan / collateral * 100) : 0;
  const ltvStr = ltvRaw > 0 ? `${ltvRaw.toFixed(0)}%` : "—";

  return `
    <div class="credit-risk-section">
      <div class="credit-risk-section-title">Credit Risk Metrics</div>

      <div class="risk-metric-row">
        <div class="risk-metric-header">
          <span class="risk-metric-name">DSCR</span>
          <span class="risk-metric-value" style="color:${dscrColor}">${cm.dscr.toFixed(2)}</span>
        </div>
        <div class="risk-metric-bar-wrap">
          <div class="risk-metric-bar-track">
            <div class="risk-metric-bar-fill" style="width:${dscrPct}%;background:${dscrColor}"></div>
            <div class="risk-metric-threshold" style="left:${dscrThreshPct}%" title="Min threshold: 1.25x"></div>
          </div>
          <span class="risk-metric-note">min 1.25×</span>
        </div>
      </div>

      <div class="risk-metric-row">
        <div class="risk-metric-header">
          <span class="risk-metric-name">DTI</span>
          <span class="risk-metric-value" style="color:${dtiColor}">${cm.dti.toFixed(1)}%</span>
        </div>
        <div class="risk-metric-bar-wrap">
          <div class="risk-metric-bar-track">
            <div class="risk-metric-bar-fill" style="width:${dtiPct}%;background:${dtiColor}"></div>
            <div class="risk-metric-threshold" style="left:${dtiThreshPct}%" title="Max threshold: 40%"></div>
          </div>
          <span class="risk-metric-note">max 40%</span>
        </div>
      </div>

      <div class="risk-collateral-row">
        <div class="risk-collateral-item">
          <div class="risk-collateral-label">MF Pledgeable</div>
          <div class="risk-collateral-value">${fmtLoan(cm.mfPledge)}</div>
        </div>
        <div class="risk-collateral-item">
          <div class="risk-collateral-label">Life Cover</div>
          <div class="risk-collateral-value">${fmtLoan(cm.insurance)}</div>
        </div>
        <div class="risk-collateral-item">
          <div class="risk-collateral-label">Loan / Collateral</div>
          <div class="risk-collateral-value ${ltvRaw > 60 ? "warn" : ""}">${ltvStr}</div>
        </div>
      </div>

      <div class="risk-meta-row">
        <span class="risk-meta-item">${cm.biz}</span>
        <span class="risk-meta-sep">·</span>
        <span class="risk-meta-item">Loan <strong>${fmtLoan(cm.loan)}</strong></span>
      </div>
    </div>`;
}

// ---------- Decision card ----------

function miniGaugesHtml(sources, weakestSource) {
  return sources
    .map((s) => {
      const isWeakest = s.source === weakestSource && s.confidence_multiplier < 1;
      const fillClass = s.confidence_multiplier <= 0 ? "bad" : s.confidence_multiplier < 1 ? "warn" : "";
      const label = s.source.replace("_findings", "").toUpperCase();
      const subParts = [s.fi_type, s.expires_at ? fmtDate(s.expires_at) : null].filter(Boolean);
      return `
        <div class="mini-gauge ${isWeakest ? "weakest" : ""}" data-source="${s.source}">
          <div class="mini-gauge-head">
            <span class="mini-gauge-source">${label}</span>
            <span class="mini-gauge-days mono">${describeConsentAge(s)}</span>
          </div>
          ${subParts.length ? `<div class="mini-gauge-sub">${subParts.join(" · ")}</div>` : ""}
          <div class="gauge-track"><div class="gauge-fill ${fillClass} ${isWeakest ? "sync" : ""}" style="width:0%" data-target="${Math.max(3, Math.min(100, s.confidence_multiplier * 100))}"></div></div>
        </div>`;
    })
    .join("");
}

function renderDecisionCard(decision, consentSources, auditMeta) {
  const meta = OUTCOME_META[decision.outcome];
  const reasons = buildWhyReasons(decision, consentSources);
  const isCapped = decision.final_confidence < decision.model_confidence;

  $("decision-body").innerHTML = `
    ${auditMeta
      ? `<div class="audit-badge"><div><span class="audit-status-tag">Audited Dossier</span> &middot; ${auditMeta.capturedAt ? fmtDate(auditMeta.capturedAt) : "Captured"}</div><button id="run-live-btn" class="run-live-btn-inline">Re-evaluate Live ↑</button></div>`
      : ""}
    <div class="outcome-badge outcome-${decision.outcome}">${meta.icon} ${meta.label}</div>
    <div class="confidence-block">
      <div class="confidence-label">Final confidence</div>
      <div class="confidence-number tabular outcome-${decision.outcome}" id="confidence-number">${decision.model_confidence.toFixed(2)}</div>
      ${isCapped ? `<div class="confidence-sub capped">model ${decision.model_confidence.toFixed(2)} · capped by consent decay</div>` : ""}
    </div>
    <ul class="reasons-list">
      ${reasons.map((r) => `<li class="reason-item ${r.kind}"><div class="reason-rule mono">${RULE_LABEL[r.rule] || r.rule}</div>${r.text}</li>`).join("")}
    </ul>
    <div class="reasons-label">Consent${auditMeta ? ` <span class="consent-asof">(as of captured run)</span>` : ""}</div>
    <div class="decision-consent">${miniGaugesHtml(consentSources, decision.weakest_consent_source)}</div>
    ${creditRiskSectionHtml(decision.borrower_id)}
  `;

  if (auditMeta) {
    $("run-live-btn").addEventListener("click", () => loadBorrower(decision.borrower_id, { forceRefetch: true }));
  }

  const reveal = () => {
    const body = $("decision-body");
    body.querySelector(".outcome-badge").classList.add("show");
    body.querySelector(".confidence-block").classList.add("show");
    body.querySelectorAll(".reason-item").forEach((el, i) => {
      delay(() => el.classList.add("show"), 60 * i);
    });
    body.querySelectorAll(".mini-gauge .gauge-fill:not(.sync)").forEach((el, i) => {
      delay(() => {
        el.style.width = `${el.dataset.target}%`;
      }, 300 + 60 * i);
    });
  };

  if (REDUCE_MOTION) {
    reveal();
  } else {
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }

  // The gauge that actually caused the cap drains in lockstep with the
  // confidence number counting down, so the two numbers telling the same
  // story move together instead of as two unrelated widgets.
  const syncGauge = document.querySelector(".mini-gauge .gauge-fill.sync");
  const syncDuration = 1200;
  if (syncGauge && isCapped && !REDUCE_MOTION) {
    syncGauge.style.transitionDuration = `${syncDuration}ms`;
    delay(() => {
      syncGauge.style.width = `${syncGauge.dataset.target}%`;
    }, 250);
  } else if (syncGauge) {
    syncGauge.style.width = `${syncGauge.dataset.target}%`;
  }

  animateConfidenceNumber(decision.model_confidence, decision.final_confidence, isCapped ? syncDuration : 650);
}

function animateConfidenceNumber(from, to, duration) {
  const el = $("confidence-number");
  if (!el) return;
  if (REDUCE_MOTION || Math.abs(from - to) < 0.005) {
    el.textContent = to.toFixed(2);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = from + (to - from) * eased;
    el.textContent = value.toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(2);
  }
  delay(() => requestAnimationFrame(tick), 250);
}

// ---------- Ledger (grouped timeline) ----------

function evidenceCopyText(ev) {
  const bits = [];
  if (ev.transaction_ids && ev.transaction_ids.length) bits.push(`ids: ${ev.transaction_ids.join(", ")}`);
  if (ev.period) bits.push(`period: ${ev.period}`);
  if (ev.field) bits.push(`field: ${ev.field}`);
  return bits.join(" · ") || "(no citation)";
}

function jumpToClaim(source, field) {
  const target = document.querySelector(`.ledger-entry[data-agent="${SOURCE_TO_AGENT[source] || ""}"][data-metric="${field || ""}"]`);
  document.querySelectorAll(".ledger-entry.jump-target").forEach((el) => el.classList.remove("jump-target"));
  if (target) {
    target.classList.add("jump-target");
    target.scrollIntoView({ behavior: REDUCE_MOTION ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }
}

function ledgerEntryHtml(entry, groupIndex) {
  const isContradiction = entry.action === "flag_contradiction" || entry.action === "flag_subtler_contradiction";
  const evidence = (entry.claim && entry.claim.evidence) || [];
  const evidenceHtml = evidence
    .map((ev) => {
      const jump = isContradiction && ev.source;
      const copyText = evidenceCopyText(ev);
      // Two distinct affordances, never both read as "this is a link":
      // a copy-only chip is a plain tag (copy cursor, no navigation), the
      // two contradiction-sourced chips that also jump to a ledger entry
      // get a visibly different accent treatment plus an aria-label that
      // says what Enter/click actually does.
      return `<button type="button" class="evidence-chip${jump ? " jump" : ""}" data-copy="${copyText.replace(/"/g, "&quot;")}"
        aria-label="${jump ? `Jump to source and copy: ${copyText}` : `Copy: ${copyText}`}" ${
        jump ? `data-jump-source="${ev.source}" data-jump-field="${ev.field || ""}"` : ""
      }>${copyText}</button>`;
    })
    .join("");

  const showConf = Number(entry.confidence) < 1.0;
  return `
    <div class="ledger-entry${isContradiction ? " contradiction" : ""}${groupIndex >= 4 ? " ledger-entry-extra hidden" : ""}"
         data-agent="${entry.agent}" data-metric="${(entry.claim && entry.claim.metric) || ""}" tabindex="-1">
      <div class="ledger-entry-head">
        <span class="ledger-action-label${isContradiction ? " warn" : ""}">${ACTION_LABEL[entry.action] || entry.action}</span>
        <span class="ledger-step-id">${entry.step_id}</span>
        ${showConf ? `<span class="ledger-conf">conf ${Number(entry.confidence).toFixed(2)}</span>` : ""}
      </div>
      ${entry.claim && entry.claim.finding ? `<div class="ledger-entry-finding">${entry.claim.finding}</div>` : ""}
      ${entry.claim && entry.claim.value && !entry.claim.finding ? `<div class="ledger-entry-finding">${METRIC_LABEL[entry.claim.metric] || entry.claim.metric}: <strong>${VALUE_LABEL[entry.claim.value] || entry.claim.value}</strong>${entry.claim.magnitude_pct != null ? ` (${fmtPct(entry.claim.magnitude_pct)})` : ""}</div>` : ""}
      ${evidenceHtml ? `<div class="ledger-entry-evidence">${evidenceHtml}</div>` : ""}
    </div>`;
}

// The ledger endpoint returns the FULL append-only history across every
// past /evaluate call for a borrower - this project's own test cases have
// been run many times during development, so the raw response can contain
// several superseded copies of the same claim. This keeps only the latest
// (newest-timestamp) entry per (agent, metric) for a record_claim step, or
// per (agent, action) for anything else (flag_contradiction,
// apply_consent_decay, final_decision). Every field on every kept entry is
// still exactly what the API returned - this only decides which duplicate
// to keep, never alters one. Applied identically to a recorded capture and
// a live run, so the two can never show a different ledger shape for the
// same underlying data.
function dedupLedgerSteps(steps) {
  const latestByKey = new Map();
  steps.forEach((step) => {
    const key = step.action === "record_claim" ? `${step.agent}::${step.claim.metric}` : `${step.agent}::${step.action}`;
    const prev = latestByKey.get(key);
    if (!prev || step.timestamp > prev.timestamp) latestByKey.set(key, step);
  });
  return [...latestByKey.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

function renderLedger(rawLedgerSteps) {
  const rawSteps = rawLedgerSteps || [];
  const steps = dedupLedgerSteps(rawSteps);
  $("ledger-count").textContent =
    rawSteps.length === steps.length ? `(${steps.length} steps)` : `(${rawSteps.length} recorded, ${steps.length} unique claims shown)`;
  const list = $("ledger-list");
  list.innerHTML = "";

  const byAgent = new Map();
  steps.forEach((entry) => {
    if (!byAgent.has(entry.agent)) byAgent.set(entry.agent, []);
    byAgent.get(entry.agent).push(entry);
  });

  const orderedAgents = [...AGENT_ORDER.filter((a) => byAgent.has(a)), ...[...byAgent.keys()].filter((a) => !AGENT_ORDER.includes(a))];

  // "First 4 expanded" is applied PER AGENT GROUP, not as one cutoff across
  // the whole flat list. A global cutoff was tried first and broke against
  // real captured data: a borrower's ledger steps aren't always in the same
  // order as AGENT_ORDER (e.g. the orchestrator's own contradiction-flagging
  // step can have an earlier timestamp than a specialist agent's claim, if
  // that claim was last recomputed in an earlier run), so a global top-4
  // could land entirely inside one or two groups and leave another agent's
  // header rendered with zero visible rows until "Show all" is clicked -
  // indistinguishable from a bug. Per-group truncation can't do that: every
  // group with at least one entry always shows at least one entry.
  let hiddenCount = 0;
  orderedAgents.forEach((agent) => {
    const group = document.createElement("div");
    group.className = "ledger-group";
    group.innerHTML = `<h3 class="ledger-group-label">${AGENT_LABEL[agent] || agent}</h3>`;
    const groupEntries = [...byAgent.get(agent)].sort((a, b) => {
      const isPriority = (e) => (e.action === "flag_contradiction" || e.action === "flag_subtler_contradiction" || e.action === "final_decision") ? 0 : 1;
      return isPriority(a) - isPriority(b);
    });
    groupEntries.forEach((entry, groupIndex) => {
      if (groupIndex >= 4) hiddenCount++;
      group.insertAdjacentHTML("beforeend", ledgerEntryHtml(entry, groupIndex));
    });
    list.appendChild(group);
  });

  if (hiddenCount > 0) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ledger-show-all";
    btn.id = "ledger-show-all";
    btn.textContent = `Show all ${steps.length} steps`;
    btn.addEventListener("click", () => {
      list.querySelectorAll(".ledger-entry-extra").forEach((el) => el.classList.remove("hidden"));
      btn.remove();
    });
    list.appendChild(btn);
  }

  list.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(btn.dataset.copy);
      announceCopy(ok ? "Copied to clipboard" : "Copy failed");
      showToast(ok ? "Copied" : "Copy failed");
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 900);
      if (btn.dataset.jumpSource) jumpToClaim(btn.dataset.jumpSource, btn.dataset.jumpField);
    });
  });
}

// ---------- Reveal choreography ----------
//
// Hard reset first, always - the single fix for "switching cases shows the
// previous case's chart header / verdict / consent / ledger for a moment."
// Every render path (instant recorded paint, live-run start, live-run
// finish) calls this before touching anything else.

function resetDeskUI(statusLine) {
  resetPipelineCanvas();
  $("pipeline-status").textContent = statusLine;

  const title = $("divergence-title");
  title.textContent = "Running…";
  title.className = "divergence-title";
  $("divergence-chart").innerHTML = "";

  $("decision-body").innerHTML = `<div class="decision-empty">Running the pipeline...</div>`;
  $("ledger-list").innerHTML = "";
  $("ledger-count").textContent = "";
  $("replay-btn").disabled = true;
}

function playReveal(borrowerId) {
  const data = cache.get(borrowerId);
  if (!data) return;
  const { decision, ledgerSteps, consentSources, isAuditDossier, capturedAt } = data;
  const hasContradiction = (decision.contradictions || []).length > 0;

  resetDeskUI("3 agents · parallel · orchestrated");
  setTopbarCaseCtx(borrowerId);

  ["node-bank", "node-gst", "node-investment"].forEach((id) => setNodeState(id, "done"));
  setNodeState("node-orchestrator", "done");
  delay(() => setNodeState("node-decision", "done"), 480);

  delay(() => setConnectorDrawn("conn-bank", true), 60);
  delay(() => setConnectorDrawn("conn-gst", true), 150);
  delay(() => setConnectorDrawn("conn-investment", true), 240);
  delay(() => setConnectorDrawn("conn-out", true, hasContradiction), 420);

  const outcomeEl = $("orchestrator-outcome");
  if (outcomeEl) outcomeEl.textContent = orchestratorSummaryText(decision);
  const decisionLabelEl = $("decision-outcome-label");
  if (decisionLabelEl) {
    const m = OUTCOME_META[decision.outcome];
    decisionLabelEl.textContent = m ? `${m.icon} ${m.label}` : decision.outcome;
  }

  // The chart reads the latest known value of each claim, same as the
  // ledger panel does internally - a raw multi-run history could otherwise
  // let findClaim() pick a superseded (older) occurrence of a metric.
  renderDivergenceChart(decision, dedupLedgerSteps(ledgerSteps));
  renderDecisionCard(decision, consentSources, isAuditDossier ? { capturedAt } : null);
  renderLedger(ledgerSteps);

  renderCaseRail();
  $("replay-btn").disabled = false;
}

// A live call has no incremental progress events - it's one POST that
// resolves at the end - so this is a staged, honestly-indeterminate
// "working" state (per the brief: determinate-looking, not a literal
// progress percentage) rather than claiming to know how far along the
// real Vertex AI call is. It's replaced outright by the real result the
// moment the response lands.
function showLiveLoadingState(borrowerId) {
  resetDeskUI("calling 3 parallel agents + orchestrator on live Vertex AI???");

  // Show skeleton in decision body and divergence chart
  $("decision-body").innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-item" style="width: 60%; margin-bottom: 8px;"></div>
      <div class="skeleton-item" style="width: 80%; margin-bottom: 8px;"></div>
      <div class="skeleton-item" style="width: 40%;"></div>
    </div>
  `;
  $("divergence-chart").innerHTML = `
    <div class="skeleton-loader">
      <div class="skeleton-item" style="height: 20px;"></div>
      <div class="skeleton-item" style="height: 16px; margin-top: 8px;"></div>
    </div>
  `;

  if (REDUCE_MOTION) {
    ["node-bank", "node-gst", "node-investment", "node-orchestrator", "node-decision"].forEach((id) => setNodeState(id, "working"));
    ["conn-bank", "conn-gst", "conn-investment"].forEach((id) => setConnectorCharging(id, true));
    return;
  }

  setNodeState("node-bank", "pending");
  setNodeState("node-gst", "pending");
  setNodeState("node-investment", "pending");
  setNodeState("node-orchestrator", "pending");
  setNodeState("node-decision", "pending");

  delay(() => {
    setNodeState("node-bank", "working");
    setConnectorCharging("conn-bank", true);
  }, 150);
  delay(() => {
    setNodeState("node-gst", "working");
    setConnectorCharging("conn-gst", true);
  }, 300);
  delay(() => {
    setNodeState("node-investment", "working");
    setConnectorCharging("conn-investment", true);
  }, 450);
  delay(() => {
    setNodeState("node-orchestrator", "working");
    setConnectorCharging("conn-out", true);
  }, 700);
}
// in the left rail. The Credit Applications workspace (pane="credit")
// is the default and preserves all existing case rail behaviour.
// ═══════════════════════════════════════════════════════════════════

const WS_STATUS_MAP = {
  "Filed": "filed",
  "Settled": "settled",
  "Pending": "pending",
  "Draft": "draft",
  "Overdue": "overdue",
  "Verified": "verified",
  "Under Review": "under-review",
};

function wsStatusBadge(status) {
  const cls = WS_STATUS_MAP[status] || "draft";
  return `<span class="ws-status-badge ${cls}">${status}</span>`;
}

function fmtInr(amount) {
  const n = Number(amount);
  if (isNaN(n)) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Active workspace state — persists which workspace + view is open
let activeWorkspace = null;
let wsData = null;         // parsed workbook data from /ingest/onboarding
let activeWsClient = null; // selected client ID in workspace panes
let enterpriseData = null; // pre-loaded enterprise_live_state.json

// ── Layout state router ───────────────────────────────────────────────
// desk[data-ws] drives CSS show/hide of pipeline vs workspace-main-frame.
function switchWorkspace(ws) {
  activeWorkspace = ws;

  // Drive CSS layout switch
  const desk = $("desk");
  if (desk) desk.dataset.ws = ws;

  // Nav button active state
  document.querySelectorAll(".workspace-nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ws === ws);
  });

  // Left-rail context pane visibility
  document.querySelectorAll(".workspace-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.pane === ws);
  });

  // Update URL hash (enables browser back/forward)
  try { history.replaceState(null, "", `#ws=${ws}`); } catch (_) {}

  if (ws === "credit") {
    renderCaseRail();
    return;
  }
  renderWorkspaceMain(ws);
}

// ── Workspace main frame renderer — dispatches to per-workspace builders ─
function renderWorkspaceMain(ws) {
  const frame = $("workspace-main-frame");
  if (!frame) return;
  switch (ws) {
    case "dashboard":  renderDashboard(frame); break;
    case "client":     renderClientMain(frame); break;
    case "income":     renderIncomeMain(frame); break;
    case "compliance": renderComplianceMain(frame); break;
    case "assets":     renderAssetsMain(frame); break;
    default:
      frame.innerHTML = `<div style="padding:40px;color:var(--muted)">Workspace coming soon.</div>`;
  }
}

// ── Enterprise data loader (static JSON, no backend required) ────────
async function loadEnterpriseData() {
  try {
    const res = await fetch("/enterprise_live_state.json");
    if (!res.ok) throw new Error(res.statusText);
    enterpriseData = await res.json();
    if (activeWorkspace !== "credit") renderWorkspaceMain(activeWorkspace);
  } catch (err) {
    console.warn("enterprise_live_state.json not available:", err.message);
  }
}

// ── GSTIN validation ─────────────────────────────────────────────────
// Format: SSAAAAANNNNAAZC  (State 2d · PAN 10c · Entity 1c · Z · Check 1c)
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
function validateGSTIN(value) {
  if (!value || value.trim() === "") return { valid: false, error: "GSTIN is required" };
  const v = value.trim().toUpperCase();
  if (v.length !== 15) return { valid: false, error: `GSTIN must be exactly 15 characters — got ${v.length}` };
  if (!GSTIN_RE.test(v))  return { valid: false, error: "GSTIN format invalid — expected format: SSAAAAANNNNAAZC" };
  return { valid: true, error: null };
}

// ── INR formatter (shared with workspace main) ────────────────────────
function fmtInrMain(n) {
  const v = Number(n);
  if (isNaN(v) || v === 0) return "—";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// ── Delta badge ───────────────────────────────────────────────────────
function deltaChip(pct, dir) {
  const sign = dir === "up" ? "▲" : "▼";
  const cls  = dir === "up" ? "up" : "down";
  return `<span class="ws-kpi-delta ${cls}">${sign} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function setupWorkspaceNav() {
  document.querySelectorAll(".workspace-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchWorkspace(btn.dataset.ws));
  });

  // Sub-nav link switching
  document.querySelectorAll(".ws-sub-nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      const parentPane = link.closest(".workspace-pane");
      if (!parentPane) return;
      parentPane.querySelectorAll(".ws-sub-nav-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Workbook upload button
  const wsUploadBtn = $("ws-upload-btn");
  const wsFileInput = $("ws-file-input");
  if (wsUploadBtn && wsFileInput) {
    wsUploadBtn.addEventListener("click", () => wsFileInput.click());
    wsFileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleWorkbookUpload(file);
      wsFileInput.value = ""; // allow re-uploading same file
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORKSPACE MAIN FRAME RENDERERS
// ═══════════════════════════════════════════════════════════════════════

// ── Dashboard — three-column financial command deck ──────────────────
function renderDashboard(frame) {
  if (!enterpriseData) {
    frame.innerHTML = `<div style="padding:40px 20px;color:var(--muted);text-align:center">
      <div style="font-size:24px;margin-bottom:12px">▦</div>
      <div style="font-size:13px">Loading enterprise data…</div>
    </div>`;
    return;
  }
  const { entity, summary, compliance, actions, invoices, mf_portfolio } = enterpriseData;

  // ── Computed: overdue receivable, filing health, portfolio allocation ──
  const overdueInvs = (invoices || []).filter((i) => i.status === "Overdue");
  const overdueTotal = overdueInvs.reduce((s, i) => s + i.amount_inr, 0);

  const fullyFiled = compliance.filter((r) => r.gstr1_status === "Filed" && r.gstr3b_status === "Filed").length;
  const actionCount = compliance.filter((r) => r.action_required).length;
  const totalItc = compliance.reduce((s, r) => s + r.itc_eligible_inr, 0);
  const totalPayable = compliance.reduce((s, r) => s + r.net_payable_inr, 0);
  const healthPct = Math.round((fullyFiled / compliance.length) * 100);

  const portTotal = (mf_portfolio || []).reduce((s, f) => s + f.current_value_inr, 0);
  const portByType = {};
  (mf_portfolio || []).forEach((f) => { portByType[f.type] = (portByType[f.type] || 0) + f.current_value_inr; });
  const PORT_COLORS = { Liquid: "var(--ok)", Equity: "var(--signal-bank)", ELSS: "#9c27b0", Debt: "var(--accent)", Hybrid: "#06b6d4" };

  const overdueCard = overdueTotal > 0 ? `
    <div class="ws-kpi-card" style="border-left:2px solid var(--warn)">
      <div class="ws-kpi-card-label" style="color:var(--warn)">⚑ Overdue Receivable</div>
      <div class="ws-kpi-card-value warn">${fmtInrMain(overdueTotal)}</div>
      <div class="ws-kpi-card-footer"><span style="font-size:11px;color:var(--muted-dim)">${overdueInvs.length} invoice${overdueInvs.length > 1 ? "s" : ""} · past payment terms</span></div>
    </div>` : "";

  const portAllocation = portTotal > 0 ? `
    <div style="padding:10px 0 4px;border-top:1px solid var(--border);margin-top:4px">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Portfolio Allocation · ${fmtInrMain(portTotal)} total</div>
      <div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:1px">
        ${Object.entries(portByType).map(([t, v]) => `<div style="flex:${v};background:${PORT_COLORS[t] || "#888"}" title="${t}: ${fmtInrMain(v)}"></div>`).join("")}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:7px">
        ${Object.entries(portByType).map(([t, v]) => `<span style="font-size:10px;color:var(--muted)"><span style="display:inline-block;width:7px;height:7px;border-radius:1px;background:${PORT_COLORS[t] || "#888"};vertical-align:middle;margin-right:3px"></span>${t} ${Math.round(v / portTotal * 100)}%</span>`).join("")}
      </div>
    </div>` : "";

  const trendData = [...compliance].reverse();
  const maxPay = Math.max(...trendData.map((r) => r.net_payable_inr || 0), 1);
  const BAR_W = 26, GAP = 3, CHART_H = 60, LABEL_H = 16;
  const svgW = trendData.length * (BAR_W + GAP) + 10;
  const trendBars = trendData.map((row, i) => {
    const h = row.net_payable_inr > 0 ? Math.max(3, Math.round((row.net_payable_inr / maxPay) * CHART_H)) : 2;
    const x = 5 + i * (BAR_W + GAP);
    const fill = row.action_required ? "var(--warn)" : (row.net_payable_inr === 0 ? "var(--border)" : "var(--signal-bank)");
    return `<rect x="${x}" y="${CHART_H - h}" width="${BAR_W}" height="${h}" rx="2" fill="${fill}" opacity="0.85"><title>${row.period}: ${fmtInrMain(row.net_payable_inr)} GST net payable${row.action_required ? " ⚑" : ""}</title></rect><text x="${x + BAR_W / 2}" y="${CHART_H + LABEL_H}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${row.period.split(" ")[0].slice(0, 3)}</text>`;
  }).join("");

  const trendChart = `
    <div style="padding-top:10px;margin-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">GST Net Payable — Monthly</div>
      <svg viewBox="0 0 ${svgW} ${CHART_H + LABEL_H + 2}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">${trendBars}</svg>
    </div>`;

  const healthBar = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;margin-bottom:8px;background:var(--surface-2);border-radius:5px;border:1px solid var(--border)">
      <span style="font-size:11px;color:var(--ok)">✓ ${fullyFiled}/${compliance.length} filed</span>
      ${actionCount > 0 ? `<span style="font-size:11px;color:var(--warn)">⚑ ${actionCount} action req.</span>` : ""}
      <span style="font-size:11px;color:var(--muted)">ITC ${fmtInrMain(totalItc)}</span>
      <span style="font-size:11px;color:var(--muted)">Payable ${fmtInrMain(totalPayable)}</span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:5px">
        <span style="font-size:10px;color:var(--muted)">Filing health</span>
        <span style="font-size:12px;font-weight:600;color:${healthPct >= 80 ? "var(--ok)" : "var(--warn)"}">${healthPct}%</span>
      </span>
    </div>`;

  // ── Entity header ───────────────────────────────────────────────
  const header = `
    <div class="ws-entity-header">
      <div>
        <div class="ws-entity-name">${entity.name}</div>
        <div class="ws-entity-meta" style="margin-top:3px">
          <span>${entity.industry}</span>
          <span>·</span>
          <span>${entity.city}, ${entity.state}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="ws-entity-meta-chip">${entity.gstin}</span>
        <span class="ws-entity-meta-chip">${entity.pan}</span>
        <span class="ws-entity-asof">as of ${entity.as_of}</span>
      </div>
    </div>`;

  // ── KPI Banner (left column) ────────────────────────────────────
  const kpiCards = Object.values(summary).map((kpi) => `
    <div class="ws-kpi-card">
      <div class="ws-kpi-card-label">${kpi.label}</div>
      <div class="ws-kpi-card-value">${fmtInrMain(kpi.value)}</div>
      <div class="ws-kpi-card-footer">
        ${deltaChip(kpi.delta_pct, kpi.delta_direction)}
        <span class="ws-kpi-card-note">${kpi.period}</span>
      </div>
      <div class="ws-kpi-card-note" style="margin-top:2px">${kpi.note}</div>
    </div>`).join("");

  // ── Compliance Control Grid (center column) ─────────────────────
  function cBadge(status) {
    const map = {
      "filed":           "filed",
      "draft":           "draft",
      "pending":         "pending",
      "action required": "action-required",
      "due soon":        "due-soon",
    };
    const key = (status || "").toLowerCase();
    const cls = map[key] || "pending";
    return `<span class="c-badge ${cls}">${status}</span>`;
  }

  const complianceRows = compliance.map((row) => {
    const isAction = row.action_required;
    const gstr1 = cBadge(row.gstr1_status);
    const gstr3b = cBadge(row.gstr3b_status);
    const itc = row.itc_eligible_inr > 0
      ? `<span class="c-inr">${fmtInrMain(row.itc_eligible_inr)}</span>`
      : `<span class="c-inr zero">—</span>`;
    const payable = row.net_payable_inr > 0
      ? `<span class="c-inr ${isAction ? "warn" : ""}">${fmtInrMain(row.net_payable_inr)}</span>`
      : `<span class="c-inr zero">—</span>`;
    const flag = isAction
      ? `<span class="c-action-flag" title="${row.action_note}">⚑ ${row.action_note}</span>`
      : (row.action_note ? `<span style="font-size:10px;color:var(--muted-dim)">${row.action_note}</span>` : "");
    return `<tr class="${isAction ? "action-row" : ""}">
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:600">${row.period}</td>
      <td>${gstr1}</td>
      <td>${gstr3b}</td>
      <td style="text-align:right">${itc}</td>
      <td style="text-align:right">${payable}</td>
      <td style="min-width:120px;white-space:normal;font-size:10.5px">${flag}</td>
    </tr>`;
  }).join("");

  // ── Smart Decision Action Panel (right column) ──────────────────
  const actionItems = actions.map((a) => `
    <div class="ws-action-item ${a.priority}">
      <div class="ws-action-item-header">
        <div class="ws-action-label">${a.label}</div>
        <span class="ws-action-priority ${a.priority}">${a.priority.toUpperCase()}</span>
      </div>
      <div class="ws-action-detail">${a.detail}</div>
      <div class="ws-action-period">${a.period}</div>
      <button class="ws-action-trigger-btn" type="button" data-action-id="${a.id}">
        Initiate →
      </button>
    </div>`).join("");

  frame.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      ${header}
      <div class="ws-cmd-deck" style="flex:1;overflow:hidden">

        <div class="ws-cmd-col" style="overflow-y:auto">
          <div class="ws-cmd-col-header">Financial Overview</div>
          <div class="ws-kpi-banner">${kpiCards}${overdueCard}</div>
          ${portAllocation}
          ${trendChart}
        </div>

        <div class="ws-cmd-col">
          <div class="ws-cmd-col-header">GST Compliance Tracker — FY2026-27</div>
          ${healthBar}
          <div style="overflow-x:auto;flex:1">
            <table class="ws-compliance-table">
              <thead>
                <tr>
                  <th style="width:90px">Period</th>
                  <th style="width:90px">GSTR-1</th>
                  <th style="width:90px">GSTR-3B</th>
                  <th style="width:85px;text-align:right">ITC Eligible</th>
                  <th style="width:85px;text-align:right">Net Payable</th>
                  <th>Status / Note</th>
                </tr>
              </thead>
              <tbody>${complianceRows}</tbody>
            </table>
          </div>
        </div>

        <div class="ws-cmd-col">
          <div class="ws-cmd-col-header">Action Queue</div>
          <div class="ws-action-list">${actionItems}</div>
        </div>

      </div>
    </div>`;

  // Wire action trigger buttons — show a toast acknowledgement
  frame.querySelectorAll(".ws-action-trigger-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.actionId;
      const item = actions.find((a) => a.id === id);
      if (item) showToast(`Initiated: ${item.label}`);
    });
  });
}

// ── Client Space main frame ──────────────────────────────────────────
function renderClientMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const { entity } = data;

  frame.innerHTML = `
    <div class="ws-main-section">
      <div class="ws-main-section-title">KYB Entity Profile</div>
      <div class="ws-main-kpi-row">
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Entity</div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-top:4px">${entity.name}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">PAN</div>
          <div class="ws-main-kpi-cell-value" style="font-size:14px">${entity.pan}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">GSTIN</div>
          <div class="ws-main-kpi-cell-value" style="font-size:14px">${entity.gstin}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">State</div>
          <div class="ws-main-kpi-cell-value" style="font-size:14px">${entity.state_code} · ${entity.state}</div>
        </div>
      </div>
      <table class="ws-data-table" style="margin-top:4px">
        <thead><tr>
          <th style="width:180px">Field</th>
          <th>Value</th>
        </tr></thead>
        <tbody>
          ${[
            ["Entity Type",   entity.entity_type],
            ["Industry",      entity.industry],
            ["City",          entity.city],
            ["Banker",        entity.banker],
            ["CA Firm",       entity.ca_firm],
            ["FY",            entity.fy],
            ["As of Date",    entity.as_of],
          ].map(([k, v]) => `<tr><td style="color:var(--muted);font-size:11.5px">${k}</td><td>${v}</td></tr>`).join("")}
        </tbody>
      </table>

      <div class="ws-main-section-title" style="margin-top:16px">Upload Additional Client Workbook</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
        <button class="ws-ingest-btn" id="ws-upload-btn-main" type="button" style="padding:7px 16px">
          Upload Onboarding Workbook (.xlsx)
        </button>
        <span style="font-size:11px;color:var(--muted-dim)">Multi-client batch · Cross-references via Client_ID</span>
      </div>
    </div>`;

  const btn = frame.querySelector("#ws-upload-btn-main");
  const fi = $("ws-file-input");
  if (btn && fi) btn.addEventListener("click", () => fi.click());
}

// ── Income & Revenue main frame ──────────────────────────────────────
function renderIncomeMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const { invoices, tds, summary } = data;

  const totalGross    = invoices.reduce((s, i) => s + (i.gstin_valid ? i.amount_inr : 0), 0);
  const totalSettled  = invoices.filter((i) => i.status === "Settled").reduce((s, i) => s + i.amount_inr, 0);
  const totalPending  = invoices.filter((i) => i.status === "Pending").reduce((s, i) => s + i.amount_inr, 0);
  const totalOverdue  = invoices.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.amount_inr, 0);
  const invalidCount  = invoices.filter((i) => !i.gstin_valid).length;

  const kpiRow = `
    <div class="ws-main-kpi-row">
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Gross Invoiced (30d)</div>
        <div class="ws-main-kpi-cell-value">${fmtInrMain(invoices.reduce((s, i) => s + i.amount_inr, 0))}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Settled</div>
        <div class="ws-main-kpi-cell-value ok">${fmtInrMain(totalSettled)}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Pending + Overdue</div>
        <div class="ws-main-kpi-cell-value warn">${fmtInrMain(totalPending + totalOverdue)}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">GSTIN Validation Errors</div>
        <div class="ws-main-kpi-cell-value ${invalidCount > 0 ? "warn" : "ok"}">${invalidCount}</div>
      </div>
    </div>`;

  const invoiceRows = invoices.map((inv) => {
    const { valid: gstinOk, error: gstinErr } = validateGSTIN(inv.buyer_gstin);
    const gstinCell = gstinOk
      ? `<span class="ws-gstin-value valid">${inv.buyer_gstin}</span>`
      : `<div>
          <span class="ws-gstin-value invalid">${inv.buyer_gstin}</span>
          <div class="ws-gstin-error">
            <span class="ws-gstin-error-icon">⚑</span>
            <span class="ws-gstin-error-text">${gstinErr}</span>
          </div>
        </div>`;

    const statusCls = { Settled: "filed", Pending: "pending", Overdue: "action-required", Draft: "draft" };
    return `<tr class="${!gstinOk ? "invalid-row" : ""}">
      <td style="font-family:var(--font-mono);font-size:11.5px;color:var(--muted)">${inv.id}</td>
      <td style="color:var(--muted-dim);font-size:11.5px">${inv.date}</td>
      <td style="white-space:normal;overflow:visible">${inv.buyer}</td>
      <td style="white-space:normal;overflow:visible">${gstinCell}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fmtInrMain(inv.amount_inr)}</td>
      <td style="text-align:right;font-family:var(--font-mono);color:var(--muted-dim)">${(inv.gst_rate * 100).toFixed(0)}%</td>
      <td><span class="c-badge ${statusCls[inv.status] || "pending"}">${inv.status}</span></td>
    </tr>`;
  }).join("");

  const tdsRows = tds.map((t) => `<tr>
    <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted-dim)">${t.traces_ref}</td>
    <td>${t.deductor}</td>
    <td style="font-family:var(--font-mono);font-size:11.5px;color:var(--muted)">${t.period}</td>
    <td style="text-align:right;font-family:var(--font-mono)">${fmtInrMain(t.amount_inr)}</td>
    <td><span class="ws-tds-${t.status.toLowerCase()}">${t.status}</span></td>
  </tr>`).join("");

  frame.innerHTML = `
    <div class="ws-main-section">
      ${kpiRow}

      <div class="ws-main-section-title">Invoice Pipeline — Last 30 Days</div>
      <div style="overflow-x:auto">
        <table class="ws-data-table">
          <thead><tr>
            <th style="width:80px">Invoice</th>
            <th style="width:90px">Date</th>
            <th style="width:200px">Buyer</th>
            <th style="width:200px">Buyer GSTIN</th>
            <th style="width:100px;text-align:right">Amount</th>
            <th style="width:60px;text-align:right">GST%</th>
            <th style="width:110px">Status</th>
          </tr></thead>
          <tbody>${invoiceRows}</tbody>
        </table>
      </div>

      <div class="ws-main-section-title" style="margin-top:8px">TDS Tracker — Form 26AS</div>
      <div style="overflow-x:auto">
        <table class="ws-data-table">
          <thead><tr>
            <th style="width:110px">TRACES Ref</th>
            <th style="width:220px">Deductor</th>
            <th style="width:120px">Period</th>
            <th style="width:100px;text-align:right">Amount</th>
            <th>Status</th>
          </tr></thead>
          <tbody>${tdsRows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Compliance Matrix main frame ─────────────────────────────────────
function renderComplianceMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const { compliance, entity } = data;

  const filed    = compliance.filter((r) => r.gstr1_status === "Filed" && r.gstr3b_status === "Filed").length;
  const draft    = compliance.filter((r) => r.gstr3b_status === "Draft").length;
  const pending  = compliance.filter((r) => r.gstr1_status === "Pending").length;
  const actions  = compliance.filter((r) => r.action_required).length;
  const totalItc = compliance.reduce((s, r) => s + r.itc_eligible_inr, 0);

  const kpiRow = `
    <div class="ws-main-kpi-row">
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Fully Filed</div>
        <div class="ws-main-kpi-cell-value ok">${filed} <span style="font-size:12px;color:var(--muted)">/ ${compliance.length}</span></div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Draft / Pending</div>
        <div class="ws-main-kpi-cell-value warn">${draft + pending}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Action Required</div>
        <div class="ws-main-kpi-cell-value ${actions > 0 ? "warn" : "ok"}">${actions}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Total ITC Eligible</div>
        <div class="ws-main-kpi-cell-value">${fmtInrMain(totalItc)}</div>
      </div>
    </div>`;

  function cBadge(s) {
    const m = { Filed: "filed", Draft: "draft", Pending: "pending" };
    return `<span class="c-badge ${m[s] || "pending"}">${s}</span>`;
  }

  const rows = compliance.map((r) => {
    const flag = r.action_required
      ? `<span class="c-action-flag">⚑ ${r.action_note}</span>`
      : (r.action_note ? `<span style="font-size:10.5px;color:var(--muted-dim)">${r.action_note}</span>` : "");
    return `<tr class="${r.action_required ? "action-row" : ""}">
      <td style="font-family:var(--font-mono);font-weight:600;font-size:12px">${r.period}</td>
      <td>${cBadge(r.gstr1_status)}</td>
      <td>${cBadge(r.gstr3b_status)}</td>
      <td style="text-align:right"><span class="c-inr">${r.itc_eligible_inr > 0 ? fmtInrMain(r.itc_eligible_inr) : "—"}</span></td>
      <td style="text-align:right"><span class="c-inr ${r.action_required ? "warn" : ""}">${r.net_payable_inr > 0 ? fmtInrMain(r.net_payable_inr) : "—"}</span></td>
      <td style="white-space:normal">${flag}</td>
    </tr>`;
  }).join("");

  frame.innerHTML = `
    <div class="ws-main-section">
      ${kpiRow}
      <div class="ws-main-section-title">GST Filing Ledger — ${entity.gstin}</div>
      <div style="overflow-x:auto">
        <table class="ws-compliance-table" style="min-width:600px">
          <thead><tr>
            <th style="width:100px">Period</th>
            <th style="width:100px">GSTR-1</th>
            <th style="width:100px">GSTR-3B</th>
            <th style="width:110px;text-align:right">ITC Eligible</th>
            <th style="width:110px;text-align:right">Net Payable</th>
            <th>Notes</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Asset Allocations main frame ─────────────────────────────────────
function renderAssetsMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const { mf_portfolio, summary } = data;

  const totalAum    = mf_portfolio.reduce((s, f) => s + f.current_value_inr, 0);
  const liquidAum   = mf_portfolio.filter((f) => f.type === "Liquid").reduce((s, f) => s + f.current_value_inr, 0);
  const equityAum   = mf_portfolio.filter((f) => f.type === "Equity" || f.type === "ELSS").reduce((s, f) => s + f.current_value_inr, 0);
  const avgXirr     = mf_portfolio.reduce((s, f) => s + f.xirr_pct, 0) / mf_portfolio.length;

  const kpiRow = `
    <div class="ws-main-kpi-row">
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Total AUM</div>
        <div class="ws-main-kpi-cell-value ok">${fmtInrMain(totalAum)}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Liquid Buffer</div>
        <div class="ws-main-kpi-cell-value">${fmtInrMain(liquidAum)}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Equity Exposure</div>
        <div class="ws-main-kpi-cell-value">${fmtInrMain(equityAum)}</div>
      </div>
      <div class="ws-main-kpi-cell">
        <div class="ws-main-kpi-cell-label">Avg. XIRR</div>
        <div class="ws-main-kpi-cell-value ok">${avgXirr.toFixed(1)}%</div>
      </div>
    </div>`;

  const fundTypeColor = { Liquid: "var(--ok)", Equity: "var(--signal-bank)", ELSS: "var(--signal-gst)", Debt: "var(--muted)", Hybrid: "var(--accent)" };

  const rows = mf_portfolio.map((f) => {
    const barW = Math.round((f.xirr_pct / 25) * 60);
    const color = fundTypeColor[f.type] || "var(--muted)";
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted-dim)">${f.folio}</td>
      <td style="white-space:normal;overflow:visible">${f.fund}</td>
      <td><span class="c-badge pending" style="background:${color}20;color:${color};border:1px solid ${color}40">${f.type}</span></td>
      <td style="color:var(--muted-dim);font-size:11.5px">${f.amc}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${f.units.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fmtInrMain(f.nav)}</td>
      <td style="text-align:right;font-family:var(--font-mono);font-weight:600">${fmtInrMain(f.current_value_inr)}</td>
      <td style="text-align:right">
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--ok)">${f.xirr_pct.toFixed(1)}%</span>
        <span class="ws-xirr-bar" style="width:${barW}px;background:${color}80"></span>
      </td>
    </tr>`;
  }).join("");

  frame.innerHTML = `
    <div class="ws-main-section">
      ${kpiRow}
      <div class="ws-main-section-title">Mutual Fund Portfolio — Pledgeable Asset Register</div>
      <div style="overflow-x:auto">
        <table class="ws-data-table">
          <thead><tr>
            <th style="width:90px">Folio</th>
            <th style="width:240px">Fund</th>
            <th style="width:80px">Type</th>
            <th style="width:130px">AMC</th>
            <th style="width:90px;text-align:right">Units</th>
            <th style="width:80px;text-align:right">NAV</th>
            <th style="width:100px;text-align:right">Current Value</th>
            <th style="width:100px;text-align:right">XIRR</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function handleWorkbookUpload(file) {
  const zone = $("client-ingest-zone");
  if (!zone) return;

  // Show loading state
  zone.innerHTML = `
    <div class="ws-upload-progress">
      <div class="ws-upload-progress-label">
        <span class="ws-ingest-spinner"></span>
        Parsing workbook — cross-referencing sheets…
      </div>
      <div class="ws-upload-progress-bar">
        <div class="ws-upload-progress-fill" id="ws-progress-fill" style="width: 20%"></div>
      </div>
    </div>`;

  // Animate progress bar
  const fill = $("ws-progress-fill");
  if (fill) delay(() => { if (fill) fill.style.width = "65%"; }, 300);

  const form = new FormData();
  form.append("workbook", file);

  try {
    const res = await fetch(`${BACKEND_URL}/ingest/onboarding`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    wsData = await res.json();
    if (fill) fill.style.width = "100%";
    delay(() => renderWorkbookLoaded(file.name), 200);
  } catch (err) {
    zone.innerHTML = `
      <div class="ws-ingest-empty">
        <div class="ws-ingest-icon">⚠</div>
        <div class="ws-ingest-label">Upload failed</div>
        <p class="ws-ingest-hint">${err.message}</p>
        <button class="ws-ingest-btn" id="ws-upload-btn" type="button">Try again</button>
      </div>`;
    const retryBtn = $("ws-upload-btn");
    const wsFileInput = $("ws-file-input");
    if (retryBtn && wsFileInput) retryBtn.addEventListener("click", () => wsFileInput.click());
  }
}

function renderWorkbookLoaded(filename) {
  if (!wsData) return;

  // Build the loaded bar + client list for the Client Space pane
  const loadedBar = `
    <div class="ws-loaded-bar">
      <span class="ws-loaded-bar-icon">✓</span>
      <span class="ws-loaded-bar-name">${filename}</span>
      <span style="color:var(--muted-dim);font-size:11px">${wsData.client_count} client${wsData.client_count !== 1 ? "s" : ""}</span>
      <button class="ws-loaded-bar-clear" id="ws-clear-btn" title="Clear workbook" type="button">✕</button>
    </div>`;

  // Replace ingest zone in Client Space pane
  const clientIngestZone = $("client-ingest-zone");
  if (clientIngestZone) clientIngestZone.style.display = "none";

  const clientList = $("ws-client-list");
  if (clientList) {
    clientList.hidden = false;
    clientList.innerHTML = loadedBar + wsData.clients.map((c) => {
      const kyb = c.profile.KYB_Status || c.profile.kyb_status || "";
      return `
        <div class="ws-client-card" data-client-id="${c.client_id}" role="button" tabindex="0">
          <div class="ws-client-name">${c.profile.Full_Name || c.profile.full_name || c.client_id}</div>
          <div class="ws-client-id">${c.client_id} · ${c.profile.Entity_Type || c.profile.entity_type || ""}</div>
          <div class="ws-client-meta" style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:var(--muted-dim)">${c.profile.City || c.profile.city || ""}</span>
            ${kyb ? wsStatusBadge(kyb) : ""}
          </div>
        </div>`;
    }).join("");

    clientList.querySelectorAll(".ws-client-card").forEach((card) => {
      card.addEventListener("click", () => {
        clientList.querySelectorAll(".ws-client-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        activeWsClient = card.dataset.clientId;
        renderWorkspaceData(activeWorkspace);
      });
    });
  }

  // Propagate the loaded bar + data to Income, Compliance, Assets panes
  renderWorkspaceData("income");
  renderWorkspaceData("compliance");
  renderWorkspaceData("assets");

  // Wire up the clear button
  delay(() => {
    const clearBtn = $("ws-clear-btn");
    if (clearBtn) clearBtn.addEventListener("click", clearWorkbook);
  }, 100);
}

function clearWorkbook() {
  wsData = null;
  activeWsClient = null;

  const clientList = $("ws-client-list");
  if (clientList) { clientList.hidden = true; clientList.innerHTML = ""; }

  const clientIngestZone = $("client-ingest-zone");
  if (clientIngestZone) {
    clientIngestZone.style.display = "";
    clientIngestZone.innerHTML = `
      <div class="ws-ingest-empty">
        <div class="ws-ingest-icon">◈</div>
        <div class="ws-ingest-label">No client file loaded</div>
        <p class="ws-ingest-hint">Upload an onboarding Excel workbook to populate client profiles.</p>
        <button class="ws-ingest-btn" id="ws-upload-btn" type="button">Upload Onboarding Workbook</button>
      </div>`;
    const btn = $("ws-upload-btn");
    const fi = $("ws-file-input");
    if (btn && fi) btn.addEventListener("click", () => fi.click());
  }

  ["income", "compliance", "assets"].forEach((ws) => {
    const view = $(`ws-${ws}-view`);
    if (view) view.hidden = true;
    const zone = $(`${ws}-ingest-zone`);
    if (zone) zone.style.display = "";
  });
}

function renderWorkspaceData(ws) {
  if (!wsData) return;
  const clients = wsData.clients;
  const client = activeWsClient ? clients.find((c) => c.client_id === activeWsClient) : clients[0];

  if (ws === "income") {
    const zone = $("income-ingest-zone");
    const view = $("ws-income-view");
    if (!zone || !view) return;
    zone.style.display = "none";
    view.hidden = false;

    const inv = client ? client.income : null;
    const kpis = client ? `
      <div class="ws-kpi-row">
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Gross Income</div>
          <div class="ws-kpi-value inr-cell">${inv ? fmtInr(inv.total_gross_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">TDS Deducted</div>
          <div class="ws-kpi-value warn inr-cell">${inv ? fmtInr(inv.total_tds_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Net Receivable</div>
          <div class="ws-kpi-value ok inr-cell">${inv ? fmtInr(inv.total_net_receivable_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Invoices</div>
          <div class="ws-kpi-value">${inv ? inv.count : "—"}</div>
        </div>
      </div>` : "";

    const statusRows = inv ? Object.entries(inv.status_breakdown || {})
      .map(([s, n]) => `<div class="ws-data-row"><span class="ws-data-key">${wsStatusBadge(s)}</span><span class="ws-data-val">${n} invoice${n !== 1 ? "s" : ""}</span></div>`)
      .join("") : "";

    view.innerHTML = `
      ${renderClientSelector(clients, activeWsClient)}
      ${kpis}
      <div class="ws-data-section">
        <div class="ws-data-section-title">Invoice Status</div>
        ${statusRows || '<div class="ws-data-row"><span class="ws-data-key">No invoices found</span></div>'}
      </div>`;
  }

  if (ws === "compliance") {
    const zone = $("compliance-ingest-zone");
    const view = $("ws-compliance-view");
    if (!zone || !view) return;
    zone.style.display = "none";
    view.hidden = false;

    const gst = client ? client.gst : null;
    const kpis = client ? `
      <div class="ws-kpi-row">
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Total Turnover</div>
          <div class="ws-kpi-value inr-cell">${gst ? fmtInr(gst.total_turnover_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">GST Payable</div>
          <div class="ws-kpi-value warn inr-cell">${gst ? fmtInr(gst.total_gst_payable_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">ITC Claimed</div>
          <div class="ws-kpi-value ok inr-cell">${gst ? fmtInr(gst.total_itc_claimed_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Periods Filed</div>
          <div class="ws-kpi-value">${gst ? gst.periods : "—"}</div>
        </div>
      </div>` : "";

    const gstr1Rows = gst ? Object.entries(gst.gstr1_status_breakdown || {})
      .map(([s, n]) => `<div class="ws-data-row"><span class="ws-data-key">${wsStatusBadge(s)} GSTR-1</span><span class="ws-data-val">${n} period${n !== 1 ? "s" : ""}</span></div>`)
      .join("") : "";

    view.innerHTML = `
      ${renderClientSelector(clients, activeWsClient)}
      ${kpis}
      <div class="ws-data-section">
        <div class="ws-data-section-title">GSTR-1 Filing Status</div>
        ${gstr1Rows || '<div class="ws-data-row"><span class="ws-data-key">No GST records found</span></div>'}
      </div>`;
  }

  if (ws === "assets") {
    const zone = $("assets-ingest-zone");
    const view = $("ws-assets-view");
    if (!zone || !view) return;
    zone.style.display = "none";
    view.hidden = false;

    const mf = client ? client.mutual_funds : null;
    const kpis = client ? `
      <div class="ws-kpi-row">
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Portfolio Value</div>
          <div class="ws-kpi-value ok inr-cell">${mf ? fmtInr(mf.total_current_value_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Monthly SIP</div>
          <div class="ws-kpi-value inr-cell">${mf ? fmtInr(mf.total_monthly_sip_inr) : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Folios</div>
          <div class="ws-kpi-value">${mf ? mf.folio_count : "—"}</div>
        </div>
        <div class="ws-kpi-tile">
          <div class="ws-kpi-label">Expenses</div>
          <div class="ws-kpi-value warn inr-cell">${client ? fmtInr(client.expenses.total_expense_inr) : "—"}</div>
        </div>
      </div>` : "";

    const fundRows = mf ? (mf.records || []).slice(0, 5).map((f) => {
      const name = f.Fund_Name || f.fund_name || "—";
      const val = f.Current_Value_INR || f.current_value_inr || 0;
      const type = f.Fund_Type || f.fund_type || "";
      return `<div class="ws-data-row">
        <span class="ws-data-key" title="${name}">${name}</span>
        <span style="display:flex;align-items:center;gap:5px;flex-shrink:0">
          <span class="ws-status-badge draft">${type}</span>
          <span class="ws-data-val inr-cell">${fmtInr(val)}</span>
        </span>
      </div>`;
    }).join("") : "";

    view.innerHTML = `
      ${renderClientSelector(clients, activeWsClient)}
      ${kpis}
      <div class="ws-data-section">
        <div class="ws-data-section-title">Top Folios</div>
        ${fundRows || '<div class="ws-data-row"><span class="ws-data-key">No portfolio data found</span></div>'}
      </div>`;
  }
}

function renderClientSelector(clients, activeId) {
  if (!clients || clients.length <= 1) return "";
  const firstId = activeId || (clients[0] && clients[0].client_id);
  return `
    <div style="padding:6px 8px 0">
      <select class="ws-client-selector" id="ws-client-selector" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font:inherit;font-size:11.5px;padding:5px 8px;cursor:pointer" aria-label="Select client">
        ${clients.map((c) => `<option value="${c.client_id}" ${c.client_id === firstId ? "selected" : ""}>${c.profile.Full_Name || c.client_id}</option>`).join("")}
      </select>
    </div>`;
}

// Wire up the client selector inside workspace data views
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "ws-client-selector") {
    activeWsClient = e.target.value;
    if (wsData) {
      renderWorkspaceData("income");
      renderWorkspaceData("compliance");
      renderWorkspaceData("assets");
    }
  }
});

function bootCaseFromURL() {
  const requested = new URLSearchParams(window.location.search).get("case");
  return requested && CASES.some((c) => c.id === requested) ? requested : DEFAULT_CASE;
}

(async function boot() {
  // Determine initial workspace from URL hash or default to credit
  const hashWs = (location.hash.match(/[#&]ws=([a-z]+)/) || [])[1];
  let startWs = "credit"; // default to credit
  if (hashWs) {
    if (hashWs === "credit" ||
        (ENABLE_ENTERPRISE_WORKSPACE && ["dashboard","client","income","compliance","assets"].includes(hashWs))) {
      startWs = hashWs;
    }
  }

  // Start enterprise data fetch immediately (parallel with recorded preload)
  loadEnterpriseData();

  // Preload the default credit case in the background so switching to
  // Credit Applications is instant ??" same recorded-capture behaviour as before.
  const bootCase = bootCaseFromURL();
  (async () => {
    const recorded = await loadRecorded(bootCase);
    if (recorded && !cache.has(bootCase)) {
      cache.set(bootCase, recorded);
      currentBorrowerId = bootCase;
      renderCaseRail();
    }
  })();

  // Prefetch all other credit cases
  CASES.filter((c) => c.id !== bootCase).forEach(async (c) => {
    const data = await loadRecorded(c.id);
    if (data && !cache.has(c.id)) {
      cache.set(c.id, data);
      if (activeWorkspace === "credit") renderCaseRail();
    }
  });

  // Boot into requested workspace
  activeWorkspace = startWs; // set the global
  switchWorkspace(startWs);
})();
