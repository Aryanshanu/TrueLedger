// TrueLedger - Underwriting Desk.
//
// Design intent (see the design-review thread this implements): never show
// an empty state - a case auto-loads on page load, agents visibly work in
// parallel and converge on an orchestrator rather than reading as a linear
// progress bar, the contradiction is the loudest thing on screen rather
// than buried behind a click, and the consent-decay mechanism gets its own
// visual weight instead of a thin strip.
//
// One deliberate honesty constraint: the case rail describes each
// scenario ("Bank vs. GST disagree"), never a pre-claimed *result* - the
// loud colored outcome only ever appears after the real POST /evaluate
// call actually returns. Pre-showing "will approve" before the agent has
// run would quietly misrepresent a live system as a scripted one.

const BACKEND_URL = (window.__CONFIG__ && window.__CONFIG__.BACKEND_URL) || "http://localhost:8081";

const CASES = [
  { id: "b_clean", scenario: "All sources agree", note: "Healthy, straightforward case" },
  { id: "b_contradiction", scenario: "Bank vs. GST disagree", note: "The centerpiece contradiction" },
  { id: "b_stale_consent", scenario: "Bank consent expiring", note: "Confidence decay in action" },
];

const DEFAULT_CASE = "b_contradiction";

// A judge's first 5 seconds can't be a 10-30s live Vertex AI call. This is
// a cached sample run, clearly labeled as such in the UI (never silently
// passed off as live) - its decision values are the real confirmed result
// from this project's own live golden-path run; the ledger/consent detail
// is schema-accurate representative data, since that level of per-step
// detail wasn't captured verbatim from that run. "Run live" always
// replaces it with a real call.
const CACHED_SAMPLE = {
  b_contradiction: {
    isSample: true,
    decision: {
      borrower_id: "b_contradiction", outcome: "manual_review", final_confidence: 0.5,
      model_confidence: 0.5, weakest_consent_source: "gst_findings",
      contradictions: [{
        rule: "income_vs_revenue_divergence", metric: "income_vs_revenue",
        finding: "Bank shows stable income (+2.1%); GST shows declining revenue (-11.0%)",
        evidence: [{ source: "bank_findings", field: "income_trend" }, { source: "gst_findings", field: "revenue_trend" }],
        action: "cap_confidence_0.5",
      }],
      risk_factors: [], ledger_step_ids: ["stp_00023"], generated_at: "2026-10-03T06:39:00Z",
    },
    ledgerSteps: [
      { step_id: "stp_00013", borrower_id: "b_contradiction", agent: "bank_statement_agent", timestamp: "2026-10-03T06:39:10Z", action: "record_claim", input_refs: [], claim: { metric: "income_trend", value: "stable", magnitude_pct: 2.1, evidence: [{ transaction_ids: ["txn_901", "txn_902"], period: "2026-06 to 2026-09" }], confidence: 0.86 }, confidence: 0.86, notes: "" },
      { step_id: "stp_00014", borrower_id: "b_contradiction", agent: "bank_statement_agent", timestamp: "2026-10-03T06:39:10Z", action: "record_claim", input_refs: [], claim: { metric: "cash_flow_volatility", value: "low", evidence: [{ period: "2026-06 to 2026-09" }], confidence: 0.9 }, confidence: 0.9, notes: "" },
      { step_id: "stp_00015", borrower_id: "b_contradiction", agent: "gst_tax_agent", timestamp: "2026-10-03T06:39:12Z", action: "record_claim", input_refs: [], claim: { metric: "revenue_trend", value: "declining", magnitude_pct: -11.0, evidence: [{ period: "2026-08" }, { period: "2026-09" }], confidence: 0.84 }, confidence: 0.84, notes: "" },
      { step_id: "stp_00020", borrower_id: "b_contradiction", agent: "investment_agent", timestamp: "2026-10-03T06:39:20Z", action: "record_claim", input_refs: [], claim: { metric: "liquid_assets", value: "high", evidence: [{ transaction_ids: ["Synthetic Flexicap Fund"], field: "total_current_value", source: "MUTUAL_FUNDS" }], confidence: 0.75 }, confidence: 0.75, notes: "" },
      { step_id: "stp_00021", borrower_id: "b_contradiction", agent: "orchestrator_agent", timestamp: "2026-10-03T06:39:40Z", action: "flag_contradiction", input_refs: ["claims/b_contradiction/bank_findings", "claims/b_contradiction/gst_findings"], claim: { rule: "income_vs_revenue_divergence", metric: "income_vs_revenue", finding: "Bank shows stable income (+2.1%); GST shows declining revenue (-11.0%)", evidence: [{ source: "bank_findings", field: "income_trend" }, { source: "gst_findings", field: "revenue_trend" }], action: "cap_confidence_0.5" }, confidence: 0.5, notes: "Contradiction rule: income_vs_revenue_divergence" },
      { step_id: "stp_00022", borrower_id: "b_contradiction", agent: "orchestrator_agent", timestamp: "2026-10-03T06:39:45Z", action: "apply_consent_decay", input_refs: ["consent/b_contradiction"], claim: { model_confidence: 0.5, weakest_source: "gst_findings", final_confidence: 0.5 }, confidence: 0.5, notes: "c(d) = 1 if d>7" },
      { step_id: "stp_00023", borrower_id: "b_contradiction", agent: "orchestrator_agent", timestamp: "2026-10-03T06:39:47Z", action: "final_decision", input_refs: [], claim: { outcome: "manual_review" }, confidence: 0.5, notes: "outcome=manual_review" },
    ],
    consentSources: [
      { source: "bank_findings", fi_type: "DEPOSIT", expires_at: "2026-11-02T00:00:00Z", days_remaining: 30, confidence_multiplier: 1.0 },
      { source: "gst_findings", fi_type: "GSTR1_3B", expires_at: "2026-11-02T00:00:00Z", days_remaining: 30, confidence_multiplier: 1.0 },
      { source: "investment_findings", fi_type: "MUTUAL_FUNDS+INSURANCE_POLICIES", expires_at: "2026-11-02T00:00:00Z", days_remaining: 30, confidence_multiplier: 1.0 },
    ],
  },
};

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

