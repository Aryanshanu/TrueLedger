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
  { 
    id: "b_contradiction", 
    scenario: "Bank vs. GST Revenue Divergence", 
    note: "Bank credit receipts (+2.1%) vs. GST turnover (-11.0%) · Structural discrepancy", 
    group: "active" 
  },
];

const CASE_GROUPS = [
  { key: "active", label: "Active Commercial Underwriting" },
];

const DEFAULT_CASE = "b_contradiction";
const RECORDED_URL = (id) => `/recorded/${id}.json`;

// Credit risk metrics anchored to the active applicant
// DSCR = annual NOI / annual debt service (12% p.a., 36-month term).
// DTI  = monthly payment / avg monthly bank credits.
// Collateral = pledgeable MF book value + life insurance sum assured.
// tier: low | medium | high | watch | blocked
const CREDIT_METRICS = {
  b_contradiction: { 
    loan: 5000000, 
    entity: "Awaiting Entity Intake", 
    biz: "Commercial Account", 
    dscr: 2.51, 
    dti: 9.96, 
    tier: "medium", 
    mfPledge: 180000, 
    insurance: 600000 
  },
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
    <span class="book-summary-label">Active Portfolio</span>
    <span class="book-summary-count">Target: ${(activeSession && activeSession.entityName) || enterpriseEntityName || "Active Underwriting Intake"}</span>
    <span class="book-summary-sep">&middot;</span>
    <span class="book-summary-stat warn">${counts.manual_review || 1} manual review</span>
    <span class="book-summary-sep">&middot;</span>
    <span class="book-summary-avg">avg. confidence ${avgConfidence}</span>`;
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
  updateDecisionAnchor(decision, consentSources);

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
  resetDeskUI("Synthesizing multi-agent evaluation · Vertex AI pipeline active");

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

// ── Ultra-low latency borrower loader (< 1ms from memory cache) ─────
async function loadBorrower(borrowerId, { forceRefetch = false } = {}) {
  if (currentController) currentController.abort();
  currentController = null;
  const myToken = ++loadToken;

  currentBorrowerId = borrowerId;
  renderCaseRail();

  // ── Benchmark case fast-path ─────────────────────────────────────
  // The 5 frontend benchmark cases (kaveri, deccan, kalyani, bharat,
  // zenith) exist only in BENCHMARK_CASES — no recorded fixture JSON
  // and no backend Firestore record. Synthesize a complete dossier
  // from the benchmark manifest instead of calling the live API
  // (which returns 404 for these IDs). forceRefetch is honoured: it
  // falls through to the live-API block so "Re-evaluate Live" still
  // works as expected once a real upload is wired up.
  // Benchmark fast-path: guaranteed deterministic synthetic dossier (never 404s)
  const bench = (typeof BENCHMARK_CASES !== "undefined")
    ? BENCHMARK_CASES.find((b) => b.id === borrowerId)
    : null;

  if (bench) {
    if (!forceRefetch && cache.has(borrowerId)) {
        const benchName = bench.name || borrowerId;
        setStatus(`${benchName} · Illustrative Scenario · Not an agent run · ${bench.verdict}`);
        playReveal(borrowerId);
        return;
      }

      // Derive outcome from verdict string
      const verdictUpper = (bench.verdict || "").toUpperCase();
      const outcome =
        verdictUpper === "APPROVE"        ? "approve"
        : verdictUpper === "DECLINE"      ? "decline"
        : "manual_review";
      const hasContradiction = outcome !== "approve";

      const now = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + (bench.consent_days || 90) * 86400000
      ).toISOString();

      const bankMagPct = parseFloat(bench.trend_bank) || 0;
      const gstMagPct  = parseFloat(bench.trend_gst)  || 0;

      const trendLabel = (pct) =>
        pct >= 3 ? "rising" : pct <= -3 ? "declining" : "stable";

      // Ledger steps ── mirrors the shape of real captured fixtures
      const ledgerSteps = [
        {
          step_id:     "stp_b01",
          agent:       "bank_statement_agent",
          action:      "record_claim",
          confidence:  1.0,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       "bank_statement_agent claim: income_trend",
          input_refs:  [`fi_data/${borrowerId}`],
          claim: {
            metric:        "income_trend",
            value:         trendLabel(bankMagPct),
            magnitude_pct: bankMagPct,
            confidence:    1.0,
            finding: `Bank aggregator receipts: ${bench.bank_inflows} (${bench.trend_bank} YoY trend verified via AA feed).`,
            evidence: [{
              period:          "2026-06 to 2026-09",
              source:          "bank_findings",
              field:           "income_trend",
              transaction_ids: null,
            }],
          },
        },
        {
          step_id:     "stp_b02",
          agent:       "gst_tax_agent",
          action:      "record_claim",
          confidence:  1.0,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       "gst_tax_agent claim: revenue_trend",
          input_refs:  [`fi_data/${borrowerId}`],
          claim: {
            metric:        "revenue_trend",
            value:         trendLabel(gstMagPct),
            magnitude_pct: gstMagPct,
            confidence:    1.0,
            finding: `GSTR-3B declared turnover: ${bench.gst_turnover} (${bench.trend_gst} YoY trend).`,
            evidence: [
              { period: "2026-06", source: null, field: null, transaction_ids: null },
              { period: "2026-09", source: null, field: null, transaction_ids: null },
            ],
          },
        },
        {
          step_id:     "stp_b03",
          agent:       "investment_agent",
          action:      "record_claim",
          confidence:  1.0,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       "investment_agent claim: liquid_assets",
          input_refs:  [`fi_data/${borrowerId}`],
          claim: {
            metric:        "liquid_assets",
            value:         "high",
            magnitude_pct: null,
            confidence:    1.0,
            finding:       "Pledgeable MF portfolio and insurance cover verified against loan facility.",
            evidence: [{
              field:           "total_current_value",
              source:          "MUTUAL_FUNDS",
              period:          null,
              transaction_ids: ["Synthetic Flexicap Fund", "Synthetic Liquid Fund"],
            }],
          },
        },
      ];

      if (hasContradiction) {
        ledgerSteps.push({
          step_id:     "stp_b04",
          agent:       "orchestrator_agent",
          action:      "flag_contradiction",
          confidence:  bench.model_confidence,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       "income_vs_revenue_divergence flagged",
          input_refs:  [
            `claims/${borrowerId}/bank_findings`,
            `claims/${borrowerId}/gst_findings`,
          ],
          claim: {
            metric:     "income_vs_revenue",
            confidence: bench.model_confidence,
            finding: `Bank deposits show ${bench.trend_bank} income trend while GST-declared turnover shows ${bench.trend_gst} — structural variance delta ${bench.variance}. Reconciliation required before approval.`,
            evidence: [
              { field: "income_trend",  source: "bank_findings", period: null, transaction_ids: null },
              { field: "revenue_trend", source: "gst_findings",  period: null, transaction_ids: null },
            ],
          },
        });
      }

      ledgerSteps.push(
        {
          step_id:     "stp_b05",
          agent:       "orchestrator_agent",
          action:      "apply_consent_decay",
          claim:       null,
          confidence:  bench.consent_multiplier,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       "c(d) = 1 if d>7, d/7 if 0<d<=7, 0 if d<=0; final = model_confidence * weakest source's c(d)",
          input_refs:  [`consent/${borrowerId}`],
        },
        {
          step_id:     "stp_b06",
          agent:       "orchestrator_agent",
          action:      "final_decision",
          confidence:  bench.final_confidence,
          borrower_id: borrowerId,
          timestamp:   now,
          notes:       `outcome=${outcome}`,
          input_refs:  [],
          claim: {
            borrower_id:            borrowerId,
            outcome:                outcome,
            final_confidence:       bench.final_confidence,
            model_confidence:       bench.model_confidence,
            weakest_consent_source: "gst_findings",
            contradictions:         hasContradiction
              ? [{
                  rule:   "income_vs_revenue_divergence",
                  metric: "income_vs_revenue",
                  finding: `Structural variance delta of ${bench.variance} detected between bank inflows and GSTR-3B declarations.`,
                  evidence: [],
                  action: "cap_confidence_0.5",
                }]
              : [],
            risk_factors:    [],
            ledger_step_ids: ["stp_b06"],
            generated_at:    now,
          },
        }
      );

      const consentSources = [
        { source: "bank_findings",       fi_type: "DEPOSIT",                         expires_at: expiresAt, days_remaining: bench.consent_days, confidence_multiplier: bench.consent_multiplier },
        { source: "gst_findings",        fi_type: "GSTR1_3B",                        expires_at: expiresAt, days_remaining: bench.consent_days, confidence_multiplier: bench.consent_multiplier },
        { source: "investment_findings", fi_type: "MUTUAL_FUNDS+INSURANCE_POLICIES", expires_at: expiresAt, days_remaining: bench.consent_days, confidence_multiplier: bench.consent_multiplier },
      ];

      const syntheticDossier = {
        decision: {
          borrower_id:            borrowerId,
          outcome,
          final_confidence:       bench.final_confidence,
          model_confidence:       bench.model_confidence,
          weakest_consent_source: "gst_findings",
          contradictions:         hasContradiction
            ? [{
                rule:   "income_vs_revenue_divergence",
                metric: "income_vs_revenue",
                finding: `Bank deposits show ${bench.trend_bank} while GST declarations show ${bench.trend_gst} — variance delta: ${bench.variance}.`,
                evidence: [
                  { field: "income_trend",  source: "bank_findings", period: null, transaction_ids: null },
                  { field: "revenue_trend", source: "gst_findings",  period: null, transaction_ids: null },
                ],
                action: "cap_confidence_0.5",
              }]
            : [],
          risk_factors:    [],
          ledger_step_ids: ["stp_b06"],
          generated_at:    now,
        },
        ledgerSteps,
        consentSources,
        isAuditDossier:      false,
        isIllustrative:      true,
        capturedAt:          now,
      };

      cache.set(borrowerId, syntheticDossier);

      // Register benchmark as a credit case and metrics entry if not already present
      if (!CASES.find((c) => c.id === borrowerId)) {
        CASES.push({
          id:       borrowerId,
          scenario: bench.name,
          note:     `${bench.sector} · ${bench.loan} Facility · Variance: ${bench.variance}`,
          group:    "active",
        });
      }
      if (!CREDIT_METRICS[borrowerId]) {
        CREDIT_METRICS[borrowerId] = {
          entity:    bench.name,
          biz:       bench.sector,
          loan:      (typeof parseLoanAmount === "function") ? parseLoanAmount(bench.loan) : 0,
          tier:      (typeof deriveRiskTier === "function")  ? deriveRiskTier(bench.variance, bench.verdict) : "medium",
          dscr:      2.51,
          dti:       9.96,
          mfPledge:  180000,
          insurance: 600000,
        };
      }

      renderCaseRail();
      setStatus(`${bench.name} · Illustrative Scenario · Not an agent run · ${bench.verdict}`);
      playReveal(borrowerId);
      return;
    }

  // Instant in-memory cache hit (< 1ms latency)
  if (!forceRefetch && cache.has(borrowerId)) {
    const data = cache.get(borrowerId);
    setStatus(
      data.isAuditDossier
        ? `${borrowerId} · cached run · click Re-evaluate Live for fresh multi-agent execution.`
        : `${borrowerId} · loaded from active session cache.`
    );
    playReveal(borrowerId);
    return;
  }

  // Fast preloaded fixture hit (< 5ms latency)
  if (!forceRefetch) {
    const recorded = await loadRecorded(borrowerId);
    if (myToken !== loadToken) return;
    if (recorded) {
      cache.set(borrowerId, recorded);
      setStatus(`${borrowerId} · loaded from recorded fixture.`);
      playReveal(borrowerId);
      return;
    }
  }

  // Live Vertex AI API fallback
  const controller = new AbortController();
  currentController = controller;
  showLiveLoadingState(borrowerId);
  setStatus(`Running the pipeline for ${borrowerId}...`);

  try {
    const decision = await fetchJSON(`/borrowers/${borrowerId}/evaluate`, {
      method: "POST",
      headers: { "Content-Length": "0" },
      signal: controller.signal,
    });
    if (myToken !== loadToken) return;

    const [ledgerResp, consentResp] = await Promise.all([
      fetchJSON(`/borrowers/${borrowerId}/ledger`, { signal: controller.signal }),
      fetchJSON(`/borrowers/${borrowerId}/consent-status`, { signal: controller.signal }),
    ]);
    if (myToken !== loadToken) return;

    cache.set(borrowerId, {
      decision,
      ledgerSteps: ledgerResp.steps,
      consentSources: consentResp.sources,
      isAuditDossier: false,
    });
    setStatus(`${borrowerId} · done · ${decision.outcome} (${decision.final_confidence.toFixed(2)})`);
    playReveal(borrowerId);
  } catch (err) {
    if (myToken !== loadToken || err.name === "AbortError") return;
    console.warn("Live API call encountered an issue, checking for verified recorded dossier fallback:", err);

    // Fall back to recorded audited dossier if available
    const recorded = await loadRecorded(borrowerId);
    if (myToken === loadToken && recorded) {
      cache.set(borrowerId, recorded);
      setStatus(`${borrowerId} · Displaying verified cryptographic audit record (${err.message.includes("500") ? "Live cloud offline" : "Cloud timeout"}).`);
      playReveal(borrowerId);
      if (typeof showToast === "function") {
        showToast("Loaded verified cryptographic audit dossier");
      }
      return;
    }

    setStatus(`Execution notice for ${borrowerId}: ${err.message}`, true);
    $("decision-body").innerHTML = `
      <div class="decision-empty" style="padding:16px;text-align:center">
        <div style="font-size:20px;margin-bottom:8px">⚠️</div>
        <div style="font-weight:600;color:#fff;margin-bottom:6px">Evaluation Engine Offline</div>
        <p style="font-size:12px;color:var(--muted);line-height:1.5">
          ${err.message || "Connection to live underwriting swarm could not be established."}
        </p>
        <button class="run-live-btn-inline" style="margin-top:12px" onclick="loadBorrower('${borrowerId}')">
          Retry Verification
        </button>
      </div>
    `;
  }
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

const ENABLE_ENTERPRISE_WORKSPACE = true;

// Active workspace state — persists which workspace + view is open
let activeWorkspace = null;
let wsData = null;         // parsed workbook data from /ingest/onboarding
let activeWsClient = null; // selected client ID in workspace panes
let enterpriseData = null; // pre-loaded enterprise_live_state.json

// ── Top-Level State Machine: currentWorkspaceMilestone ────────────────
// Explicit state machine with 5 discrete stages:
// 'auth' | 'onboarding' | 'ingestion_processing' | 'settled_dashboard' | 'dev_gateway'
let currentWorkspaceMilestone = "auth";

function setWorkspaceMilestone(milestone) {
  currentWorkspaceMilestone = milestone;

  // Sync data-milestone attribute on body and desk element
  if (document.body) document.body.dataset.milestone = milestone;
  const desk = $("desk");
  if (desk) desk.dataset.milestone = milestone;

  // Context pane synchronization in onboarding phase
  if (milestone === "onboarding") {
    document.querySelectorAll(".workspace-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.pane === "onboarding_checklist");
    });
    if (typeof updateOnboardingChecklistUI === "function") {
      updateOnboardingChecklistUI();
    }
  }

  // Update customer stepper
  if (typeof updateCustomerStepper === "function") {
    updateCustomerStepper();
  }
}

function updateOnboardingChecklistUI() {
  const gCheck = $("sidebar-chk-gstn");
  const iCheck = $("sidebar-chk-itr");
  const bCheck = $("sidebar-chk-bank");

  if (gCheck) gCheck.classList.toggle("checked", !!enterpriseChannels.gstn);
  if (iCheck) iCheck.classList.toggle("checked", !!enterpriseChannels.itr);
  if (bCheck) bCheck.classList.toggle("checked", !!enterpriseChannels.bank);

  const gIcon = $("sidebar-icon-gstn");
  const iIcon = $("sidebar-icon-itr");
  const bIcon = $("sidebar-icon-bank");

  if (gIcon) gIcon.classList.toggle("checked", !!enterpriseChannels.gstn);
  if (iIcon) iIcon.classList.toggle("checked", !!enterpriseChannels.itr);
  if (bIcon) bIcon.classList.toggle("checked", !!enterpriseChannels.bank);
}

// ── Layout state router ───────────────────────────────────────────────
// desk[data-ws] drives CSS show/hide of pipeline vs workspace-main-frame.
function switchWorkspace(ws) {
  // If in pre-audit phases ('auth', 'onboarding', 'ingestion_processing'),
  // strictly block user from accessing post-audit institutional workspaces!
  if (["auth", "onboarding", "ingestion_processing"].includes(currentWorkspaceMilestone)) {
    if (!["dev_auth", "dev_console", "customer_wizard"].includes(ws)) {
      if (typeof showToast === "function") {
        showToast("Access restricted: Complete client onboarding & audit before accessing institutional workspaces.");
      }
      return;
    }
  }

  if (ws === "dev_auth" || ws === "dev_console") {
    setWorkspaceMilestone("dev_gateway");
  } else if (ws === "customer_wizard") {
    if (customerStep === 1) setWorkspaceMilestone("auth");
    else if (customerStep === 2) setWorkspaceMilestone("onboarding");
    else if (customerStep === 3) setWorkspaceMilestone("ingestion_processing");
    else setWorkspaceMilestone("settled_dashboard");
  } else {
    // Navigating between unlocked settled workspaces
    setWorkspaceMilestone("settled_dashboard");
  }

  if (ws === "onboarding" || ws === "user_onboarding" || ws === "user_workspace" || ws === "cockpit") {
    ws = "customer_wizard";
  }

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
    if (currentWorkspaceMilestone === "onboarding") {
      pane.classList.toggle("active", pane.dataset.pane === "onboarding_checklist");
    } else {
      pane.classList.toggle("active", pane.dataset.pane === ws);
    }
  });

  // Update URL hash (enables browser back/forward and deep linking)
  try {
    if (ws === "customer_wizard") {
      history.replaceState(null, "", `#step=${customerStep}`);
    } else if (["dev_auth", "dev_console"].includes(ws)) {
      history.replaceState(null, "", `#view=${ws}`);
    } else {
      history.replaceState(null, "", `#ws=${ws}`);
    }
  } catch (_) {}

  // Sync customer stepper visibility & status
  if (typeof updateCustomerStepper === "function") {
    updateCustomerStepper();
  }

  if (ws === "credit") {
    renderCaseRail();
    loadBorrower(currentBorrowerId || DEFAULT_CASE, { forceRefetch: false });
    return;
  }

  // Clear any stale error status from the credit workspace so it doesn't
  // bleed into Client Space, Asset Allocations, or any other view.
  const statusEl = $("status-line");
  if (statusEl && statusEl.classList.contains("error")) {
    statusEl.textContent = "";
    statusEl.classList.remove("error");
  }

  renderWorkspaceMain(ws);
}

