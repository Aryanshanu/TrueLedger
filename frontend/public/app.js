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
      <div class="case-card-id mono">${c.id}</div>
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

function divergenceSvg(bankClaim, gstClaim, hasContradiction) {
  const scale = 2.2;
  const clamp = (v) => Math.max(10, Math.min(120, v));
  const baseY = 65;
  const bankY = clamp(baseY - (bankClaim ? bankClaim.magnitude_pct : 0) * scale);
  const gstY = clamp(baseY - (gstClaim ? gstClaim.magnitude_pct : 0) * scale);
  const startX = 40;
  const endX = 360;

  return `
<svg viewBox="0 0 400 135" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <polygon class="gap-band ${hasContradiction ? "show pulse" : ""}" points="${startX},${baseY} ${endX},${bankY} ${endX},${gstY}"></polygon>
  <polyline class="signal-line bank" points="${startX},${baseY} ${endX},${bankY}"></polyline>
  <polyline class="signal-line gst" points="${startX},${baseY} ${endX},${gstY}"></polyline>
  <text x="${endX - 46}" y="${bankY - 8}" class="node-sublabel chart-value" fill="var(--signal-bank)">${bankClaim ? fmtPct(bankClaim.magnitude_pct) : "n/a"}</text>
  <text x="${endX - 46}" y="${gstY + 16}" class="node-sublabel chart-value" fill="var(--signal-gst)">${gstClaim ? fmtPct(gstClaim.magnitude_pct) : "n/a"}</text>
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

function renderDecisionCard(decision) {
  const meta = OUTCOME_META[decision.outcome];
  const reasons = [
    ...decision.contradictions.map((c) => ({ kind: "contradiction", rule: c.rule, text: c.finding })),
    ...decision.risk_factors.map((r) => ({ kind: "risk", rule: r.rule, text: r.finding })),
  ];

  $("decision-body").innerHTML = `
    <div class="outcome-badge outcome-${decision.outcome}">${meta.icon} ${meta.label}</div>
    <div class="confidence-block">
      <div class="confidence-label">Final confidence</div>
      <div class="confidence-number tabular" id="confidence-number">${decision.model_confidence.toFixed(2)}</div>
      <div class="confidence-sub">model confidence ${decision.model_confidence.toFixed(2)}${decision.weakest_consent_source && decision.final_confidence < decision.model_confidence ? ` &middot; capped by ${decision.weakest_consent_source.replace("_findings", "")} consent decay` : ""}</div>
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
  `;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      $("decision-body").querySelector(".outcome-badge").classList.add("show");
      $("decision-body").querySelector(".confidence-block").classList.add("show");
      $("decision-body").querySelectorAll(".reason-item").forEach((el, i) => {
        setTimeout(() => el.classList.add("show"), 80 * i);
      });
    });
  });

  animateConfidenceNumber(decision.model_confidence, decision.final_confidence);
}

function animateConfidenceNumber(from, to) {
  if (Math.abs(from - to) < 0.005) return;
  const el = $("confidence-number");
  if (!el) return;
  const duration = 900;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = from + (to - from) * eased;
    el.textContent = value.toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(2);
  }
  setTimeout(() => requestAnimationFrame(tick), 450);
}

// ---------- Consent strip ----------

function renderConsentStrip(sources, weakestSource) {
  const strip = $("consent-strip");
  strip.innerHTML = "";
  sources.forEach((s) => {
    // Only emphasize "weakest" when it's a meaningfully degraded source
    // (confidence_multiplier < 1). When every source is tied at full
    // strength (c x 1.00, the common case), min()'s tie-break is arbitrary
    // - highlighting one as "weakest" would misleadingly imply it's
    // actually worse than the other two.
    const isWeakest = s.source === weakestSource && s.confidence_multiplier < 1;
    const fillClass = s.confidence_multiplier <= 0 ? "bad" : s.confidence_multiplier < 1 ? "warn" : "";
    const wrap = document.createElement("div");
    wrap.className = "gauge" + (isWeakest ? " weakest" : "");
    wrap.innerHTML = `
      <div class="gauge-head">
        <span class="gauge-source">${s.source.replace("_findings", "")}</span>
        <span class="gauge-days mono">${s.days_remaining}d left</span>
      </div>
      <div class="gauge-track"><div class="gauge-fill ${fillClass}" style="width:0%"></div></div>
      <div class="gauge-foot">
        <span>${s.fi_type}</span>
        <span class="gauge-mult">c &times; ${s.confidence_multiplier.toFixed(2)}</span>
      </div>
    `;
    strip.appendChild(wrap);
    const fillEl = wrap.querySelector(".gauge-fill");
    requestAnimationFrame(() => {
      setTimeout(() => {
        fillEl.style.width = `${Math.max(0, Math.min(100, s.confidence_multiplier * 100))}%`;
      }, 500);
    });
  });
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
  const { decision, ledgerSteps } = data;
  const hasContradiction = decision.contradictions.length > 0;

  resetPipelineCanvas();
  $("pipeline-status").textContent = `${borrowerId} · 3 specialist agents ran in parallel, orchestrator cross-checked them`;

  setTimeout(() => setConnectorDrawn("conn-bank", true), 60);
  setTimeout(() => setConnectorDrawn("conn-gst", true), 200);
  setTimeout(() => setConnectorDrawn("conn-investment", true), 340);
  setTimeout(() => setConnectorDrawn("conn-out", true, hasContradiction), 620);

  renderDivergenceChart(decision, ledgerSteps);
  renderDecisionCard(decision);
  renderConsentStrip(data.consentSources, decision.weakest_consent_source);
  renderLedger(ledgerSteps);

  renderCaseRail();
  $("replay-btn").disabled = false;
}

function showLoadingState(borrowerId) {
  resetPipelineCanvas();
  $("pipeline-status").textContent = `${borrowerId} · calling 3 parallel agents + orchestrator on live Vertex AI - can take 10-30s`;
  $("divergence-chart").innerHTML = `<div class="skeleton skel-line" style="width:90%"></div><div class="skeleton skel-line" style="width:70%"></div>`;
  $("decision-body").innerHTML = `
    <div class="skeleton skel-line" style="width:140px;height:26px"></div>
    <div class="skeleton skel-line" style="width:90px;height:40px;margin-top:10px"></div>
    <div class="skeleton skel-line" style="width:100%"></div>
    <div class="skeleton skel-line" style="width:100%"></div>
  `;
  $("consent-strip").innerHTML = "";
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

    cache.set(borrowerId, { decision, ledgerSteps: ledgerResp.steps, consentSources: consentResp.sources });
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

renderCaseRail();
resetPipelineCanvas();
$("replay-btn").addEventListener("click", () => {
  if (currentBorrowerId) playReveal(currentBorrowerId);
});

loadBorrower(DEFAULT_CASE, { forceRefetch: false });