const $ = (id) => document.getElementById(id);

// Per-borrower cache: { decision, ledgerSteps, consentSources }. Lets the
// Replay button and re-clicking an already-loaded case skip the network
// entirely and just re-play the reveal animation.
const cache = new Map();
let currentBorrowerId = null;
let loadToken = 0; // guards against a stale, slow response landing after a newer click

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

// ---------- Case rail ----------

function renderCaseRail() {
  const rail = $("case-rail");
  rail.querySelectorAll(".case-card").forEach((n) => n.remove());

  CASES.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "case-card" + (c.id === currentBorrowerId ? " active" : "");
    btn.dataset.borrowerId = c.id;

    const cached = cache.get(c.id);
    const statusClass = cached ? `result-${cached.decision.outcome}` : "";
    const statusText = cached
      ? `${OUTCOME_META[cached.decision.outcome].icon} ${OUTCOME_META[cached.decision.outcome].label} (${cached.decision.final_confidence.toFixed(2)})`
      : "Not yet run";

    btn.innerHTML = `
      <div class="case-card-id mono">${c.id}${c.id === currentBorrowerId ? '<span class="case-card-viewing"> · viewing</span>' : ""}</div>
      <div class="case-card-scenario">${c.scenario}</div>
      <div class="case-card-status ${statusClass}"><span class="status-dot"></span>${statusText}</div>
    `;
    btn.onclick = () => loadBorrower(c.id, { forceRefetch: false });
    rail.appendChild(btn);
  });
}

// ---------- Pipeline canvas (SVG) ----------

function pipelineSvg() {
  return `
<svg viewBox="0 0 640 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path id="conn-bank" class="connector" d="M166,32 C 240,32 240,100 300,100" />
  <path id="conn-gst" class="connector" d="M166,100 C 230,100 230,100 300,100" />
  <path id="conn-investment" class="connector" d="M166,168 C 240,168 240,100 300,100" />
  <path id="conn-out" class="connector" d="M450,100 L620,100" />

  <g id="node-bank">
    <rect class="node-box" x="16" y="10" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="30">Bank agent</text>
    <text class="node-sublabel" x="30" y="44">DEPOSIT</text>
  </g>
  <g id="node-gst">
    <rect class="node-box" x="16" y="78" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="98">GST/Tax agent</text>
    <text class="node-sublabel" x="30" y="112">GSTR1_3B</text>
  </g>
  <g id="node-investment">
    <rect class="node-box" x="16" y="146" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="30" y="166">MF/Insurance agent</text>
    <text class="node-sublabel" x="30" y="180">MUTUAL_FUNDS + INSURANCE</text>
  </g>
  <g id="node-orchestrator">
    <rect class="node-box orchestrator" x="300" y="78" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="314" y="98">Orchestrator</text>
    <text class="node-sublabel" x="314" y="112">rules + reasoning + decay</text>
  </g>
</svg>`;
}