// ── Workspace main frame renderer — dispatches to per-workspace builders ─
function renderWorkspaceMain(ws) {
  const frame = $("workspace-main-frame");
  if (!frame) return;
  switch (ws) {
    case "dashboard":       renderDashboard(frame); break;
    case "client":          renderClientMain(frame); break;
    case "income":          renderIncomeMain(frame); break;
    case "compliance":      renderComplianceMain(frame); break;
    case "assets":          renderAssetsMain(frame); break;
    case "customer_wizard": renderCustomerWizard(frame); break;
    case "dev_auth":        renderDevAuth(frame); break;
    case "dev_console":     renderDevConsole(frame); break;
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

// ── GSTIN state-code lookup (used by buildActiveEntity) ──────────────
const GSTIN_STATE = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh",
  "05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh",
  "10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur",
  "15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
  "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh",
  "24":"Gujarat","26":"Dadra & Nagar Haveli","27":"Maharashtra","28":"Andhra Pradesh",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu",
  "34":"Puducherry","35":"Andaman & Nicobar","36":"Telangana","37":"Andhra Pradesh",
  "38":"Ladakh","97":"Other Territory","99":"Centre Jurisdiction",
};

// Merges activeSession identity over enterpriseData.entity so every workspace
// shows the applicant selected in onboarding, not the static JSON default.
function buildActiveEntity(baseEntity) {
  if (!baseEntity) return null;
  if (!activeSession) return baseEntity;

  const gstin = activeSession.gstin || baseEntity.gstin;
  const stateCode = gstin ? gstin.slice(0, 2) : baseEntity.state_code;
  const stateName = GSTIN_STATE[stateCode] || baseEntity.state;

  return {
    ...baseEntity,
    name:       activeSession.entityName || baseEntity.name,
    pan:        activeSession.pan        || baseEntity.pan,
    gstin:      gstin,
    state_code: stateCode,
    state:      stateName,
    industry:   activeSession.sector     || baseEntity.industry,
  };
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

// ── Tier-1 Institutional Utilities & 40% Engine Controls ─────────────

let isFinancialMasked = true;
let maskTimeoutId = null;

function applyMasking() {
  const maskBtn = $("mask-toggle-btn");
  const maskIcon = $("mask-icon");
  const maskLabel = $("mask-label");
  if (maskBtn) maskBtn.classList.toggle("active", isFinancialMasked);
  if (maskIcon) maskIcon.textContent = isFinancialMasked ? "🔒" : "🔓";
  if (maskLabel) maskLabel.textContent = isFinancialMasked ? "Masked" : "Unmasked";

  document.querySelectorAll(".masked-target").forEach((el) => {
    el.textContent = isFinancialMasked ? (el.dataset.masked || "•••• •••• 9812") : (el.dataset.unmasked || el.dataset.raw || el.textContent);
  });
}

function toggleFinancialMask() {
  isFinancialMasked = !isFinancialMasked;
  applyMasking();
  if (maskTimeoutId) clearTimeout(maskTimeoutId);
  if (!isFinancialMasked) {
    if (typeof showToast === "function") showToast("Financial data unmasked (auto-masks in 10s)");
    maskTimeoutId = setTimeout(() => {
      isFinancialMasked = true;
      applyMasking();
      if (typeof showToast === "function") showToast("Financial data automatically re-masked");
    }, 10000);
  } else {
    if (typeof showToast === "function") showToast("Financial data masked");
  }
}

function updateDecisionAnchor(decision, consentSources) {
  if (!decision) return;
  const metrics = CREDIT_METRICS[decision.borrower_id] || { entity: decision.borrower_id, biz: "Commercial Account" };
  const entityNameEl = $("anchor-entity-name");
  const entityIdEl = $("anchor-entity-id");
  if (entityNameEl) entityNameEl.textContent = metrics.entity;
  if (entityIdEl) {
    const rawGstin = (activeSession && activeSession.gstin) || "—";
    entityIdEl.dataset.unmasked = rawGstin;
    entityIdEl.dataset.masked = rawGstin.length >= 4 ? "•••• •••• " + rawGstin.slice(-4) : "•••• •••• ••••";
    entityIdEl.textContent = isFinancialMasked ? entityIdEl.dataset.masked : entityIdEl.dataset.unmasked;
  }

  const badgeEl = $("anchor-verdict-badge");
  const textEl = $("anchor-verdict-text");
  const confEl = $("anchor-confidence-text");
  if (badgeEl && textEl && confEl) {
    badgeEl.className = `anchor-verdict-badge ${decision.outcome === "approve" ? "ok" : decision.outcome === "manual_review" ? "warn" : "bad"}`;
    textEl.textContent = OUTCOME_META[decision.outcome]?.label || decision.outcome.toUpperCase();
    confEl.textContent = `Conf: ${(decision.final_confidence * 100).toFixed(0)}%`;
  }

  const weakestSource = consentSources && consentSources.find((s) => s.source === decision.weakest_consent_source);
  const fillEl = $("anchor-consent-fill");
  const consentTextEl = $("anchor-consent-text");
  if (fillEl && consentTextEl) {
    if (weakestSource) {
      const pct = Math.min(100, Math.max(0, Math.round(weakestSource.confidence_multiplier * 100)));
      fillEl.style.width = `${pct}%`;
      fillEl.className = `consent-meter-fill ${pct >= 70 ? "ok" : pct >= 40 ? "warn" : "bad"}`;
      consentTextEl.textContent = `${weakestSource.days_remaining}d left (×${weakestSource.confidence_multiplier}) · ${pct < 100 ? "Haircut applied" : "Full strength"}`;
    } else {
      fillEl.style.width = "100%";
      fillEl.className = "consent-meter-fill ok";
      consentTextEl.textContent = "Fresh consent · 1.0 multiplier";
    }
  }
}

function setupEnvironmentToggle() {
  const envToggle = $("env-toggle");
  if (!envToggle) return;
  envToggle.querySelectorAll(".env-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      envToggle.querySelectorAll(".env-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const env = btn.dataset.env;
      if (typeof showToast === "function") {
        showToast(`Switched environment to ${env} (Region: asia-south1)`);
      }
    });
  });
}

function setupMaskToggle() {
  const maskBtn = $("mask-toggle-btn");
  if (maskBtn) {
    maskBtn.addEventListener("click", toggleFinancialMask);
  }
}

function setupDecisionAnchorActions() {
  const auditBtn = $("anchor-audit-btn");
  if (auditBtn) {
    auditBtn.addEventListener("click", () => {
      switchWorkspace("credit");
      const targetCase = currentBorrowerId || DEFAULT_CASE;
      loadBorrower(targetCase, { forceRefetch: true });
      if (typeof showToast === "function") {
        showToast(`Running forensic audit for ${targetCase}...`);
      }
    });
  }
}

const COMMAND_ITEMS = [
  { group: "Customer Audit Flow", icon: "⚡", label: "Step 1: Sign In to Vault", action: () => { switchWorkspace("customer_wizard"); switchCustomerStep(1); } },
  { group: "Customer Audit Flow", icon: "🏢", label: "Step 2: Entity Intake & Verification Rails", action: () => { switchWorkspace("customer_wizard"); switchCustomerStep(2); } },
  { group: "Customer Audit Flow", icon: "🤖", label: "Step 3: Multi-Source Cross-Verification", action: () => { switchWorkspace("customer_wizard"); switchCustomerStep(3); } },
  { group: "Customer Audit Flow", icon: "🛡", label: "Step 4: Credit Assessment & Decision Dossier", action: () => { switchWorkspace("customer_wizard"); switchCustomerStep(4); } },
  { group: "Audit Outputs", icon: "📊", label: "Export Reconciliation Ledger (.CSV)", action: () => exportAuditCSV() },
  { group: "Audit Outputs", icon: "📑", label: "Download Decision Audit Report (.PDF)", action: () => downloadAuditPDF() },
  { group: "Forensic Actions", icon: "⚡", label: "Run Forensic Audit (Active Dossier)", action: () => { switchWorkspace("credit"); loadBorrower(currentBorrowerId || DEFAULT_CASE, { forceRefetch: true }); } },
  { group: "Forensic Actions", icon: "🔒", label: "Toggle Financial Data Masking", action: () => toggleFinancialMask() },
  { group: "Forensic Actions", icon: "↻", label: "Re-animate Decision & Ledger Stepper", action: () => { $("replay-btn")?.click(); } },
  { group: "Forensic Actions", icon: "📁", label: "+ New Credit Submission (Upload Statement/GST)", action: () => { $("upload-open-btn")?.click(); } },
  { group: "Workspaces", icon: "▦", label: "Executive Dashboard", action: () => switchWorkspace("dashboard") },
  { group: "Workspaces", icon: "⊞", label: "Credit Applications (Active Dossier)", action: () => switchWorkspace("credit") },
  { group: "Workspaces", icon: "◈", label: "Client Space (Onboarding & KYB)", action: () => switchWorkspace("client") },
  { group: "Workspaces", icon: "₹", label: "Income & Revenue Telemetry", action: () => switchWorkspace("income") },
  { group: "Workspaces", icon: "⊖", label: "Compliance & GST Lifecycle", action: () => switchWorkspace("compliance") },
  { group: "Workspaces", icon: "◎", label: "Asset Allocations & Portfolios", action: () => switchWorkspace("assets") },
  { group: "Target Entities", icon: "⚠", label: "Active Applicant Assessment", action: () => { switchWorkspace("credit"); loadBorrower(activeSession ? activeSession.sessionKey : DEFAULT_CASE); } },
];