function setConnectorDrawn(id, drawn, contradiction) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("drawn", !!drawn);
  el.classList.toggle("contradiction", !!contradiction);
}

function resetPipelineCanvas() {
  $("pipeline-canvas").innerHTML = pipelineSvg();
}

// ---------- Divergence chart ----------

function findClaim(ledgerSteps, agent, metric) {
  const entry = ledgerSteps.find((e) => e.agent === agent && e.action === "record_claim" && e.claim && e.claim.metric === metric);
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
// our synthetic data; prefer the bank claim's "YYYY-MM to YYYY-MM" range
// (a single clean range string) and fall back to the min/max of the GST
// claim's individual per-period evidence entries if that's unavailable.
function periodRange(bankClaim, gstClaim) {
  if (bankClaim && bankClaim.evidence[0] && bankClaim.evidence[0].period && bankClaim.evidence[0].period.includes(" to ")) {
    const [start, end] = bankClaim.evidence[0].period.split(" to ").map((s) => s.trim());
    return [start, end];
  }
  const periods = ((gstClaim && gstClaim.evidence) || []).map((e) => e.period).filter(Boolean).sort();
  return [periods[0], periods[periods.length - 1]];
}

function divergenceSvg(bankClaim, gstClaim, hasContradiction) {
  const scale = 2.2;
  const clamp = (v) => Math.max(14, Math.min(110, v));
  const baseY = 62;
  const bankPct = bankClaim ? bankClaim.magnitude_pct : 0;
  const gstPct = gstClaim ? gstClaim.magnitude_pct : 0;
  const bankY = clamp(baseY - bankPct * scale);
  const gstY = clamp(baseY - gstPct * scale);
  const startX = 54;
  const endX = 360;
  const [startLabel, endLabel] = periodRange(bankClaim, gstClaim);
  const gapPts = Math.abs(bankPct - gstPct).toFixed(1);

  return `
<svg viewBox="0 0 400 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="${startX}" y1="${baseY}" x2="${endX}" y2="${baseY}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 3"></line>
  <polygon class="gap-band ${hasContradiction ? "show pulse" : ""}" points="${startX},${baseY} ${endX},${bankY} ${endX},${gstY}"></polygon>
  <polyline class="signal-line bank" points="${startX},${baseY} ${endX},${bankY}"></polyline>
  <polyline class="signal-line gst" points="${startX},${baseY} ${endX},${gstY}"></polyline>

  <circle class="signal-dot bank" cx="${startX}" cy="${baseY}" r="3"></circle>
  <circle class="signal-dot bank" cx="${endX}" cy="${bankY}" r="3.5"></circle>
  <circle class="signal-dot gst" cx="${endX}" cy="${gstY}" r="3.5"></circle>

  <text x="${endX - 50}" y="${bankY - 9}" class="node-sublabel chart-value" fill="var(--signal-bank)">${bankClaim ? fmtPct(bankPct) : "n/a"}</text>
  <text x="${endX - 50}" y="${gstY + 17}" class="node-sublabel chart-value" fill="var(--signal-gst)">${gstClaim ? fmtPct(gstPct) : "n/a"}</text>

  <text x="${startX}" y="${baseY + 22}" class="node-sublabel axis-label">${monthLabel(startLabel)}</text>
  <text x="${endX}" y="${baseY + 22}" class="node-sublabel axis-label" text-anchor="end">${monthLabel(endLabel)}</text>
  <text x="${startX}" y="14" class="node-sublabel axis-label">% change since ${monthLabel(startLabel)}</text>

  <text x="${(startX + endX) / 2}" y="140" text-anchor="middle" class="gap-pts-label ${hasContradiction ? "contradiction" : ""}">Gap: ${gapPts} pts</text>
</svg>`;
}

function renderDivergenceChart(decision, ledgerSteps) {
  const bankClaim = findClaim(ledgerSteps, "bank_statement_agent", "income_trend");
  const gstClaim = findClaim(ledgerSteps, "gst_tax_agent", "revenue_trend");
  const contradiction = decision.contradictions.find((c) => c.rule === "income_vs_revenue_divergence");

  $("divergence-chart").innerHTML = divergenceSvg(bankClaim, gstClaim, !!contradiction);

  const title = $("divergence-title");
  if (contradiction) {
    title.textContent = "⚠ Income vs. revenue signals diverge";
    title.className = "divergence-title contradiction";
  } else {
    title.textContent = "✓ Income vs. revenue signals agree";
    title.className = "divergence-title agree";
  }

  // Draw after layout settles so the CSS transition actually animates.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll(".signal-line").forEach((el) => el.classList.add("drawn"));
    });
  });
}

// ---------- Decision card ----------

function describeConsentAge(source) {
  if (!source) return "";
  const d = source.days_remaining;
  return d <= 0 ? `expired ${Math.abs(d)}d ago` : `expires in ${d}d`;
}

// When consent decay is what actually capped the decision (common on a
// clean financial case - no rule-based contradiction or risk factor fires,
// so the reasons list would otherwise read as empty while the confidence
// number says 0.00, which a judge reads as a bug, not a feature), spell out
// the decay math as its own cited reason instead of leaving it implicit in
// a small sub-label.
function buildDecayReason(decision, consentSources) {
  if (decision.final_confidence >= decision.model_confidence) return null;
  const weakest = consentSources.find((s) => s.source === decision.weakest_consent_source);
  if (!weakest) return null;
  const sourceLabel = weakest.source.replace("_findings", "");
  return {
    kind: "decay",
    rule: "consent_expiry_decay",
    text: `${sourceLabel} consent ${describeConsentAge(weakest)}, capping confidence from ${decision.model_confidence.toFixed(2)} to ${decision.final_confidence.toFixed(2)} (c &times; ${weakest.confidence_multiplier.toFixed(2)}).`,
  };
}

function miniGaugesHtml(sources, weakestSource) {
  return sources
    .map((s) => {
      const isWeakest = s.source === weakestSource && s.confidence_multiplier < 1;
      const fillClass = s.confidence_multiplier <= 0 ? "bad" : s.confidence_multiplier < 1 ? "warn" : "";
      return `
        <div class="mini-gauge ${isWeakest ? "weakest" : ""}" data-source="${s.source}">
          <div class="mini-gauge-head">
            <span class="mini-gauge-source">${s.source.replace("_findings", "")}</span>
            <span class="mini-gauge-days mono">${describeConsentAge(s)}</span>
          </div>
          <div class="gauge-track"><div class="gauge-fill ${fillClass}" style="width:0%" data-target="${Math.max(3, Math.min(100, s.confidence_multiplier * 100))}"></div></div>
        </div>`;
    })
    .join("");
}

function renderDecisionCard(decision, consentSources, isSample) {
  const meta = OUTCOME_META[decision.outcome];
  const reasons = [
    ...decision.contradictions.map((c) => ({ kind: "contradiction", rule: c.rule, text: c.finding })),
    ...decision.risk_factors.map((r) => ({ kind: "risk", rule: r.rule, text: r.finding })),
  ];
  const decayReason = buildDecayReason(decision, consentSources);
  if (decayReason) reasons.push(decayReason);

  $("decision-body").innerHTML = `
    ${isSample ? `<div class="sample-badge">Cached sample run &middot; <button id="run-live-btn" class="run-live-link">Run live</button></div>` : ""}
    <div class="outcome-badge outcome-${decision.outcome}">${meta.icon} ${meta.label}</div>
    <div class="confidence-block">
      <div class="confidence-label">Final confidence</div>
      <div class="confidence-number tabular" id="confidence-number">${decision.model_confidence.toFixed(2)}</div>
      <div class="confidence-sub">model confidence ${decision.model_confidence.toFixed(2)}</div>
    </div>
    ${reasons.length
      ? `<div class="reasons-label">Why (cited)</div>
         <ul class="reasons-list">
           ${reasons
             .map(
               (r) => `<li class="reason-item ${r.kind}"><div class="reason-rule mono">${r.rule}</div>${r.text}</li>`
             )
             .join("")}
         </ul>`
      : `<div class="reasons-label">Why</div><div class="decision-empty">No contradictions or risk factors flagged.</div>`}
    <div class="reasons-label">Consent</div>
    <div class="decision-consent">${miniGaugesHtml(consentSources, decision.weakest_consent_source)}</div>
  `;

  if (isSample) {
    $("run-live-btn").addEventListener("click", () => loadBorrower(decision.borrower_id, { forceRefetch: true }));
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const body = $("decision-body");
      body.querySelector(".outcome-badge").classList.add("show");
      body.querySelector(".confidence-block").classList.add("show");
      body.querySelectorAll(".reason-item").forEach((el, i) => {
        setTimeout(() => el.classList.add("show"), 60 * i);
      });
      body.querySelectorAll(".mini-gauge .gauge-fill").forEach((el, i) => {
        setTimeout(() => {
          el.style.width = `${el.dataset.target}%`;
        }, 300 + 60 * i);
      });
    });
  });

  animateConfidenceNumber(decision.model_confidence, decision.final_confidence);
}