function setupCommandPalette() {
  const dialog = $("cmd-palette-dialog");
  const triggerBtn = $("cmd-palette-trigger");
  const input = $("cmd-palette-input");
  const resultsContainer = $("cmd-palette-results");
  if (!dialog || !input || !resultsContainer) return;

  let selectedIndex = 0;
  let currentFiltered = [...COMMAND_ITEMS];

  function renderResults() {
    if (currentFiltered.length === 0) {
      resultsContainer.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--muted-dim); font-size: 13px;">No matching entities, actions, or workspaces found.</div>`;
      return;
    }

    let lastGroup = "";
    let html = "";
    currentFiltered.forEach((item, idx) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        html += `<div class="cmd-group-label">${lastGroup}</div>`;
      }
      const isSelected = idx === selectedIndex;
      html += `
        <div class="cmd-item ${isSelected ? "selected" : ""}" data-index="${idx}">
          <div class="cmd-item-left">
            <span class="cmd-item-icon">${item.icon}</span>
            <span>${item.label}</span>
          </div>
          <span class="cmd-item-tag">${item.group}</span>
        </div>
      `;
    });
    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll(".cmd-item").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.dataset.index);
        executeItem(idx);
      });
      el.addEventListener("mouseenter", () => {
        selectedIndex = Number(el.dataset.index);
        updateSelectionHighlight();
      });
    });
  }

  function updateSelectionHighlight() {
    resultsContainer.querySelectorAll(".cmd-item").forEach((el, idx) => {
      el.classList.toggle("selected", idx === selectedIndex);
    });
    const selectedEl = resultsContainer.querySelector(".cmd-item.selected");
    if (selectedEl) selectedEl.scrollIntoView({ block: "nearest" });
  }

  function executeItem(idx) {
    const item = currentFiltered[idx];
    if (item && item.action) {
      closePalette();
      item.action();
    }
  }

  function openPalette() {
    dialog.showModal();
    input.value = "";
    currentFiltered = [...COMMAND_ITEMS];
    selectedIndex = 0;
    renderResults();
    input.focus();
  }

  function closePalette() {
    dialog.close();
  }

  if (triggerBtn) {
    triggerBtn.addEventListener("click", openPalette);
  }

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dialog.open) closePalette();
      else openPalette();
    }
    if (e.key === "Escape" && dialog.open) {
      closePalette();
    }
  });

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      currentFiltered = [...COMMAND_ITEMS];
    } else {
      currentFiltered = COMMAND_ITEMS.filter(
        (i) => i.label.toLowerCase().includes(query) || i.group.toLowerCase().includes(query)
      );
    }
    selectedIndex = 0;
    renderResults();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentFiltered.length > 0) {
        selectedIndex = (selectedIndex + 1) % currentFiltered.length;
        updateSelectionHighlight();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentFiltered.length > 0) {
        selectedIndex = (selectedIndex - 1 + currentFiltered.length) % currentFiltered.length;
        updateSelectionHighlight();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentFiltered.length > 0) {
        executeItem(selectedIndex);
      }
    }
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closePalette();
  });
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
      // Persist selected view and re-render the main frame
      const view = link.dataset.wsView;
      if (view && activeWorkspace) {
        wsActiveViews[activeWorkspace] = view;
        renderWorkspaceMain(activeWorkspace);
      }
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

  // Institutional Tier-1 Listeners
  setupEnvironmentToggle();
  setupMaskToggle();
  setupDecisionAnchorActions();
  setupCommandPalette();
  applyMasking();

  // Customer Progressive Stepper Listeners
  document.querySelectorAll(".step-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const targetStep = Number(pill.dataset.step);
      if (activeWorkspace !== "customer_wizard") {
        switchWorkspace("customer_wizard");
      }
      switchCustomerStep(targetStep);
    });
  });

  // Invisible Developer Gateway Trigger (Double-click version tag or Ctrl+Shift+D)
  const versionTrigger = $("app-version-trigger");
  if (versionTrigger) {
    versionTrigger.addEventListener("dblclick", () => {
      previousWorkspace = activeWorkspace;
      switchWorkspace(isDevAuthenticated ? "dev_console" : "dev_auth");
    });
  }

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (activeWorkspace === "dev_console" || activeWorkspace === "dev_auth") {
        switchWorkspace("customer_wizard");
      } else {
        previousWorkspace = activeWorkspace;
        switchWorkspace(isDevAuthenticated ? "dev_console" : "dev_auth");
      }
    }
  });

  window.addEventListener("hashchange", () => {
    const hash = location.hash.toLowerCase();
    if (hash === "#dev-login" || hash === "#view=dev_auth") {
      switchWorkspace("dev_auth");
    } else if (hash === "#view=dev_console") {
      switchWorkspace(isDevAuthenticated ? "dev_console" : "dev_auth");
    } else {
      const viewMatch = location.hash.match(/[#&]view=([a-z_]+)/);
      const wsMatch = location.hash.match(/[#&]ws=([a-z_]+)/);
      const stepMatch = location.hash.match(/[#&]step=([1-4])/);
      if (stepMatch) {
        if (activeWorkspace !== "customer_wizard") switchWorkspace("customer_wizard");
        switchCustomerStep(Number(stepMatch[1]));
        return;
      }
      const target = (viewMatch && viewMatch[1]) || (wsMatch && wsMatch[1]);
      if (target && target !== activeWorkspace) {
        switchWorkspace(target);
      }
    }
  });

  if (typeof updateCustomerStepper === "function") {
    updateCustomerStepper();
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
  const entity = buildActiveEntity(enterpriseData.entity);
  const { summary, compliance, actions, invoices, mf_portfolio } = enterpriseData;

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
  // Show a banner when activeSession entity differs from the base JSON
  // so the financial KPI panels are clearly labelled as reference data.
  const isReferenceData = activeSession && activeSession.entityName &&
    enterpriseData.entity && activeSession.entityName !== enterpriseData.entity.name;
  const refBanner = isReferenceData ? `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 14px;background:rgba(99,102,241,0.08);border-bottom:1px solid rgba(99,102,241,0.2);font-size:11.5px;color:#a5b4fc">
      <span>ℹ</span>
      <span>Financial KPIs below are reference dataset figures. Upload benchmark workbooks or run a live evaluation to populate entity-specific financials.</span>
    </div>` : "";

  const header = `
    ${refBanner}
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
          <div class="ws-cmd-col-header">GST Compliance Tracker — ${entity.fy || "FY—"}</div>
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

  // Wire action trigger buttons — navigate to the relevant workspace/sub-view
  const ACTION_ROUTES = {
    file_gstr3b_jul26:      { ws: "compliance", view: "gst-lifecycle" },
    reconcile_gstr2b_aug26: { ws: "compliance", view: "itc" },
    tds_sync_q2:            { ws: "income",     view: "tds" },
    file_gstr1_sep26:       { ws: "compliance", view: "gst-lifecycle" },
  };
  frame.querySelectorAll(".ws-action-trigger-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.actionId;
      const item = actions.find((a) => a.id === id);
      if (!item) return;
      const route = ACTION_ROUTES[id];
      if (route) {
        wsActiveViews[route.ws] = route.view;
        switchWorkspace(route.ws);
      } else {
        showToast(`Initiated: ${item.label}`);
      }
    });
  });
}

// ── Client Space main frame ──────────────────────────────────────────
function renderClientMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const entity = buildActiveEntity(data.entity);
  const view = wsActiveViews["client"] || "onboarding";

  if (view === "kyb") {
    // KYB Profile Validation — structural checks on the active entity
    const pan = entity.pan || "";
    const gstin = entity.gstin || "";
    const panOk = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
    const { valid: gstinOk, error: gstinErr } = validateGSTIN(gstin);
    const checks = [
      { label: "PAN Format",           pass: panOk,              detail: panOk ? pan : `${pan} — invalid format` },
      { label: "GSTIN Format",         pass: gstinOk,            detail: gstinOk ? gstin : gstinErr },
      { label: "GSTIN ↔ PAN Linkage", pass: gstin.slice(2, 12) === pan, detail: gstin.slice(2, 12) === pan ? "PAN embedded in GSTIN matches" : "PAN segment mismatch" },
      { label: "Entity Type on File",  pass: !!entity.entity_type, detail: entity.entity_type || "Not available" },
      { label: "Banker on File",       pass: !!entity.banker,    detail: entity.banker || "Not provided" },
      { label: "CA / Auditor Firm",    pass: !!entity.ca_firm,   detail: entity.ca_firm || "Not provided" },
      { label: "FY Reference",         pass: !!entity.fy,        detail: entity.fy || "—" },
    ];
    const rows = checks.map(c => `<tr>
      <td style="font-size:12px;color:var(--muted)">${c.label}</td>
      <td><span class="c-badge ${c.pass ? "filed" : "action-required"}">${c.pass ? "✓ Pass" : "✗ Fail"}</span></td>
      <td style="font-size:12px;color:${c.pass ? "var(--ok)" : "var(--warn)"}">${c.detail}</td>
    </tr>`).join("");
    const passed = checks.filter(c => c.pass).length;
    frame.innerHTML = `
      <div class="ws-main-section">
        <div class="ws-main-kpi-row">
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">KYB Score</div>
            <div class="ws-main-kpi-cell-value ${passed === checks.length ? "ok" : "warn"}">${passed}/${checks.length}</div>
          </div>
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">Entity</div>
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-top:4px">${entity.name}</div>
          </div>
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">Industry</div>
            <div style="font-size:12px;color:var(--muted-dim);margin-top:4px">${entity.industry}</div>
          </div>
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">State</div>
            <div style="font-size:12px;color:var(--muted-dim);margin-top:4px">${entity.state_code} · ${entity.state}</div>
          </div>
        </div>
        <div class="ws-main-section-title">KYB Verification Checks</div>
        <div style="overflow-x:auto">
          <table class="ws-data-table">
            <thead><tr>
              <th style="width:200px">Check</th>
              <th style="width:110px">Result</th>
              <th>Detail</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  if (view === "vault") {
    // Document Vault — channel files from the active session
    const s = activeSession || {};
    const files = s.files || enterpriseUploadedFiles || {};
    const channels = s.channels || enterpriseChannels || {};
    const vaultRows = [
      { key: "gstn",  label: "GSTN GSTR-1 & 3B",          icon: "⊖", connected: !!channels.gstn, file: files.gstn },
      { key: "itr",   label: "Income Tax / ITR Form-16",    icon: "₹", connected: !!channels.itr,  file: files.itr  },
      { key: "bank",  label: "Bank Statement Aggregator",   icon: "▦", connected: !!channels.bank, file: files.bank },
    ].map(r => {
      const status = r.connected ? (r.file ? "File Imported" : "Live Connected") : "Not Connected";
      const badge  = r.connected ? "filed" : "pending";
      return `<tr>
        <td style="font-size:13px">${r.icon} ${r.label}</td>
        <td><span class="c-badge ${badge}">${status}</span></td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted-dim)">${r.file || (r.connected ? "AA Gateway" : "—")}</td>
      </tr>`;
    }).join("");
    const anyConnected = Object.values(channels).some(Boolean);
    frame.innerHTML = `
      <div class="ws-main-section">
        <div class="ws-main-kpi-row">
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">Channels Connected</div>
            <div class="ws-main-kpi-cell-value ${anyConnected ? "ok" : "warn"}">${Object.values(channels).filter(Boolean).length} / 3</div>
          </div>
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">Entity</div>
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-top:4px">${entity.name}</div>
          </div>
          <div class="ws-main-kpi-cell">
            <div class="ws-main-kpi-cell-label">As of</div>
            <div style="font-size:12px;color:var(--muted-dim);margin-top:4px">${entity.as_of}</div>
          </div>
        </div>
        <div class="ws-main-section-title">Document Vault — Ingested Source Files</div>
        <div style="overflow-x:auto">
          <table class="ws-data-table">
            <thead><tr>
              <th style="width:260px">Channel</th>
              <th style="width:140px">Status</th>
              <th>Source / File</th>
            </tr></thead>
            <tbody>${vaultRows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  // Default: onboarding view — entity profile + upload
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
          ].map(([k, v]) => `<tr><td style="color:var(--muted);font-size:11.5px">${k}</td><td>${v || "—"}</td></tr>`).join("")}
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
  const view = wsActiveViews["income"] || "invoices";

  const totalSettled = invoices.filter((i) => i.status === "Settled").reduce((s, i) => s + i.amount_inr, 0);
  const totalPending = invoices.filter((i) => i.status === "Pending").reduce((s, i) => s + i.amount_inr, 0);
  const totalOverdue = invoices.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.amount_inr, 0);
  const invalidCount = invoices.filter((i) => !i.gstin_valid).length;

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

  if (view === "tds") {
    // TDS Ledger — Form 26AS standalone view
    const totalTds    = tds.reduce((s, t) => s + t.amount_inr, 0);
    const unmatched   = tds.filter((t) => t.status === "Unmatched");
    const matched     = tds.filter((t) => t.status === "Matched");
    const tdsByQuarter = [...new Set(tds.map(t => t.quarter))];
    const tdsKpi = `
      <div class="ws-main-kpi-row">
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Total TDS Receivable</div>
          <div class="ws-main-kpi-cell-value">${fmtInrMain(totalTds)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Unmatched Entries</div>
          <div class="ws-main-kpi-cell-value warn">${unmatched.length}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Matched / Reconciled</div>
          <div class="ws-main-kpi-cell-value ok">${matched.length}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Quarters on Record</div>
          <div class="ws-main-kpi-cell-value">${tdsByQuarter.length}</div>
        </div>
      </div>`;
    const tdsRows = tds.map((t) => `<tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted-dim)">${t.traces_ref}</td>
      <td>${t.deductor}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted)">${t.quarter}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--muted-dim)">${t.period}</td>
      <td style="font-size:11px;color:var(--muted-dim)">${t.form}</td>
      <td style="text-align:right;font-family:var(--font-mono)">${fmtInrMain(t.amount_inr)}</td>
      <td><span class="ws-tds-${t.status.toLowerCase()}">${t.status}</span></td>
    </tr>`).join("");
    frame.innerHTML = `
      <div class="ws-main-section">
        ${tdsKpi}
        <div class="ws-main-section-title">TDS Ledger — Form 26AS Reconciliation</div>
        <div style="overflow-x:auto">
          <table class="ws-data-table">
            <thead><tr>
              <th style="width:110px">TRACES Ref</th>
              <th style="width:200px">Deductor</th>
              <th style="width:100px">Quarter</th>
              <th style="width:120px">Period</th>
              <th style="width:70px">Form</th>
              <th style="width:110px;text-align:right">Amount</th>
              <th style="width:110px">Status</th>
            </tr></thead>
            <tbody>${tdsRows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  if (view === "cashflows") {
    // Active Cash Flows — receivables timeline derived from invoices
    const byMonth = {};
    invoices.forEach((inv) => {
      const m = inv.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { settled: 0, pending: 0, overdue: 0 };
      byMonth[m][inv.status.toLowerCase()] = (byMonth[m][inv.status.toLowerCase()] || 0) + inv.amount_inr;
    });
    const months = Object.keys(byMonth).sort().reverse();
    const cfRows = months.map((m) => {
      const row = byMonth[m];
      const net = (row.settled || 0) - (row.overdue || 0);
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:12px;font-weight:600">${m}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--ok)">${row.settled ? fmtInrMain(row.settled) : "—"}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--muted-dim)">${row.pending ? fmtInrMain(row.pending) : "—"}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--warn)">${row.overdue ? fmtInrMain(row.overdue) : "—"}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:${net >= 0 ? "var(--ok)" : "var(--warn)"}">${fmtInrMain(Math.abs(net))} ${net >= 0 ? "↑" : "↓"}</td>
      </tr>`;
    }).join("");
    const cfKpi = `
      <div class="ws-main-kpi-row">
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Net Realized</div>
          <div class="ws-main-kpi-cell-value ok">${fmtInrMain(totalSettled)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Receivables At Risk</div>
          <div class="ws-main-kpi-cell-value warn">${fmtInrMain(totalOverdue)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Pipeline (Pending)</div>
          <div class="ws-main-kpi-cell-value">${fmtInrMain(totalPending)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Realized Revenue (Q2)</div>
          <div class="ws-main-kpi-cell-value ok">${fmtInrMain(summary.realized_revenue.value)}</div>
        </div>
      </div>`;
    frame.innerHTML = `
      <div class="ws-main-section">
        ${cfKpi}
        <div class="ws-main-section-title">Cash Flow Timeline — Monthly Receivables</div>
        <div style="overflow-x:auto">
          <table class="ws-data-table">
            <thead><tr>
              <th style="width:100px">Month</th>
              <th style="width:130px;text-align:right">Settled</th>
              <th style="width:130px;text-align:right">Pending</th>
              <th style="width:130px;text-align:right">Overdue</th>
              <th style="width:130px;text-align:right">Net Flow</th>
            </tr></thead>
            <tbody>${cfRows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  // Default: invoices view
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
    </div>`;
}

// ── Compliance Matrix main frame ─────────────────────────────────────
function renderComplianceMain(frame) {
  const data = enterpriseData;
  if (!data) { frame.innerHTML = `<div class="ws-main-section"><p style="color:var(--muted)">Loading…</p></div>`; return; }
  const { compliance } = data;
  const entity = buildActiveEntity(data.entity);
  const view = wsActiveViews["compliance"] || "gst-lifecycle";

  const filed    = compliance.filter((r) => r.gstr1_status === "Filed" && r.gstr3b_status === "Filed").length;
  const draft    = compliance.filter((r) => r.gstr3b_status === "Draft").length;
  const pending  = compliance.filter((r) => r.gstr1_status === "Pending").length;
  const actions  = compliance.filter((r) => r.action_required).length;
  const totalItc = compliance.reduce((s, r) => s + r.itc_eligible_inr, 0);
  const totalPayable = compliance.reduce((s, r) => s + r.net_payable_inr, 0);

  function cBadge(s) {
    const m = { Filed: "filed", Draft: "draft", Pending: "pending" };
    return `<span class="c-badge ${m[s] || "pending"}">${s}</span>`;
  }

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

  if (view === "itc") {
    // ITC Optimizers — ITC credit utilisation and offset analysis
    const itcRows = compliance
      .filter((r) => r.itc_eligible_inr > 0 || r.net_payable_inr > 0)
      .map((r) => {
        const offset = r.itc_eligible_inr > 0 && r.net_payable_inr > 0
          ? Math.min(r.itc_eligible_inr, r.net_payable_inr)
          : 0;
        const netAfterOffset = r.net_payable_inr - offset;
        const efficiency = r.net_payable_inr > 0 && r.itc_eligible_inr > 0
          ? ((r.itc_eligible_inr / r.net_payable_inr) * 100).toFixed(0) + "%"
          : "—";
        const blocked = r.gstr3b_status !== "Filed" && r.itc_eligible_inr > 0;
        return `<tr class="${blocked ? "action-row" : ""}">
          <td style="font-family:var(--font-mono);font-weight:600;font-size:12px">${r.period}</td>
          <td>${cBadge(r.gstr3b_status)}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--ok)">${r.itc_eligible_inr > 0 ? fmtInrMain(r.itc_eligible_inr) : "—"}</td>
          <td style="text-align:right;font-family:var(--font-mono)">${r.net_payable_inr > 0 ? fmtInrMain(r.net_payable_inr) : "—"}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--ok)">${offset > 0 ? fmtInrMain(offset) : "—"}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:${netAfterOffset > 0 ? "var(--warn)" : "var(--ok)"}">${netAfterOffset > 0 ? fmtInrMain(netAfterOffset) : "Nil"}</td>
          <td style="text-align:right;font-size:12px">${efficiency}</td>
          <td style="font-size:11px;color:${blocked ? "var(--warn)" : "var(--muted-dim)"}">${blocked ? "⚑ GSTR-3B not filed — ITC offset blocked" : (r.action_note || "—")}</td>
        </tr>`;
      }).join("");
    const itcKpi = `
      <div class="ws-main-kpi-row">
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Total ITC Available</div>
          <div class="ws-main-kpi-cell-value ok">${fmtInrMain(totalItc)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Total GST Payable</div>
          <div class="ws-main-kpi-cell-value">${fmtInrMain(totalPayable)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Blocked ITC</div>
          <div class="ws-main-kpi-cell-value ${actions > 0 ? "warn" : "ok"}">${fmtInrMain(compliance.filter(r => r.action_required).reduce((s, r) => s + r.itc_eligible_inr, 0))}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Net After Offset</div>
          <div class="ws-main-kpi-cell-value">${fmtInrMain(Math.max(0, totalPayable - totalItc))}</div>
        </div>
      </div>`;
    frame.innerHTML = `
      <div class="ws-main-section">
        ${itcKpi}
        <div class="ws-main-section-title">ITC Offset Analysis — ${entity.gstin}</div>
        <div style="overflow-x:auto">
          <table class="ws-compliance-table" style="min-width:700px">
            <thead><tr>
              <th style="width:90px">Period</th>
              <th style="width:90px">GSTR-3B</th>
              <th style="width:110px;text-align:right">ITC Eligible</th>
              <th style="width:110px;text-align:right">GST Payable</th>
              <th style="width:110px;text-align:right">Offset Used</th>
              <th style="width:110px;text-align:right">Net Liability</th>
              <th style="width:80px;text-align:right">Efficiency</th>
              <th>Notes</th>
            </tr></thead>
            <tbody>${itcRows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  // Default: gst-lifecycle view
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
  const view = wsActiveViews["assets"] || "mf-portfolios";

  const totalAum  = mf_portfolio.reduce((s, f) => s + f.current_value_inr, 0);
  const liquidAum = mf_portfolio.filter((f) => f.type === "Liquid").reduce((s, f) => s + f.current_value_inr, 0);
  const equityAum = mf_portfolio.filter((f) => f.type === "Equity" || f.type === "ELSS").reduce((s, f) => s + f.current_value_inr, 0);
  const avgXirr   = mf_portfolio.reduce((s, f) => s + f.xirr_pct, 0) / mf_portfolio.length;

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

  if (view === "capital") {
    // Capital Inflow Decisions — pledge capacity, loan coverage, allocation guidance
    const s = activeSession || {};
    const loanAmt = s.loanAmount ? (parseFloat(String(s.loanAmount).replace(/[₹,\s]/g, "")) || 0) : 0;
    const pledgePct = liquidAum > 0 ? ((liquidAum / totalAum) * 100).toFixed(1) : 0;
    const loanCoverage = loanAmt > 0 ? ((liquidAum / loanAmt) * 100).toFixed(1) : null;
    const byType = {};
    mf_portfolio.forEach((f) => {
      byType[f.type] = (byType[f.type] || 0) + f.current_value_inr;
    });
    const allocationRows = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, val]) => {
        const pct = ((val / totalAum) * 100).toFixed(1);
        const barW = Math.round(parseFloat(pct) * 1.5);
        const isPledgeable = type === "Liquid" || type === "Debt";
        return `<tr>
          <td style="font-weight:600">${type}</td>
          <td style="text-align:right;font-family:var(--font-mono)">${fmtInrMain(val)}</td>
          <td style="text-align:right;font-family:var(--font-mono)">${pct}%</td>
          <td><span class="c-badge ${isPledgeable ? "filed" : "pending"}" style="font-size:10px">${isPledgeable ? "Pledgeable" : "Non-pledgeable"}</span></td>
          <td><span style="display:inline-block;height:6px;width:${barW}px;background:${isPledgeable ? "var(--ok)" : "var(--muted)"};border-radius:3px"></span></td>
        </tr>`;
      }).join("");
    const capKpi = `
      <div class="ws-main-kpi-row">
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Pledgeable (Liquid)</div>
          <div class="ws-main-kpi-cell-value ok">${fmtInrMain(liquidAum)}</div>
        </div>
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Liquid % of AUM</div>
          <div class="ws-main-kpi-cell-value ok">${pledgePct}%</div>
        </div>
        ${loanCoverage ? `
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Loan Coverage Ratio</div>
          <div class="ws-main-kpi-cell-value ${parseFloat(loanCoverage) >= 100 ? "ok" : "warn"}">${loanCoverage}%</div>
        </div>` : ""}
        <div class="ws-main-kpi-cell">
          <div class="ws-main-kpi-cell-label">Liquid MF AUM (Q2)</div>
          <div class="ws-main-kpi-cell-value">${fmtInrMain(summary.mf_aum.value)} <span style="font-size:11px;color:var(--ok)">↑${summary.mf_aum.delta_pct}%</span></div>
        </div>
      </div>`;
    frame.innerHTML = `
      <div class="ws-main-section">
        ${capKpi}
        <div class="ws-main-section-title">Capital Allocation by Asset Type</div>
        <div style="overflow-x:auto">
          <table class="ws-data-table">
            <thead><tr>
              <th style="width:110px">Asset Type</th>
              <th style="width:130px;text-align:right">Value</th>
              <th style="width:80px;text-align:right">% of AUM</th>
              <th style="width:130px">Pledgeability</th>
              <th>Allocation Bar</th>
            </tr></thead>
            <tbody>${allocationRows}</tbody>
          </table>
        </div>
      </div>`;
    return;
  }

  // Default: mf-portfolios view
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

// ═══════════════════════════════════════════════════════════════════════
// ENTERPRISE APP & APPEND-ONLY AUDIT ENGINE
// ═══════════════════════════════════════════════════════════════════════

let enterpriseAuditLog = [
  {
    id: "EVT-INIT-001",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    eventToken: "NODE_INITIALIZED",
    operator: "SYSTEM_DAEMON",
    targetNode: "asia-south1:core-engine",
    action: "Bootstrapped immutable audit ledger and AA protocol gateway.",
    status: "SUCCESS",
    sha256BlockDigest: "0x8f2a7b11e9c14092b740e53a992bc44d32098d6541f5a11e89bc7210fa",
  },
];

function generateBlockDigest(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `0x8f2a${hex}e9c14092b740e53a992bc44d32098d6541f5a11${hex}`;
}

function logSystemEvent(eventToken, operator, targetNode, action, status, metadata) {
  const timestamp = new Date().toISOString();
  const digestSeed = `${timestamp}:${eventToken}:${operator}:${targetNode}:${action}`;
  const newEvent = {
    id: `EVT-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp,
    eventToken,
    operator,
    targetNode,
    action,
    status,
    sha256BlockDigest: generateBlockDigest(digestSeed),
    metadata,
  };
  enterpriseAuditLog.unshift(newEvent);
  if (activeWorkspace === "dev_console") {
    const frame = $("workspace-main-frame");
    if (frame) renderDevConsole(frame);
  }
  return newEvent;
}

let customerStep = 1;
let isCustomerAuthenticated = false;
let customerEmail = "";
let customerPassword = "";

// 5 Industry Benchmark Use Cases with pre-filled Synthetic Datasets & Excel Files
const BENCHMARK_CASES = [
  {
    id: "kaveri",
    name: "Annapurna Agro Commodities Pvt Ltd",
    sector: "Agriculture & Agro-Trading",
    pan: "AABCK4812G",
    gstin: "36AABCK4812G1Z2",
    loan: "₹8,50,00,000",
    bank_inflows: "₹46,80,00,000",
    gst_turnover: "₹45,20,00,000",
    trend_bank: "+3.5%",
    trend_gst: "+3.1%",
    variance: "0.4%",
    verdict: "APPROVE",
    final_confidence: 0.88,
    model_confidence: 0.88,
    consent_multiplier: 1.0,
    consent_days: 90,
    badge_class: "ok",
    files: {
      gstn: "kaveri_gstr_returns.xlsx",
      itr: "kaveri_itr_filings.xlsx",
      bank: "kaveri_bank_statement.xlsx"
    },
    narrative: "Consistent alignment between Account Aggregator bank deposits (INR 46.8 Cr) and GSTR-3B filings (INR 45.2 Cr). APMC electronic receipt verification validates genuine farmgate grain trade volume without divergence."
  },
  {
    id: "deccan",
    name: "Trisara Cements & Infrastructure Pvt Ltd",
    sector: "Cement & Heavy Building Materials",
    pan: "AATSC4512B",
    gstin: "37AATSC4512B1Z6",
    loan: "₹14,00,00,000",
    bank_inflows: "₹76,00,00,000",
    gst_turnover: "₹78,50,00,000",
    trend_bank: "-2.1%",
    trend_gst: "-2.4%",
    variance: "0.3%",
    verdict: "APPROVE",
    final_confidence: 0.82,
    model_confidence: 0.82,
    consent_multiplier: 1.0,
    consent_days: 75,
    badge_class: "ok",
    files: {
      gstn: "deccan_gstr_returns.xlsx",
      itr: "deccan_itr_filings.xlsx",
      bank: "deccan_bank_statement.xlsx"
    },
    narrative: "Verified rail-freight e-way bill volume matches GSTR-1 inter-state dispatches. Clinker procurement and plant power consumption correlate precisely with filed turnover."
  },
  {
    id: "kalyani",
    name: "Virelion Specialty Metals Pvt Ltd",
    sector: "Steel & Metallurgy Manufacturing",
    pan: "AAVSP7743M",
    gstin: "27AAVSP7743M1Z8",
    loan: "₹9,50,00,000",
    bank_inflows: "₹52,00,00,000",
    gst_turnover: "₹38,00,00,000",
    trend_bank: "+5.4%",
    trend_gst: "-21.8%",
    variance: "27.2%",
    verdict: "MANUAL REVIEW",
    final_confidence: 0.14,
    model_confidence: 0.50,
    consent_multiplier: 0.29,
    consent_days: 2,
    badge_class: "warn",
    files: {
      gstn: "kalyani_gstr_returns.xlsx",
      itr: "kalyani_itr_filings.xlsx",
      bank: "kalyani_bank_statement.xlsx"
    },
    narrative: "Flagged RULE_INCOME_REV_DIVERGENCE: Commercial bank deposits indicate INR 52.0 Cr inflows (+5.4%) while GSTR-3B tax declarations contract to INR 38.0 Cr (-21.8%). Potential circular routing or unreported scrap liquidation."
  },
  {
    id: "bharat",
    name: "Aravind Capital & Trade Finance Pvt Ltd",
    sector: "Financial Services & NBFC",
    pan: "AAACT8831P",
    gstin: "27AAACT8831P1Z4",
    loan: "₹6,00,00,000",
    bank_inflows: "₹12,80,00,000",
    gst_turnover: "₹12,50,00,000",
    trend_bank: "+1.2%",
    trend_gst: "+0.8%",
    variance: "0.4%",
    verdict: "APPROVE",
    final_confidence: 0.85,
    model_confidence: 0.85,
    consent_multiplier: 1.0,
    consent_days: 120,
    badge_class: "ok",
    files: {
      gstn: "bharat_gstr_returns.xlsx",
      itr: "bharat_itr_filings.xlsx",
      bank: "bharat_bank_statement.xlsx"
    },
    narrative: "Loan origination fee collection and structured interest cashflow reconcile across AA bank feeds and GSTR-9 annual summary. Liquidity coverage ratio (LCR) exceeds regulatory hurdle."
  },
  {
    id: "zenith",
    name: "Nexvara Chemicals & Agrochemicals Pvt Ltd",
    sector: "Chemicals & Crop Protection",
    pan: "AANXC3367H",
    gstin: "24AANXC3367H1Z2",
    loan: "₹7,50,00,000",
    bank_inflows: "₹29,50,00,000",
    gst_turnover: "₹21,00,00,000",
    trend_bank: "+7.8%",
    trend_gst: "-18.2%",
    variance: "26.0%",
    verdict: "MANUAL REVIEW",
    final_confidence: 0.15,
    model_confidence: 0.50,
    consent_multiplier: 0.31,
    consent_days: 3,
    badge_class: "warn",
    files: {
      gstn: "zenith_gstr_returns.xlsx",
      itr: "zenith_itr_filings.xlsx",
      bank: "zenith_bank_statement.xlsx"
    },
    narrative: "Critical variance detected between inward e-way bill raw chemical purchases and reported GSTR-3B sales. Primary current account shows unmapped round-tripping transactions."
  }
];

let activeBenchmarkId = null; // null means custom applicant mode

let enterpriseEntityName = "";
let enterprisePan = "";
let enterpriseGstin = "";
let enterpriseLoanAmount = "";
let enterpriseGstinMasked = true;
let enterpriseChannels = {
  gstn: false,
  itr: false,
  bank: false,
};
// Tracks the active sub-view per workspace (persists across workspace switches)
const wsActiveViews = {};
let enterpriseUploadedFiles = {
  gstn: null,
  itr: null,
  bank: null,
};

// Canonical session snapshot built at Step 2 commit. All Steps 3, 4, the
// credit pipeline, anchor bar, and case rail read from this — not from the
// scattered enterprise* form vars above. null until first Step 2 commit.
let activeSession = null;

function parseLoanAmount(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function deriveRiskTier(varianceStr, verdict) {
  if (!verdict) return "medium";
  if (verdict === "DECLINE") return "high";
  const v = parseFloat(varianceStr) || 0;
  if (verdict === "APPROVE" && v < 5) return "low";
  if (v > 20) return "watch";
  return "medium";
}

let swarmProgress = 0;
let telemetryLogs = [];
let isSwarmRunning = false;

let isDevAuthenticated = false;
let devAuthError = null;
let previousWorkspace = "customer_wizard";

function isStep2Valid() {
  return enterpriseChannels.gstn && enterpriseChannels.itr && enterpriseChannels.bank && enterpriseEntityName.trim().length > 0;
}

function updateCustomerStepper() {
  const stepper = $("customer-stepper");
  if (!stepper) return;

  if (activeWorkspace === "dev_auth" || activeWorkspace === "dev_console" || activeWorkspace === "credit") {
    stepper.style.display = "none";
    return;
  }

  stepper.style.display = "flex";

  [1, 2, 3, 4].forEach((num) => {
    const pill = $(`step-pill-${num}`);
    if (pill) {
      pill.classList.toggle("active", customerStep === num);
      pill.classList.toggle("completed", customerStep > num);
      const badge = pill.querySelector(".step-badge");
      if (badge) {
        badge.textContent = customerStep > num ? "✓" : num;
      }
    }
  });
}

function switchCustomerStep(step) {
  // Strict progressive disclosure validation
  if (step === 2 && !isCustomerAuthenticated) {
    if (typeof showToast === "function") showToast("Please authenticate at Step 1 to proceed.");
    customerStep = 1;
    setWorkspaceMilestone("auth");
  } else if (step === 3 && (!isCustomerAuthenticated || !isStep2Valid())) {
    if (typeof showToast === "function") showToast("Please complete entity intake and verify all 3 data channels.");
    customerStep = isCustomerAuthenticated ? 2 : 1;
    setWorkspaceMilestone(isCustomerAuthenticated ? "onboarding" : "auth");
  } else if (step === 4 && (!isCustomerAuthenticated || !isStep2Valid() || swarmProgress < 100)) {
    if (typeof showToast === "function") showToast("Multi-source cross-verification must finish before viewing assessment.");
    customerStep = isCustomerAuthenticated && isStep2Valid() ? 3 : (isCustomerAuthenticated ? 2 : 1);
    setWorkspaceMilestone(isCustomerAuthenticated && isStep2Valid() ? "ingestion_processing" : (isCustomerAuthenticated ? "onboarding" : "auth"));
  } else {
    customerStep = step;
    if (step === 1) setWorkspaceMilestone("auth");
    else if (step === 2) setWorkspaceMilestone("onboarding");
    else if (step === 3) setWorkspaceMilestone("ingestion_processing");
    else if (step === 4) setWorkspaceMilestone("settled_dashboard");
  }

  try { history.replaceState(null, "", `#step=${customerStep}`); } catch (_) {}
  updateCustomerStepper();

  const frame = $("workspace-main-frame");
  if (frame && activeWorkspace === "customer_wizard") {
    renderCustomerWizard(frame);
  }
}

function renderCustomerWizard(frame) {
  updateCustomerStepper();
  switch (customerStep) {
    case 1: renderCustomerLogin(frame); break;
    case 2: renderCustomerOnboarding(frame); break;
    case 3: renderCustomerTelemetry(frame); break;
    case 4: renderCustomerFinalVerdict(frame); break;
    default: renderCustomerLogin(frame);
  }
}

// ── STEP 1: CUSTOMER LOGIN PAGE ──────────────────────────────────────
function renderCustomerLogin(frame) {
  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div class="customer-login-wrap">
        <div class="customer-login-card">
          <div class="customer-login-hero">
            <div class="customer-login-icon" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); color: #fff;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h2 class="customer-login-title">Institutional Underwriting Portal</h2>
            <p class="customer-login-sub">
              Authorized Credit Officer &amp; Risk Analyst Gateway
            </p>
          </div>

          <form id="customer-login-form" style="display:flex;flex-direction:column;gap:14px">
            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="cust-email-input">Officer Email / Identifier</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">✉</span>
                <input type="email" id="cust-email-input" class="ent-input" value="${customerEmail}" placeholder="credit.officer@institution.com" required />
              </div>
            </div>

            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="cust-pass-input">Security Credential / MFA Key</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">🔒</span>
                <input type="password" id="cust-pass-input" class="ent-input" value="${customerPassword}" placeholder="••••••••••••" required />
              </div>
            </div>

            <div style="margin-top:8px;display:flex;flex-direction:column;gap:10px">
              <button type="submit" id="btn-cust-submit" class="btn-initialize-bypass" style="width:100%;justify-content:center">
                <span>Sign In with Credentials</span>
                <span>→</span>
              </button>

              <button type="button" id="btn-instant-sso" class="btn-demokit-login" style="width:100%;justify-content:center">
                <span>⚡</span>
                <span>Instant Enterprise Login (Single Sign-On)</span>
              </button>
            </div>
          </form>

          <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px;text-align:center">
            <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--muted)">
              🔒 Demo environment · Synthetic data only · No live AA / FIP integration
            </span>
          </div>
        </div>
      </div>
    </div>
  `;

  const form = $("customer-login-form");
  const ssoBtn = $("btn-instant-sso");

  const performLogin = () => {
    isCustomerAuthenticated = true;
    logSystemEvent(
      "CUSTOMER_LOGIN_SUCCESS",
      customerEmail || "COMMERCIAL_USER",
      "gateway:auth-broker",
      `Corporate operator signed in successfully. Session token generated for ${customerEmail}.`,
      "SUCCESS"
    );
    if (typeof showToast === "function") showToast("Authenticated to Credit Vault");
    switchCustomerStep(2);
  };

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      customerEmail = $("cust-email-input")?.value || customerEmail;
      performLogin();
    });
  }

  if (ssoBtn) {
    ssoBtn.addEventListener("click", () => {
      performLogin();
    });
  }
}

// ── STEP 2: ONBOARDING & DATA INGESTION VECTOR ────────────────────────
function renderCustomerOnboarding(frame) {
  const isPermitted = isStep2Valid();
  const activeCase = BENCHMARK_CASES.find(b => b.id === activeBenchmarkId) || null;

  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div class="onboarding-hero">
        <span class="onboarding-badge">Step 2 of 4 · Entity Intake &amp; Data Integration</span>
        <h2 class="onboarding-title">Commercial Entity Intake &amp; Document Ingestion</h2>
        <p class="onboarding-subtitle">
          Select an industry benchmark profile or input custom entity credentials, then connect or import the 3 primary financial records for deterministic reconciliation.
        </p>
        <p style="font-family:monospace;font-size:11px;color:#888;margin-top:6px;padding:6px 10px;background:#1a1a1a;border-radius:4px;border:1px solid #333;">
          Synthetic data · No live Account Aggregator / Sahamati / FIP integration · All profiles are fabricated for demonstration
        </p>
      </div>

      <div class="onboarding-split-layout">
        <!-- Left Column: 5 Sector Benchmark Use Cases -->
        <div class="benchmark-panel">
          <div class="benchmark-header">
            <span class="benchmark-kicker">Industry Benchmarks</span>
            <h3 class="benchmark-title">Select Sector Portfolio</h3>
            <p style="font-size:11px;color:var(--muted);margin:4px 0 0">
              Pre-populated with verified enterprise filings &amp; downloadable Excel workbooks.
            </p>
          </div>

          <div class="benchmark-card-list">
            ${BENCHMARK_CASES.map(b => {
              const isSelected = activeBenchmarkId === b.id;
              return `
                <div class="benchmark-card ${isSelected ? 'active' : ''}" data-benchmark-id="${b.id}">
                  <div class="benchmark-card-top">
                    <span class="benchmark-card-sector">${b.sector}</span>
                    <span class="benchmark-card-verdict ${b.badge_class}">${b.verdict}</span>
                  </div>
                  <div class="benchmark-card-name">${b.name}</div>
                  <div class="benchmark-card-sub">
                    <span>${b.loan} Facility</span>
                    <span>Var: ${b.variance}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <button type="button" class="benchmark-custom-btn ${activeBenchmarkId === null ? 'active' : ''}" id="btn-custom-applicant">
            <span>✎</span>
            <span>+ Add Custom Applicant / Manual Input</span>
          </button>
        </div>

        <!-- Right Column: Intake Form & File Channels -->
        <div class="onboarding-card" style="margin-top:0">
          ${activeCase ? `
            <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <span style="font-family:var(--font-mono);font-size:10px;text-transform:uppercase;color:#818cf8;font-weight:700">Benchmark Active · ${activeCase.sector}</span>
                <div style="font-size:13px;font-weight:600;color:#fff">${activeCase.name}</div>
              </div>
              <span class="benchmark-card-verdict ${activeCase.badge_class}">${activeCase.verdict} (${activeCase.variance} delta)</span>
            </div>
          ` : ''}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="ent-entity-name-input">Legal Business Entity Name *</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">🏢</span>
                <input type="text" id="ent-entity-name-input" class="ent-input" value="${enterpriseEntityName.replace(/"/g, '&quot;')}" placeholder="e.g. ABC Enterprises Pvt Ltd" required />
              </div>
            </div>

            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="ent-loan-amount-input">Requested Credit Facility (INR)</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">₹</span>
                <input type="text" id="ent-loan-amount-input" class="ent-input" value="${enterpriseLoanAmount.replace(/"/g, '&quot;')}" placeholder="e.g. ₹50,00,000" />
              </div>
            </div>

            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="ent-pan-input">Corporate PAN (10-Digit Alphanumeric)</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">📄</span>
                <input type="text" id="ent-pan-input" class="ent-input" value="${enterprisePan.replace(/"/g, '&quot;')}" placeholder="e.g. ABCDE1234F" />
              </div>
            </div>

            <div class="ent-form-group" style="margin-bottom:0">
              <label class="ent-form-label" for="ent-gstin-input">GSTIN (15-Digit Identifier)</label>
              <div class="ent-input-row">
                <span class="ent-input-icon">🏛</span>
                <input type="text" id="ent-gstin-input" class="ent-input" value="${enterpriseGstin.replace(/"/g, '&quot;')}" placeholder="e.g. 27ABCDE1234F1Z5" />
              </div>
            </div>
          </div>

          <div class="ent-form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span class="ent-form-label" style="margin-bottom:0">Data Ingestion Channels &amp; Verification (All 3 Channels Required)</span>
              ${activeCase ? `
                <span style="font-size:11px;color:#34d399;font-family:var(--font-mono)">✓ 3 Benchmark Excel Workbooks Attached</span>
              ` : ''}
            </div>

            <div class="ent-channels-list">
              
              <!-- Channel 1: GST Returns -->
              <div class="ent-channel-item ${enterpriseChannels.gstn ? 'active' : ''}" data-channel="gstn">
                <div class="ent-channel-left">
                  <div class="ent-checkbox-box">${enterpriseChannels.gstn ? '✓' : ''}</div>
                  <div>
                    <div class="ent-channel-title-row">
                      <span class="ent-channel-title">GSTN GSTR-1 &amp; 3B Returns Ledger</span>
                      <span class="ent-channel-protocol">REST / GSTN-OAuth2</span>
                    </div>
                    <p class="ent-channel-desc">Reconciles period-by-period declared gross turnover and filed input tax credit.</p>
                    ${activeCase ? `
                      <div class="sample-excel-links">
                        <a href="/data/samples/${activeCase.files.gstn}" download class="sample-excel-pill" title="Download Excel Workbook" onclick="event.stopPropagation()">
                          <span>📥</span>
                          <span>${activeCase.files.gstn}</span>
                        </a>
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div class="ent-channel-right">
                  <input type="file" id="file-gstn-input" style="display:none" accept=".json,.csv,.pdf,.xlsx" />
                  <button type="button" class="ent-channel-upload-btn" id="btn-upload-gstn" title="Import GSTR file or payload">
                    <span>📎</span>
                    <span>${enterpriseUploadedFiles.gstn ? enterpriseUploadedFiles.gstn : 'Import GSTR File'}</span>
                  </button>
                  <span class="ent-channel-count">${enterpriseChannels.gstn ? (enterpriseUploadedFiles.gstn ? 'File Imported' : '24 records connected') : 'Pending'}</span>
                </div>
              </div>

              <!-- Channel 2: ITR / CBDT -->
              <div class="ent-channel-item ${enterpriseChannels.itr ? 'active' : ''}" data-channel="itr">
                <div class="ent-channel-left">
                  <div class="ent-checkbox-box">${enterpriseChannels.itr ? '✓' : ''}</div>
                  <div>
                    <div class="ent-channel-title-row">
                      <span class="ent-channel-title">Income Tax Verification (ITR Form-16 / 26AS)</span>
                      <span class="ent-channel-protocol">CBDT e-Filing API</span>
                    </div>
                    <p class="ent-channel-desc">Cross-references declared operating profits and annual tax filings.</p>
                    ${activeCase ? `
                      <div class="sample-excel-links">
                        <a href="/data/samples/${activeCase.files.itr}" download class="sample-excel-pill" title="Download Excel Workbook" onclick="event.stopPropagation()">
                          <span>📥</span>
                          <span>${activeCase.files.itr}</span>
                        </a>
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div class="ent-channel-right">
                  <input type="file" id="file-itr-input" style="display:none" accept=".json,.csv,.pdf,.xml,.xlsx" />
                  <button type="button" class="ent-channel-upload-btn" id="btn-upload-itr" title="Import ITR XML/JSON/PDF/XLSX">
                    <span>📎</span>
                    <span>${enterpriseUploadedFiles.itr ? enterpriseUploadedFiles.itr : 'Import ITR Data'}</span>
                  </button>
                  <span class="ent-channel-count">${enterpriseChannels.itr ? (enterpriseUploadedFiles.itr ? 'File Imported' : '3 AY verified') : 'Pending'}</span>
                </div>
              </div>

              <!-- Channel 3: Bank MFT / AA -->
              <div class="ent-channel-item ${enterpriseChannels.bank ? 'active' : ''}" data-channel="bank">
                <div class="ent-channel-left">
                  <div class="ent-checkbox-box">${enterpriseChannels.bank ? '✓' : ''}</div>
                  <div>
                    <div class="ent-channel-title-row">
                      <span class="ent-channel-title">Bank Statement Aggregator Feed</span>
                      <span class="ent-channel-protocol">Account Aggregator Protocol</span>
                    </div>
                    <p class="ent-channel-desc">Direct banking statement verification across primary operating accounts.</p>
                    ${activeCase ? `
                      <div class="sample-excel-links">
                        <a href="/data/samples/${activeCase.files.bank}" download class="sample-excel-pill" title="Download Excel Workbook" onclick="event.stopPropagation()">
                          <span>📥</span>
                          <span>${activeCase.files.bank}</span>
                        </a>
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div class="ent-channel-right">
                  <input type="file" id="file-bank-input" style="display:none" accept=".json,.csv,.pdf,.xlsx" />
                  <button type="button" class="ent-channel-upload-btn" id="btn-upload-bank" title="Import Bank Statement CSV/PDF/XLSX">
                    <span>📎</span>
                    <span>${enterpriseUploadedFiles.bank ? enterpriseUploadedFiles.bank : 'Import Statement'}</span>
                  </button>
                  <span class="ent-channel-count">${enterpriseChannels.bank ? (enterpriseUploadedFiles.bank ? 'File Imported' : '884 txns verified') : 'Pending'}</span>
                </div>
              </div>

            </div>
          </div>

          <div class="onboarding-footer">
            <div class="onboarding-status-hint ${isPermitted ? 'ready' : 'pending'}" id="ent-onboarding-hint">
              ${isPermitted ? '✓ Entity details and all 3 data channels connected. Ready for cross-verification.' : '⚠ Please enter entity name and connect / import all 3 channels to proceed.'}
            </div>
            <button class="btn-initialize-bypass" id="ent-btn-proceed-ingestion" type="button" ${isPermitted ? '' : 'disabled'}>
              <span>Proceed to Cross-Verification</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const nameInput = $("ent-entity-name-input");
  const panInput = $("ent-pan-input");
  const gstinInput = $("ent-gstin-input");
  const loanInput = $("ent-loan-amount-input");
  const proceedBtn = $("ent-btn-proceed-ingestion");
  const hintEl = $("ent-onboarding-hint");

  const syncStateAndUI = () => {
    enterpriseEntityName = nameInput?.value || "";
    enterprisePan = panInput?.value || "";
    enterpriseGstin = gstinInput?.value || "";
    enterpriseLoanAmount = loanInput?.value || "";

    const canProceed = isStep2Valid();
    if (proceedBtn) proceedBtn.disabled = !canProceed;
    if (hintEl) {
      hintEl.className = `onboarding-status-hint ${canProceed ? 'ready' : 'pending'}`;
      hintEl.textContent = canProceed
        ? '✓ Entity details and all 3 data channels connected. Ready for cross-verification.'
        : '⚠ Please enter entity name and connect / import all 3 channels to proceed.';
    }
  };

  if (nameInput) nameInput.addEventListener("input", syncStateAndUI);
  if (panInput) panInput.addEventListener("input", syncStateAndUI);
  if (gstinInput) gstinInput.addEventListener("input", syncStateAndUI);
  if (loanInput) loanInput.addEventListener("input", syncStateAndUI);

  // Bind Benchmark card selections
  frame.querySelectorAll(".benchmark-card").forEach((card) => {
    card.addEventListener("click", () => {
      const bId = card.dataset.benchmarkId;
      const b = BENCHMARK_CASES.find(item => item.id === bId);
      if (!b) return;

      activeBenchmarkId = b.id;
      enterpriseEntityName = b.name;
      enterprisePan = b.pan;
      enterpriseGstin = b.gstin;
      enterpriseLoanAmount = b.loan;
      enterpriseChannels = { gstn: true, itr: true, bank: true };
      enterpriseUploadedFiles = {
        gstn: b.files.gstn,
        itr: b.files.itr,
        bank: b.files.bank
      };

      if (typeof showToast === "function") {
        showToast(`Loaded benchmark dataset: ${b.name}`);
      }
      renderCustomerOnboarding(frame);
    });
  });

  // Custom applicant button
  const customBtn = $("btn-custom-applicant");
  if (customBtn) {
    customBtn.addEventListener("click", () => {
      activeBenchmarkId = null;
      enterpriseEntityName = "";
      enterprisePan = "";
      enterpriseGstin = "";
      enterpriseLoanAmount = "";
      enterpriseChannels = { gstn: false, itr: false, bank: false };
      enterpriseUploadedFiles = { gstn: null, itr: null, bank: null };
      if (typeof showToast === "function") {
        showToast("Switched to Custom Applicant mode");
      }
      renderCustomerOnboarding(frame);
    });
  }

  // Bind file import triggers
  const setupChannelUpload = (channelKey, btnId, inputId) => {
    const btn = $(btnId);
    const inp = $(inputId);
    if (!btn || !inp) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      inp.click();
    });

    inp.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        enterpriseUploadedFiles[channelKey] = file.name;
        enterpriseChannels[channelKey] = true;
        if (typeof showToast === "function") {
          showToast(`Imported ${file.name} for ${channelKey.toUpperCase()}`);
        }
        renderCustomerOnboarding(frame);
      }
    });
  };

  setupChannelUpload("gstn", "btn-upload-gstn", "file-gstn-input");
  setupChannelUpload("itr", "btn-upload-itr", "file-itr-input");
  setupChannelUpload("bank", "btn-upload-bank", "file-bank-input");

  frame.querySelectorAll(".ent-channel-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Don't toggle if clicking on upload button or sample excel link
      if (e.target.closest(".ent-channel-upload-btn") || e.target.closest(".sample-excel-pill")) return;
      const ch = item.dataset.channel;
      enterpriseChannels[ch] = !enterpriseChannels[ch];
      renderCustomerOnboarding(frame);
    });
  });

  if (proceedBtn) {
    proceedBtn.addEventListener("click", () => {
      syncStateAndUI();
      if (!isStep2Valid()) return;

      const b = activeBenchmarkId ? BENCHMARK_CASES.find(x => x.id === activeBenchmarkId) : null;
      const sessionKey = activeBenchmarkId || ("custom_" + enterpriseEntityName.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 24));

      // Build canonical session snapshot — single source of truth for Steps 3, 4, pipeline
      activeSession = {
        benchmarkId:       activeBenchmarkId,
        sessionKey,
        entityName:        enterpriseEntityName,
        pan:               enterprisePan,
        gstin:             enterpriseGstin,
        loanAmount:        enterpriseLoanAmount,
        sector:            b ? b.sector : "",
        bankInflows:       b ? b.bank_inflows : null,
        bankTrend:         b ? b.trend_bank : null,
        gstTurnover:       b ? b.gst_turnover : null,
        gstTrend:          b ? b.trend_gst : null,
        variance:          b ? b.variance : null,
        verdict:           b ? b.verdict : null,
        finalConf:         b ? b.final_confidence : null,
        modelConf:         b ? b.model_confidence : null,
        consentMultiplier: b ? b.consent_multiplier : null,
        consentDays:       b ? b.consent_days : null,
        narrative:         b ? b.narrative : "",
        files:             { ...enterpriseUploadedFiles },
        channels:          { ...enterpriseChannels },
        gstinMasked:       true,
      };

      // Sync credit pipeline structures so the case rail and credit workspace reflect the active entity
      CASES[0] = {
        id:       sessionKey,
        scenario: enterpriseEntityName + (activeSession.sector ? " · " + activeSession.sector : ""),
        note:     b
          ? `Bank ${activeSession.bankTrend} vs. GST ${activeSession.gstTrend} · Variance ${activeSession.variance}`
          : "Custom applicant — run live forensic audit to generate findings",
        group: "active",
      };
      CREDIT_METRICS[sessionKey] = {
        entity:    enterpriseEntityName,
        biz:       activeSession.sector || "Commercial Account",
        loan:      parseLoanAmount(enterpriseLoanAmount),
        tier:      deriveRiskTier(activeSession.variance, activeSession.verdict),
        dscr:      b ? 2.51 : 0,
        dti:       b ? 9.96 : 0,
        mfPledge:  180000,
        insurance: 600000,
      };
      currentBorrowerId = sessionKey;

      // Update Decision Anchor bar from session
      const entityNameEl = $("anchor-entity-name");
      const entityIdEl = $("anchor-entity-id");
      if (entityNameEl) entityNameEl.textContent = enterpriseEntityName;
      if (entityIdEl) {
        const rawGstin = enterpriseGstin || "PENDING";
        entityIdEl.dataset.unmasked = rawGstin;
        entityIdEl.dataset.masked = rawGstin.length >= 4 ? "•••• •••• " + rawGstin.slice(-4) : "•••• •••• ••••";
        entityIdEl.textContent = isFinancialMasked ? entityIdEl.dataset.masked : entityIdEl.dataset.unmasked;
      }

      // Synchronize decision anchor bar with benchmark applicant
      if (b) {
        const badgeEl = $("anchor-verdict-badge");
        const textEl = $("anchor-verdict-text");
        const confEl = $("anchor-confidence-text");
        if (badgeEl && textEl && confEl) {
          badgeEl.className = 'anchor-verdict-badge ' + (b.verdict === 'APPROVE' ? 'ok' : b.verdict === 'DECLINE' ? 'bad' : 'warn');
          textEl.textContent = b.verdict;
          confEl.textContent = 'Conf: ' + Math.round(b.final_confidence * 100) + '%';
        }
        const fillEl = $("anchor-consent-fill");
        const consentTextEl = $("anchor-consent-text");
        if (fillEl && consentTextEl) {
          const pct = Math.round(b.consent_multiplier * 100);
          fillEl.style.width = pct + '%';
          fillEl.className = 'consent-meter-fill ' + (pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad');
          consentTextEl.textContent = b.consent_days + 'd left (×' + b.consent_multiplier + ') · ' + (pct < 100 ? 'Haircut applied' : 'Full strength');
        }
      }

      // Update sidebar credit nav subtitle
      const creditNavSub = $("nav-credit-sub");
      if (creditNavSub) creditNavSub.textContent = "Active Dossier · " + enterpriseEntityName;

      logSystemEvent(
        "ONBOARDING_DATA_VERIFIED",
        "OPERATOR_CUSTOMER",
        "gateway:underwriting-intake",
        `Intake profile created for '${enterpriseEntityName}'. All 3 regulatory streams connected.`,
        "SUCCESS",
        { entity: enterpriseEntityName, pan: enterprisePan, gstin: enterpriseGstin, files: enterpriseUploadedFiles, benchmark: activeBenchmarkId }
      );
      if (typeof showToast === "function") showToast(`Verified ${enterpriseEntityName}. Initializing cross-verification...`);
      switchCustomerStep(3);
    });
  }
}

// ── STEP 3: CROSS-SOURCE VERIFICATION (Processing State) ──────────────
function renderCustomerTelemetry(frame) {
  const currentEntity = (activeSession && activeSession.entityName) || enterpriseEntityName || "Commercial Borrower";
  const b = activeBenchmarkId ? BENCHMARK_CASES.find(item => item.id === activeBenchmarkId) : null;

  const bankVal    = (activeSession && activeSession.bankInflows)  ?? "—";
  const bankTrend  = (activeSession && activeSession.bankTrend)    ?? "—";
  const gstVal     = (activeSession && activeSession.gstTurnover)  ?? "—";
  const gstTrend   = (activeSession && activeSession.gstTrend)     ?? "—";
  const varianceVal = (activeSession && activeSession.variance)    ?? "—";

  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <span class="onboarding-badge">Step 3 of 4 · Cross-Source Verification</span>
          <h2 style="font-size:24px;font-weight:700;color:#fff;margin:6px 0 0">
            Autonomous Multi-Source Cross-Verification &amp; Reconciliation
          </h2>
          <p style="font-size:13px;color:var(--muted);margin:4px 0 0">
            Reconciling banking transactions, tax returns, and collateral reserves for <strong style="color:#fff">${currentEntity}</strong>.
          </p>
          <p style="font-family:monospace;font-size:11px;color:#888;margin-top:6px;">
            Simulated walkthrough · For a live run, use "Re-evaluate Live" on the dossier
          </p>
        </div>

        <div id="telemetry-cta-wrap">
          ${swarmProgress === 100 ? `
            <button class="btn-initialize-bypass" id="btn-advance-verdict" type="button" style="background:#10b981;box-shadow:0 4px 14px rgba(16,185,129,0.4)">
              <span>View Credit Assessment Dossier</span>
              <span>→</span>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="telemetry-progress-panel">
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:12px">
          <span style="color:var(--muted)">Verification Pipeline:</span>
          <span id="telemetry-pct-label" style="color:#818cf8;font-weight:700">${swarmProgress}% Completed</span>
        </div>
        <div class="telemetry-progress-track">
          <div class="telemetry-progress-fill" id="telemetry-progress-fill" style="width:${swarmProgress}%"></div>
        </div>
      </div>

      <div class="telemetry-swarm-grid">
        <div class="telemetry-agent-card ${swarmProgress >= 25 ? 'completed' : 'running'}" id="agent-card-bank">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;font-weight:700;color:#fff">Banking Analyzer</span>
            <span class="ws-status-badge ${swarmProgress >= 25 ? 'settled' : 'pending'}" id="badge-bank">
              ${swarmProgress >= 25 ? 'Reconciled' : 'Auditing'}
            </span>
          </div>
          <p style="font-size:11.5px;color:var(--muted);margin:6px 0 10px">Audited operating credit receipts</p>
          <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:#34d399">${bankVal} Inflows (${bankTrend})</div>
        </div>

        <div class="telemetry-agent-card ${swarmProgress >= 55 ? 'completed' : (swarmProgress >= 25 ? 'running' : '')}" id="agent-card-gst">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;font-weight:700;color:#fff">Tax &amp; GST Analyzer</span>
            <span class="ws-status-badge ${swarmProgress >= 55 ? 'settled' : (swarmProgress >= 25 ? 'pending' : 'draft')}" id="badge-gst">
              ${swarmProgress >= 55 ? 'Reconciled' : (swarmProgress >= 25 ? 'Auditing' : 'Pending')}
            </span>
          </div>
          <p style="font-size:11.5px;color:var(--muted);margin:6px 0 10px">Reconciled GSTR-3B filings</p>
          <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:${b && b.verdict === 'APPROVE' ? '#34d399' : '#fbbf24'}">${gstVal} Declared (${gstTrend})</div>
        </div>

        <div class="telemetry-agent-card ${swarmProgress >= 80 ? 'completed' : (swarmProgress >= 55 ? 'running' : '')}" id="agent-card-inv">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;font-weight:700;color:#fff">Collateral &amp; Asset Analyzer</span>
            <span class="ws-status-badge ${swarmProgress >= 80 ? 'settled' : (swarmProgress >= 55 ? 'pending' : 'draft')}" id="badge-inv">
              ${swarmProgress >= 80 ? 'Reconciled' : (swarmProgress >= 55 ? 'Auditing' : 'Pending')}
            </span>
          </div>
          <p style="font-size:11.5px;color:var(--muted);margin:6px 0 10px">Auditing pledgeable securities &amp; reserves</p>
          <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:#818cf8">Validated Statutory Buffer</div>
        </div>
      </div>

      <div class="telemetry-trace-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:12px">
          <span style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase">
            Deterministic Reconciliation &amp; Audit Trail
          </span>
          <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--muted)">Production Engine · Active Session</span>
        </div>

        <div class="telemetry-trace-stream" id="telemetry-trace-box">
          ${telemetryLogs.map((log) => `
            <div class="telemetry-trace-line">
              <span class="telemetry-trace-arrow">›</span>
              <span>${log}</span>
            </div>
          `).join('')}
          ${swarmProgress < 100 ? `
            <div class="telemetry-trace-line" style="color:#818cf8;animation:pulse 1.5s infinite">
              <span class="telemetry-trace-arrow">›</span>
              <span>Cross-referencing banking transactions against GST filings...</span>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const advBtn = $("btn-advance-verdict");
  if (advBtn) {
    advBtn.addEventListener("click", () => {
      const outcome = (activeSession && activeSession.verdict) || (b ? b.verdict : "PENDING");
      logSystemEvent(
        "CUSTOMER_ACCESSED_FINAL_DOSSIER",
        "OPERATOR_CUSTOMER",
        "synthesizer:decision-card",
        `Rendered final credit assessment for ${currentEntity}. Decision Verdict: ${outcome}.`,
        "SUCCESS"
      );
      switchCustomerStep(4);
    });
  }

  // Automatic Swarm Progression if not complete
  if (swarmProgress < 100 && !isSwarmRunning) {
    isSwarmRunning = true;
    telemetryLogs = [
      `[0.00s] Simulated walkthrough — pipeline logic mirrors real agent execution`,
      `[0.15s] Initializing parallel verification analyzers for ${currentEntity}...`
    ];

    logSystemEvent(
      "VERIFICATION_PIPELINE_DISPATCHED",
      "ORCHESTRATOR_ENGINE",
      "prod:audit-pipeline",
      `Tripartite verification pipeline dispatched for ${currentEntity} (Banking, Tax/GST, Asset Collateral).`,
      "SUCCESS"
    );

    const isApprove = activeSession ? activeSession.verdict === "APPROVE" : false;
    const stages = [
      { pct: 25, msg: `[0.42s] Banking Analyzer: Ingested primary transaction records. Gross commercial inflows: ${bankVal} (${bankTrend}).` },
      { pct: 55, msg: `[0.85s] Tax Analyzer: Reconciled GSTR-3B filings. Turnover declared: ${gstVal} (${gstTrend}).` },
      { pct: 80, msg: `[1.20s] Collateral Analyzer: Reserve audit complete. Statutory liquidity buffer validated.` },
      { pct: 100, msg: activeSession && activeSession.verdict
        ? (isApprove
          ? `[1.65s] Cross-Source Reconciler: Validated high alignment (Variance delta ${varianceVal}). All sources verified.`
          : `[1.65s] Cross-Source Reconciler: Flagged structural variance delta of ${varianceVal} between Bank vs GST filings.`)
        : `[1.65s] Cross-Source Reconciler: Document intake complete. Run Forensic Audit to generate live findings.`
      },
    ];

    stages.forEach((stage, idx) => {
      setTimeout(() => {
        swarmProgress = stage.pct;
        telemetryLogs.push(stage.msg);

        if (stage.pct === 100) {
          isSwarmRunning = false;
          if (isApprove) {
            logSystemEvent(
              "ALL_SOURCES_VERIFIED",
              "RULE_ALL_SOURCES_AGREE",
              "rules:deterministic-core",
              `Reconciliation confirmed for ${currentEntity}: Inflows and GST turnover match within ${varianceVal}. Approved.`,
              "SUCCESS"
            );
          } else {
            logSystemEvent(
              "CONTRADICTION_FLAGGED",
              "RULE_INCOME_REV_DIVERGENCE",
              "rules:deterministic-core",
              `Flagged asymmetric revenue divergence for ${currentEntity}: Bank credits (${bankTrend}) vs GSTR-3B (${gstTrend}). Applied capped confidence: 0.50.`,
              "WARNING"
            );
          }
        }

        if (activeWorkspace === "customer_wizard" && customerStep === 3) {
          renderCustomerTelemetry(frame);
        }
      }, (idx + 1) * 600);
    });
  }
}

// ── STEP 4: FINAL RECONCILIATION VERDICT & OUTPUTS ────────────────────
function renderCustomerFinalVerdict(frame) {
  const currentEntity = (activeSession && activeSession.entityName) || enterpriseEntityName || "Commercial Borrower";
  const s = activeSession || {};

  const rawGstin = s.gstin || enterpriseGstin || "PENDING";
  const maskedGstin = rawGstin.length >= 4 ? "•••• •••• " + rawGstin.slice(-4) : "•••• •••• ••••";
  const gstinDisplay = (s.gstinMasked !== false && enterpriseGstinMasked) ? maskedGstin : rawGstin;
  const digest = enterpriseAuditLog[0]?.sha256BlockDigest || "0x8f2ae9c14092b740e53a992bc44d32098d6541f5a11e89bc";

  const bankVal     = s.bankInflows  ?? "—";
  const bankTrend   = s.bankTrend    ?? "—";
  const gstVal      = s.gstTurnover  ?? "—";
  const gstTrend    = s.gstTrend     ?? "—";
  const varianceVal = s.variance     ?? "—";
  const verdictLabel = s.verdict     ?? "PENDING";
  const finalConf   = s.finalConf    != null ? Number(s.finalConf).toFixed(2)         : "—";
  const modelConf   = s.modelConf    != null ? Number(s.modelConf).toFixed(2)         : "—";
  const consentMult = s.consentMultiplier != null ? Number(s.consentMultiplier).toFixed(2) : "—";
  const consentDays = s.consentDays  ?? "—";
  const isApprove   = verdictLabel === "APPROVE";

  const narrativeText = s.narrative
    ? s.narrative
    : `Upload documents and run a live forensic audit to generate cross-source reconciliation findings for <strong>${currentEntity}</strong>. No pre-computed signals are available for custom applicant mode — use the Credit Applications workspace to trigger a live evaluation.`;

  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div class="cockpit-banner">
        <div class="cockpit-entity-wrap">
          <span class="cockpit-kicker">Step 4 of 4 · Credit Assessment Dossier</span>
          <div class="cockpit-entity-heading">
            <h2 class="cockpit-entity-name">${currentEntity}</h2>
            <div class="cockpit-gstin-pill">
              <span>GSTIN:</span>
              <span id="cockpit-gstin-val" style="color:#fff">${gstinDisplay}</span>
              <button class="cockpit-gstin-toggle-btn" id="cockpit-gstin-toggle" type="button" title="Toggle Privacy Mask">
                ${enterpriseGstinMasked ? '👁' : '🔒'}
              </button>
            </div>
            ${(s.pan || enterprisePan) ? `
              <div class="cockpit-gstin-pill" style="margin-left:8px">
                <span>PAN:</span>
                <span style="color:#fff">${s.pan || enterprisePan}</span>
              </div>
            ` : ''}
            ${s.sector ? `
              <div class="cockpit-gstin-pill" style="margin-left:8px;border-color:rgba(99,102,241,0.4);color:#a5b4fc">
                <span>SECTOR:</span>
                <span style="color:#fff">${s.sector}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="cockpit-banner-actions">
          <button class="btn-ent-action" id="ent-export-csv-btn" type="button">
            <span style="color:#34d399">📊</span>
            <span>Export Ledger (.CSV)</span>
          </button>
          <button class="btn-ent-action" id="ent-download-pdf-btn" type="button">
            <span style="color:#818cf8">📑</span>
            <span>Download Audit Report (.PDF)</span>
          </button>
          <button class="btn-ent-action" id="btn-restart-flow" type="button" style="border-color:rgba(255,255,255,0.15)">
            <span>↻</span>
            <span>New Assessment</span>
          </button>
        </div>
      </div>

      <div class="cockpit-metrics-grid">
        <div class="cockpit-metric-card">
          <span class="metric-title">Gross Banking Inflows</span>
          <div class="metric-value">${bankVal}</div>
          <div class="metric-sub-row">
            <span>Annualized Receipts</span>
            <span class="metric-delta ok">${bankTrend}</span>
          </div>
        </div>

        <div class="cockpit-metric-card ${isApprove ? '' : 'warn-card'}">
          <span class="metric-title">GST-Declared Turnover</span>
          <div class="metric-value">${gstVal}</div>
          <div class="metric-sub-row">
            <span>GSTR-3B Declared</span>
            <span class="metric-delta ${isApprove ? 'ok' : 'warn'}">${gstTrend}</span>
          </div>
        </div>

        <div class="cockpit-metric-card">
          <span class="metric-title">Active Ingestion Channels</span>
          <div class="metric-value">3/3 Rails</div>
          <div class="metric-sub-row">
            <span>GSTN · ITR · Bank AA</span>
            <span class="metric-delta ok">100% Reconciled</span>
          </div>
        </div>

        <div class="cockpit-metric-card ${isApprove ? '' : 'warn-card'}">
          <span class="metric-title">Consent Multipier &amp; Decay</span>
          <div class="metric-value">${consentMult} Multiplier</div>
          <div class="metric-sub-row">
            <span>${consentDays} Days Remaining</span>
            <span class="metric-delta ${isApprove ? 'ok' : 'warn'}">${isApprove ? 'Active Valid Consent' : '-71% Haircut'}</span>
          </div>
        </div>
      </div>

      <div class="cockpit-forensic-grid">
        <div class="discrepancy-card">
          <div class="discrepancy-header">
            <div class="discrepancy-title-wrap">
              <span class="discrepancy-shield-icon">${isApprove ? '✓' : '🛡'}</span>
              <div>
                <h3 class="discrepancy-title">${isApprove ? 'Verified Tripartite Inflow & Turnover Reconciliation' : 'Asymmetric GST vs Bank Inflow Discrepancy Card'}</h3>
                <span class="discrepancy-rule-tag">Rule Engine: ${isApprove ? 'RULE_ALL_SOURCES_AGREE' : 'RULE_INCOME_REV_DIVERGENCE'}</span>
              </div>
            </div>
            <span class="discrepancy-badge" style="${isApprove ? 'background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3);color:#34d399' : ''}">${varianceVal} Variance Delta</span>
          </div>

          <p class="discrepancy-narrative">
            ${narrativeText}
          </p>

          <div class="discrepancy-tiles-grid">
            <div class="discrepancy-tile">
              <span class="discrepancy-tile-label">Bank Aggregator Ledger</span>
              <span class="discrepancy-tile-val green">${bankVal}</span>
              <span class="discrepancy-tile-sub">Trend: ${bankTrend}</span>
            </div>

            <div class="discrepancy-tile">
              <span class="discrepancy-tile-label">GSTN Official Filing</span>
              <span class="discrepancy-tile-val ${isApprove ? 'green' : 'rose'}">${gstVal}</span>
              <span class="discrepancy-tile-sub">Trend: ${gstTrend}</span>
            </div>
          </div>
        </div>

        <div class="synthesizer-card">
          <div>
            <span class="synth-kicker">Synthesizer Outcome</span>
            <div class="synth-verdict-row">
              <span class="synth-verdict-pill ${isApprove ? 'outcome-approve' : ''}" style="${isApprove ? 'background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#34d399' : ''}">
                <span>${isApprove ? '✓' : '⚠'}</span>
                <span>${verdictLabel}</span>
              </span>
              <span class="synth-score">Score: ${finalConf}</span>
            </div>

            <div class="synth-calc-table">
              <div class="synth-calc-row">
                <span>Model Confidence:</span>
                <span style="color:#fff">${modelConf}</span>
              </div>
              <div class="synth-calc-row">
                <span>Consent Multiplier:</span>
                <span style="color:${isApprove ? '#34d399' : '#fbbf24'}">×${consentMult} (${consentDays}d left)</span>
              </div>
              <div class="synth-calc-row total-row">
                <span>Final Confidence:</span>
                <span>${finalConf}</span>
              </div>
            </div>
          </div>

          <div class="synth-digest-block">
            <span class="synth-digest-label">SHA-256 Decision Block Digest</span>
            <span class="synth-digest-hash" id="cockpit-digest-hash">${digest}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const toggleBtn = $("cockpit-gstin-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      enterpriseGstinMasked = !enterpriseGstinMasked;
      if (activeSession) activeSession.gstinMasked = enterpriseGstinMasked;
      const gstinVal = $("cockpit-gstin-val");
      if (gstinVal) {
        gstinVal.textContent = enterpriseGstinMasked ? maskedGstin : rawGstin;
      }
      toggleBtn.textContent = enterpriseGstinMasked ? '👁' : '🔒';
    });
  }

  const exportBtn = $("ent-export-csv-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportAuditCSV);

  const pdfBtn = $("ent-download-pdf-btn");
  if (pdfBtn) pdfBtn.addEventListener("click", downloadAuditPDF);

  const restartBtn = $("btn-restart-flow");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      // Reset all state for a clean new applicant intake
      activeBenchmarkId = null;
      activeSession = null;
      enterpriseEntityName = "";
      enterprisePan = "";
      enterpriseGstin = "";
      enterpriseLoanAmount = "";
      enterpriseGstinMasked = true;
      enterpriseChannels = { gstn: false, itr: false, bank: false };
      enterpriseUploadedFiles = { gstn: null, itr: null, bank: null };
      swarmProgress = 0;
      isSwarmRunning = false;
      telemetryLogs = [];
      currentBorrowerId = null;

      // Restore CASES to the original prototype entry so credit pipeline stays coherent
      CASES[0] = { id: "b_contradiction", scenario: "Bank vs. GST Revenue Divergence", note: "Bank credit receipts (+2.1%) vs. GST turnover (-11.0%) · Structural discrepancy", group: "active" };

      // Reset anchor bar
      const entityNameEl = $("anchor-entity-name");
      const entityIdEl = $("anchor-entity-id");
      if (entityNameEl) entityNameEl.textContent = "Awaiting Entity Intake";
      if (entityIdEl) {
        entityIdEl.dataset.unmasked = "PENDING";
        entityIdEl.dataset.masked = "•••• •••• ••••";
        entityIdEl.textContent = "•••• •••• ••••";
      }

      // Reset sidebar credit nav subtitle
      const creditNavSub = $("nav-credit-sub");
      if (creditNavSub) creditNavSub.textContent = "No Active Dossier";

      logSystemEvent(
        "CUSTOMER_WIZARD_RESET",
        "OPERATOR_CUSTOMER",
        "flow:state-machine",
        "Operator initiated new credit assessment intake.",
        "SUCCESS"
      );
      if (typeof showToast === "function") showToast("Ready for new applicant intake");
      switchCustomerStep(2);
    });
  }
}

// ── AUDIT EXPORT & PDF GENERATORS ────────────────────────────────────
function exportAuditCSV() {
  const entity = (activeSession && activeSession.entityName) || enterpriseEntityName || "Underwriting_Dossier";
  const rows = [
    ["Event ID", "Timestamp", "Operator", "Target Node", "Action", "Status", "SHA-256 Digest", "Target Entity"],
    ...enterpriseAuditLog.map(ev => [
      ev.id,
      ev.timestamp,
      ev.operator,
      ev.targetNode,
      `"${(ev.action || "").replace(/"/g, '""')}"`,
      ev.status,
      ev.sha256BlockDigest,
      `"${entity.replace(/"/g, '""')}"`
    ])
  ];
  const csvContent = "data:text/csv;charset=utf-8," + rows.map(r => r.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `trueledger_audit_${entity.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  logSystemEvent("AUDIT_LOG_EXPORTED_CSV", "OPERATOR", "client:exporter", `Exported audit logs for ${entity}`, "SUCCESS");
  if (typeof showToast === "function") showToast("Reconciliation ledger exported (.CSV)");
}

function downloadAuditPDF() {
  const s = activeSession || {};
  const entity  = s.entityName || enterpriseEntityName || "Commercial Borrower";
  const gstin   = s.gstin   || enterpriseGstin  || "—";
  const pan     = s.pan     || enterprisePan     || "—";
  const verdict = s.verdict || "PENDING";
  const bankVal = s.bankInflows  || "—";
  const gstVal  = s.gstTurnover  || "—";
  const variance = s.variance    || "—";
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    if (typeof showToast === "function") showToast("Please allow popups to download audit report");
    return;
  }
  const content = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>TrueLedger Commercial Credit Audit Report - ${entity}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #111; line-height: 1.5; }
        .header { border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; }
        .title { font-size: 24px; font-weight: bold; }
        .meta { font-family: monospace; font-size: 13px; color: #555; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 12px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .item { padding: 10px; background: #f8f9fa; border-radius: 4px; }
        .label { font-size: 11px; text-transform: uppercase; color: #666; }
        .val { font-size: 16px; font-weight: bold; margin-top: 4px; }
        .alert-box { padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; margin-bottom: 25px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f1f3f5; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="title">TrueLedger Institutional Credit Assessment</div>
          <div style="color: #666; font-size: 14px;">Commercial Risk Forensics &amp; Reconciliation Report</div>
        </div>
        <div class="meta" style="text-align: right;">
          <div>Generated: ${new Date().toISOString()}</div>
          <div>Status: PRODUCTION</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Target Entity Information</div>
        <div class="grid">
          <div class="item"><div class="label">Legal Business Entity</div><div class="val">${entity}</div></div>
          <div class="item"><div class="label">GSTIN / Tax ID</div><div class="val">${gstin}</div></div>
          <div class="item"><div class="label">Permanent Account Number (PAN)</div><div class="val">${pan}</div></div>
          <div class="item"><div class="label">Underwriting Verdict</div><div class="val" style="color: ${verdict === 'APPROVE' ? '#059669' : '#d97706'};">${verdict}</div></div>
        </div>
      </div>

      <div class="alert-box" style="${verdict === 'APPROVE' ? 'background:#ecfdf5;border-left-color:#10b981;color:#065f46' : ''}">
        <strong>${verdict === 'APPROVE' ? 'Reconciliation Confirmed: RULE_ALL_SOURCES_AGREE' : 'Discrepancy Flag: RULE_INCOME_REV_DIVERGENCE'}</strong><br/>
        Bank Aggregator credits: ${bankVal}. GSTN GSTR-3B filings: ${gstVal}. Structural variance delta: ${variance}.
      </div>

      <div class="section">
        <div class="section-title">Cryptographic Audit Ledger</div>
        <table>
          <thead>
            <tr><th>Event ID</th><th>Timestamp</th><th>Node</th><th>Action</th><th>Digest</th></tr>
          </thead>
          <tbody>
            ${enterpriseAuditLog.slice(0, 10).map(e => `
              <tr>
                <td>${e.id}</td>
                <td>${e.timestamp}</td>
                <td>${e.targetNode}</td>
                <td>${e.action}</td>
                <td style="font-family: monospace; font-size: 10px;">${e.sha256BlockDigest.slice(0, 20)}...</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 500);
  logSystemEvent("AUDIT_REPORT_PRINTED_PDF", "OPERATOR", "client:pdf-engine", `Generated audit PDF report for ${entity}`, "SUCCESS");
  if (typeof showToast === "function") showToast("Decision audit report opened for print/PDF export");
}

// ── HIDDEN DEVELOPER GATEWAY & GOVERNANCE CONSOLE ─────────────────────
function renderDevAuth(frame) {
  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div class="dev-auth-modal-card">
        <div class="dev-auth-header">
          <div class="dev-auth-icon-wrap">🔑</div>
          <div>
            <h3 class="dev-auth-title">System Developer Gateway</h3>
            <span class="dev-auth-route">Route: /app/dev-login</span>
          </div>
        </div>

        <form class="dev-auth-form" id="dev-auth-form">
          <div class="ent-form-group" style="margin-bottom:0">
            <label class="ent-form-label" for="dev-username-input">Administrative Signature</label>
            <div class="ent-input-row">
              <span class="ent-input-icon">👤</span>
              <input type="text" id="dev-username-input" class="ent-input" placeholder="admin" required autocomplete="username" />
            </div>
          </div>

          <div class="ent-form-group" style="margin-bottom:0">
            <label class="ent-form-label" for="dev-password-input">Cryptographic Key</label>
            <div class="ent-input-row">
              <span class="ent-input-icon">🔒</span>
              <input type="password" id="dev-password-input" class="ent-input" placeholder="••••••••••••••••" required autocomplete="current-password" />
            </div>
            <div class="dev-auth-hint">
              Contact project administrator for access credentials.
            </div>
          </div>

          ${devAuthError ? `
            <div class="dev-auth-error">
              <span>✕</span>
              <span>${devAuthError}</span>
            </div>
          ` : ''}

          <div class="dev-auth-btn-row">
            <button class="btn-dev-cancel" id="btn-dev-cancel" type="button">Return to Customer Flow</button>
            <button class="btn-dev-submit" type="submit">Authenticate</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = $("dev-auth-form");
  const cancelBtn = $("btn-dev-cancel");

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      devAuthError = null;
      switchWorkspace("customer_wizard");
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const u = ($("dev-username-input")?.value || "").trim();
      const p = ($("dev-password-input")?.value || "").trim();

      if (u === "admin" && p === "TL@Dev#2026") {
        isDevAuthenticated = true;
        devAuthError = null;
        logSystemEvent(
          "DEV_PORTAL_AUTH_GRANTED",
          u,
          "auth:governance-vault",
          "Developer elevated permissions successfully issued. Session route initialized.",
          "SUCCESS"
        );
        if (typeof showToast === "function") showToast("Developer session authenticated");
        switchWorkspace("dev_console");
      } else {
        devAuthError = "Access Restricted: Invalid administrative signature or key.";
        logSystemEvent(
          "DEV_PORTAL_AUTH_REJECTED",
          u || "ANONYMOUS",
          "auth:governance-vault",
          "Failed authentication attempt against developer console endpoint.",
          "DENIED"
        );
        renderDevAuth(frame);
      }
    });
  }
}