function animateConfidenceNumber(from, to) {
  if (Math.abs(from - to) < 0.005) return;
  const el = $("confidence-number");
  if (!el) return;
  const duration = 650;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = from + (to - from) * eased;
    el.textContent = value.toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(2);
  }
  setTimeout(() => requestAnimationFrame(tick), 250);
}

// ---------- Ledger ----------

function evidenceChip(ev) {
  const bits = [];
  if (ev.transaction_ids && ev.transaction_ids.length) bits.push(`ids: ${ev.transaction_ids.join(", ")}`);
  if (ev.period) bits.push(`period: ${ev.period}`);
  if (ev.field) bits.push(`field: ${ev.field}`);
  return bits.join(" · ") || "(no citation)";
}

function jumpToClaim(source, field) {
  const panel = $("ledger-panel");
  panel.open = true;
  const target = document.querySelector(`.ledger-entry[data-agent="${SOURCE_TO_AGENT[source] || ""}"][data-metric="${field || ""}"]`);
  document.querySelectorAll(".ledger-entry.jump-target").forEach((el) => el.classList.remove("jump-target"));
  if (target) {
    target.classList.add("jump-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderLedger(ledgerSteps) {
  $("ledger-count").textContent = `(${ledgerSteps.length} steps)`;
  const list = $("ledger-list");
  list.innerHTML = "";

  ledgerSteps.forEach((entry) => {
    const isContradiction = entry.action === "flag_contradiction" || entry.action === "flag_subtler_contradiction";
    const div = document.createElement("div");
    div.className = "ledger-entry" + (isContradiction ? " contradiction" : "");
    div.dataset.agent = entry.agent;
    if (entry.claim && entry.claim.metric) div.dataset.metric = entry.claim.metric;

    const evidence = (entry.claim && entry.claim.evidence) || [];
    const evidenceHtml = evidence
      .map((ev) => {
        const clickable = isContradiction && ev.source;
        const tag = clickable ? "button" : "span";
        return `<${tag} class="evidence-chip" ${clickable ? `data-jump-source="${ev.source}" data-jump-field="${ev.field || ""}"` : ""}>${evidenceChip(ev)}</${tag}>`;
      })
      .join("");

    div.innerHTML = `
      <div class="ledger-entry-head">
        <span>${entry.step_id}</span>
        <span class="agent">${AGENT_LABEL[entry.agent] || entry.agent}</span>
        <span>${entry.action}</span>
        <span>conf ${Number(entry.confidence).toFixed(2)}</span>
      </div>
      ${entry.claim && entry.claim.finding ? `<div class="ledger-entry-finding">${entry.claim.finding}</div>` : ""}
      ${entry.claim && entry.claim.value && !entry.claim.finding ? `<div class="ledger-entry-finding">${entry.claim.metric}: ${entry.claim.value}${entry.claim.magnitude_pct != null ? ` (${fmtPct(entry.claim.magnitude_pct)})` : ""}</div>` : ""}
      ${evidenceHtml ? `<div class="ledger-entry-evidence">${evidenceHtml}</div>` : ""}
    `;
    list.appendChild(div);
  });

  list.querySelectorAll("[data-jump-source]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToClaim(btn.dataset.jumpSource, btn.dataset.jumpField));
  });
}

// ---------- Reveal choreography ----------

function playReveal(borrowerId) {
  const data = cache.get(borrowerId);
  if (!data) return;
  const { decision, ledgerSteps, consentSources, isSample } = data;
  const hasContradiction = decision.contradictions.length > 0;

  resetPipelineCanvas();
  $("pipeline-status").textContent = `${borrowerId} · 3 specialist agents ran in parallel, orchestrator cross-checked them`;

  setTimeout(() => setConnectorDrawn("conn-bank", true), 60);
  setTimeout(() => setConnectorDrawn("conn-gst", true), 150);
  setTimeout(() => setConnectorDrawn("conn-investment", true), 240);
  setTimeout(() => setConnectorDrawn("conn-out", true, hasContradiction), 420);

  renderDivergenceChart(decision, ledgerSteps);
  renderDecisionCard(decision, consentSources, !!isSample);
  renderLedger(ledgerSteps);

  renderCaseRail();
  $("replay-btn").disabled = false;
}

// Bug fixed here: this used to only overwrite the chart/decision/ledger
// panels and leave #divergence-title untouched, so switching to a new
// borrower kept the *previous* case's amber/teal title and color class
// visible throughout the entire loading wait - for a few seconds the page
// visibly contradicted itself (an amber "diverge" header over a loading
// skeleton for a case that turns out to agree). Confirmed live and now
// explicitly reset here every time a new load starts.
function showLoadingState(borrowerId) {
  resetPipelineCanvas();
  $("pipeline-status").textContent = `${borrowerId} · calling 3 parallel agents + orchestrator on live Vertex AI - can take 10-30s`;

  const title = $("divergence-title");
  title.textContent = "Running…";
  title.className = "divergence-title";

  $("divergence-chart").innerHTML = `<div class="skeleton skel-line" style="width:90%"></div><div class="skeleton skel-line" style="width:70%"></div>`;
  $("decision-body").innerHTML = `
    <div class="skeleton skel-line" style="width:140px;height:26px"></div>
    <div class="skeleton skel-line" style="width:90px;height:40px;margin-top:10px"></div>
    <div class="skeleton skel-line" style="width:100%"></div>
    <div class="skeleton skel-line" style="width:100%"></div>
  `;
  $("ledger-list").innerHTML = "";
  $("ledger-count").textContent = "";
  $("replay-btn").disabled = true;
}

// ---------- Load / fetch ----------

async function loadBorrower(borrowerId, { forceRefetch }) {
  currentBorrowerId = borrowerId;
  renderCaseRail();

  if (!forceRefetch && cache.has(borrowerId)) {
    setStatus(`${borrowerId} · loaded from this session's cache - replaying instantly.`);
    playReveal(borrowerId);
    return;
  }

  const myToken = ++loadToken;
  showLoadingState(borrowerId);
  setStatus(`Running the pipeline for ${borrowerId}...`);

  try {
    const decision = await fetchJSON(`/borrowers/${borrowerId}/evaluate`, {
      method: "POST",
      headers: { "Content-Length": "0" },
    });
    if (myToken !== loadToken) return; // a newer click superseded this one

    const [ledgerResp, consentResp] = await Promise.all([
      fetchJSON(`/borrowers/${borrowerId}/ledger`),
      fetchJSON(`/borrowers/${borrowerId}/consent-status`),
    ]);
    if (myToken !== loadToken) return;

    cache.set(borrowerId, { decision, ledgerSteps: ledgerResp.steps, consentSources: consentResp.sources, isSample: false });
    setStatus(`${borrowerId} · done · ${decision.outcome} (${decision.final_confidence.toFixed(2)})`);
    playReveal(borrowerId);
  } catch (err) {
    if (myToken !== loadToken) return;
    console.error(err);
    setStatus(`Error running ${borrowerId}: ${err.message}`, true);
    $("decision-body").innerHTML = `<div class="decision-empty">Pipeline call failed - see status line below.</div>`;
  }
}

// ---------- Boot ----------
//
// Never show an empty state: the default case renders fully, instantly,
// from the cached sample above - no skeleton, no 10-30s wait on the one
// moment a judge forms a first impression. The page is only ever "live"
// once someone clicks "Run live" or picks a different case.

renderCaseRail();
resetPipelineCanvas();
$("replay-btn").addEventListener("click", () => {
  if (currentBorrowerId) playReveal(currentBorrowerId);
});

cache.set(DEFAULT_CASE, CACHED_SAMPLE[DEFAULT_CASE]);
currentBorrowerId = DEFAULT_CASE;
setStatus(`${DEFAULT_CASE} · showing a cached sample run · click "Run live" for a real Vertex AI call.`);
playReveal(DEFAULT_CASE);