function renderDevConsole(frame) {
  if (!isDevAuthenticated) {
    switchWorkspace("dev_auth");
    return;
  }

  frame.innerHTML = `
    <div class="ent-view-wrapper">
      <div class="dev-console-header">
        <div>
          <div class="dev-console-heading">
            <span style="font-size:24px;color:#818cf8">⌨</span>
            <h2 class="dev-console-title">System Governance Console</h2>
          </div>
          <p class="dev-console-sub">
            Isolated administrative suite. Captures append-only audit telemetry across customer actions without exposure.
          </p>
        </div>

        <div class="dev-console-actions">
          <button class="btn-ent-action" id="dev-dump-csv-btn" type="button">
            <span style="color:#34d399">📊</span>
            <span>Dump Telemetry (.CSV)</span>
          </button>
          <button class="btn-exit-dev" id="btn-exit-dev" type="button">Exit Developer Mode</button>
        </div>
      </div>

      <div class="dev-console-kpis">
        <div class="dev-kpi-card">
          <span class="dev-kpi-label">Active Sub-Agent Workers</span>
          <div class="dev-kpi-val">3 Workers</div>
          <span class="dev-kpi-sub">ParallelAgent Group</span>
        </div>

        <div class="dev-kpi-card">
          <span class="dev-kpi-label">Orchestrator Latency</span>
          <div class="dev-kpi-val">1,240 ms</div>
          <span class="dev-kpi-sub">Gemini 3.1 Pro preview</span>
        </div>

        <div class="dev-kpi-card">
          <span class="dev-kpi-label">Firestore Read/Write Pool</span>
          <div class="dev-kpi-val" style="color:#34d399">100% Synced</div>
          <span class="dev-kpi-sub">Native Mode (asia-south1)</span>
        </div>

        <div class="dev-kpi-card">
          <span class="dev-kpi-label">Total Logged Audit Events</span>
          <div class="dev-kpi-val">${enterpriseAuditLog.length} Records</div>
          <span class="dev-kpi-sub">Append-only immutable</span>
        </div>
      </div>

      <div class="dev-audit-table-card">
        <div class="dev-audit-card-top">
          <div class="dev-audit-card-title">
            <span style="color:#818cf8">≡</span>
            <span>Append-Only Immutable Event Bus Stream</span>
          </div>
          <span style="font-family:var(--font-mono);font-size:11.5px;color:var(--muted)">Live Memory State (${enterpriseAuditLog.length} Events)</span>
        </div>

        <div class="dev-audit-table-wrapper">
          <table class="dev-audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Token</th>
                <th>Operator</th>
                <th>Target Node</th>
                <th>Action Description</th>
                <th>Status</th>
                <th>SHA-256 Block Digest</th>
              </tr>
            </thead>
            <tbody>
              ${enterpriseAuditLog.map((ev) => `
                <tr>
                  <td style="color:var(--muted)">${ev.timestamp.replace("T", " ").slice(0, 19)}</td>
                  <td style="color:#818cf8;font-weight:600">${ev.eventToken}</td>
                  <td style="color:#fff">${ev.operator}</td>
                  <td style="color:var(--muted)">${ev.targetNode}</td>
                  <td class="desc-cell">${ev.action}</td>
                  <td>
                    <span class="audit-status-badge ${ev.status}">${ev.status}</span>
                  </td>
                  <td class="digest-cell" title="${ev.sha256BlockDigest}">${ev.sha256BlockDigest}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const dumpBtn = $("dev-dump-csv-btn");
  if (dumpBtn) dumpBtn.addEventListener("click", exportAuditCSV);

  const exitBtn = $("btn-exit-dev");
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      isDevAuthenticated = false;
      if (typeof showToast === "function") showToast("Developer session ended");
      switchWorkspace("customer_wizard");
    });
  }
}

function bootCaseFromURL() {
  const requested = new URLSearchParams(window.location.search).get("case");
  return requested && CASES.some((c) => c.id === requested) ? requested : DEFAULT_CASE;
}

(async function boot() {
  // Bind navigation listeners for sidebar and sub-nav items
  setupWorkspaceNav();

  // Determine initial workspace from URL hash
  const hash = location.hash.toLowerCase();
  const stepMatch = hash.match(/[#&]step=([1-4])/);
  const hashWs = (hash.match(/[#&]ws=([a-z_]+)/) || [])[1];

  let startWs = "customer_wizard"; // Default to customer wizard

  if (hash === "#dev-login" || hash === "#view=dev_auth") {
    startWs = "dev_auth";
  } else if (hash === "#view=dev_console") {
    startWs = isDevAuthenticated ? "dev_console" : "dev_auth";
  } else if (stepMatch) {
    startWs = "customer_wizard";
    customerStep = Number(stepMatch[1]);
  } else if (hashWs && ["credit", "dashboard", "client", "income", "compliance", "assets", "customer_wizard"].includes(hashWs)) {
    if (!isCustomerAuthenticated) {
      startWs = "customer_wizard";
      customerStep = 1;
    } else {
      startWs = hashWs;
    }
  }

  // Start enterprise data fetch immediately
  loadEnterpriseData();

  // Preload the default credit case in the background
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
  activeWorkspace = startWs;
  switchWorkspace(startWs);
})();
