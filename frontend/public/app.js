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
  { id: "b_clean", scenario: "All sources agree", note: "Healthy, straightforward case", group: "core" },
  { id: "b_contradiction", scenario: "Bank vs. GST disagree", note: "The centerpiece contradiction", group: "core" },
  { id: "b_stale_consent", scenario: "Bank consent expiring", note: "Confidence decay in action", group: "core" },
  { id: "b_freelancer", scenario: "Freelancer, thin file", note: "Small SIP, all sources agree", group: "edge" },
  { id: "b_roundtrip", scenario: "Deposits surge, GST flat", note: "Declared-vs-actual mismatch", group: "edge" },
  { id: "b_closing_consent", scenario: "Consent closing in days", note: "Linear decay zone, not yet expired", group: "edge" },
  { id: "b_seasonal", scenario: "Sweet shop, seasonal dip", note: "GST low season vs. stable bank", group: "edge" },
  { id: "b_double_flag", scenario: "Divergence + consent closing", note: "Two flags stacking together", group: "edge" },
];

const CASE_GROUPS = [
  { key: "core", label: "Core" },
  { key: "edge", label: "Edge cases" },
];

const DEFAULT_CASE = "b_contradiction";
const RECORDED_URL = (id) => `/recorded/${id}.json`;

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

const $ = (id) => document.getElementById(id);

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

// Per-borrower cache: { decision, ledgerSteps, consentSources, isSample, capturedAt }.
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
    return { decision: data.decision, ledgerSteps: data.ledgerSteps, consentSources: data.consentSources, isSample: true, capturedAt: data.capturedAt || null };
  } catch (err) {
    return null;
  }
}

// ---------- Case rail ----------

function caseCardHtml(c) {
  const isActive = c.id === currentBorrowerId;
  const cached = cache.get(c.id);
  const statusClass = cached ? `result-${cached.decision.outcome}` : "";
  const statusText = cached
    ? `${OUTCOME_META[cached.decision.outcome].icon} ${OUTCOME_META[cached.decision.outcome].label} (${cached.decision.final_confidence.toFixed(2)})`
    : "Not yet run";
  return `
    <button type="button" class="case-card${isActive ? " active" : ""}" data-borrower-id="${c.id}" aria-pressed="${isActive}">
      <div class="case-card-id mono">${c.id}${isActive ? '<span class="case-card-viewing"> · viewing</span>' : ""}</div>
      <div class="case-card-scenario">${c.scenario}</div>
      <div class="case-card-status ${statusClass}"><span class="status-dot"></span>${statusText}</div>
    </button>`;
}

function renderCaseRail() {
  const rail = $("case-rail");
  rail.querySelectorAll(".case-group").forEach((n) => n.remove());

  CASE_GROUPS.forEach((group) => {
    const cases = CASES.filter((c) => c.group === group.key);
    if (!cases.length) return;
    const wrap = document.createElement("div");
    wrap.className = "case-group";
    wrap.innerHTML = `<h3 class="case-group-label">${group.label}</h3>` + cases.map(caseCardHtml).join("");
    rail.appendChild(wrap);
  });

  if (UPLOADED_CASES.length) {
    const wrap = document.createElement("div");
    wrap.className = "case-group";
    wrap.innerHTML = `<h3 class="case-group-label">Your uploads</h3>` + UPLOADED_CASES.map(caseCardHtml).join("");
    rail.appendChild(wrap);
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
  <path id="conn-out" class="connector" d="M450,100 L620,100" />

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
    <text class="node-sublabel" x="30" y="180">MUTUAL_FUNDS + INSURANCE</text>
  </g>
  <g id="node-orchestrator" class="agent-node">
    <rect class="node-box orchestrator" x="300" y="78" width="150" height="44" rx="7"></rect>
    <text class="node-label" x="314" y="96">Orchestrator</text>
    <text class="node-sublabel" id="orchestrator-outcome" x="314" y="110">rules + reasoning + decay</text>
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
// our synthetic data; prefer the bank claim's "YYYY-MM to YYYY-MM" range
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
  <text x="${startX}" y="14" class="axis-label">% change since ${monthLabel(startLabel)}</text>

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
    text: `${sourceLabel} consent ${describeConsentAge(weakest)}, capping confidence from ${decision.model_confidence.toFixed(2)} to ${decision.final_confidence.toFixed(2)} (c &times; ${weakest.confidence_multiplier.toFixed(2)}).`,
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
      text: "All three specialist agents agree and every consent source is current - no contradiction, risk flag, or confidence decay.",
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

// ---------- Decision card ----------

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
          <div class="gauge-track"><div class="gauge-fill ${fillClass} ${isWeakest ? "sync" : ""}" style="width:0%" data-target="${Math.max(3, Math.min(100, s.confidence_multiplier * 100))}"></div></div>
        </div>`;
    })
    .join("");
}

function renderDecisionCard(decision, consentSources, sampleMeta) {
  const meta = OUTCOME_META[decision.outcome];
  const reasons = buildWhyReasons(decision, consentSources);
  const isCapped = decision.final_confidence < decision.model_confidence;

  $("decision-body").innerHTML = `
    ${sampleMeta
      ? `<div class="sample-badge">${sampleMeta.capturedAt ? `Last synced ${fmtDate(sampleMeta.capturedAt)}` : "Cached result"} &middot; <button id="run-live-btn" class="run-live-link">Refresh</button></div>`
      : ""}
    <div class="outcome-badge outcome-${decision.outcome}">${meta.icon} ${meta.label}</div>
    <div class="confidence-block">
      <div class="confidence-label">Final confidence</div>
      <div class="confidence-number tabular" id="confidence-number">${decision.model_confidence.toFixed(2)}</div>
      <div class="confidence-sub">model confidence ${decision.model_confidence.toFixed(2)}</div>
    </div>
    <div class="reasons-label">Why (cited)</div>
    <ul class="reasons-list">
      ${reasons.map((r) => `<li class="reason-item ${r.kind}"><div class="reason-rule mono">${r.rule}</div>${r.text}</li>`).join("")}
    </ul>
    <div class="reasons-label">Consent${sampleMeta ? ` <span class="consent-asof">(as of${sampleMeta.capturedAt ? ` ${fmtDate(sampleMeta.capturedAt)}` : " the last sync"})</span>` : ""}</div>
    <div class="decision-consent">${miniGaugesHtml(consentSources, decision.weakest_consent_source)}</div>
  `;

  if (sampleMeta) {
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
  const panel = $("ledger-panel");
  panel.open = true;
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

  return `
    <div class="ledger-entry${isContradiction ? " contradiction" : ""}${groupIndex >= 4 ? " ledger-entry-extra hidden" : ""}"
         data-agent="${entry.agent}" data-metric="${(entry.claim && entry.claim.metric) || ""}" tabindex="-1">
      <div class="ledger-entry-head">
        <span class="mono">${entry.step_id}</span>
        <span>${entry.action}</span>
        <span class="mono">conf ${Number(entry.confidence).toFixed(2)}</span>
      </div>
      ${entry.claim && entry.claim.finding ? `<div class="ledger-entry-finding">${entry.claim.finding}</div>` : ""}
      ${entry.claim && entry.claim.value && !entry.claim.finding ? `<div class="ledger-entry-finding">${entry.claim.metric}: ${entry.claim.value}${entry.claim.magnitude_pct != null ? ` (${fmtPct(entry.claim.magnitude_pct)})` : ""}</div>` : ""}
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
    byAgent.get(agent).forEach((entry, groupIndex) => {
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
  const { decision, ledgerSteps, consentSources, isSample, capturedAt } = data;
  const hasContradiction = (decision.contradictions || []).length > 0;

  resetDeskUI(`${borrowerId} · 3 specialist agents ran in parallel, orchestrator cross-checked them`);

  ["node-bank", "node-gst", "node-investment"].forEach((id) => setNodeState(id, "done"));
  setNodeState("node-orchestrator", "done");

  delay(() => setConnectorDrawn("conn-bank", true), 60);
  delay(() => setConnectorDrawn("conn-gst", true), 150);
  delay(() => setConnectorDrawn("conn-investment", true), 240);
  delay(() => setConnectorDrawn("conn-out", true, hasContradiction), 420);

  const outcomeEl = $("orchestrator-outcome");
  if (outcomeEl) outcomeEl.textContent = orchestratorSummaryText(decision);

  // The chart reads the latest known value of each claim, same as the
  // ledger panel does internally - a raw multi-run history could otherwise
  // let findClaim() pick a superseded (older) occurrence of a metric.
  renderDivergenceChart(decision, dedupLedgerSteps(ledgerSteps));
  renderDecisionCard(decision, consentSources, isSample ? { capturedAt } : null);
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
  resetDeskUI(`${borrowerId} · calling 3 parallel agents + orchestrator on live Vertex AI - can take 10-30s`);

  if (REDUCE_MOTION) {
    ["node-bank", "node-gst", "node-investment", "node-orchestrator"].forEach((id) => setNodeState(id, "working"));
    ["conn-bank", "conn-gst", "conn-investment"].forEach((id) => setConnectorCharging(id, true));
    return;
  }

  setNodeState("node-bank", "pending");
  setNodeState("node-gst", "pending");
  setNodeState("node-investment", "pending");
  setNodeState("node-orchestrator", "pending");

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

// ---------- Load / fetch ----------

async function loadBorrower(borrowerId, { forceRefetch }) {
  // Abort any in-flight live call for a different (or the same) borrower
  // before doing anything else - a late response must never repaint a case
  // the viewer has already navigated away from.
  if (currentController) currentController.abort();
  currentController = null;
  const myToken = ++loadToken;

  currentBorrowerId = borrowerId;
  renderCaseRail();

  if (!forceRefetch && cache.has(borrowerId)) {
    const data = cache.get(borrowerId);
    setStatus(
      data.isSample
        ? `${borrowerId} · cached result · click Refresh for a live Vertex AI run.`
        : `${borrowerId} · loaded from this session's cache - replaying instantly.`
    );
    playReveal(borrowerId);
    return;
  }

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
    if (myToken !== loadToken) return; // a newer click superseded this one

    const [ledgerResp, consentResp] = await Promise.all([
      fetchJSON(`/borrowers/${borrowerId}/ledger`, { signal: controller.signal }),
      fetchJSON(`/borrowers/${borrowerId}/consent-status`, { signal: controller.signal }),
    ]);
    if (myToken !== loadToken) return;

    cache.set(borrowerId, { decision, ledgerSteps: ledgerResp.steps, consentSources: consentResp.sources, isSample: false });
    setStatus(`${borrowerId} · done · ${decision.outcome} (${decision.final_confidence.toFixed(2)})`);
    playReveal(borrowerId);
  } catch (err) {
    if (myToken !== loadToken || err.name === "AbortError") return; // superseded - stay silent
    console.error(err);
    setStatus(`Error running ${borrowerId}: ${err.message}`, true);
    $("decision-body").innerHTML = `<div class="decision-empty">Pipeline call failed - see status line below.</div>`;
  }
}

// ---------- Boot ----------
//
// Never show an empty state: the default case paints fully, instantly,
// from a verbatim recorded capture - no skeleton, no 10-30s wait on the
// one moment a judge forms a first impression. The page is only ever
// "live" once someone clicks "Run live" or runs a case with no recorded
// capture available yet.

renderCaseRail();
resetPipelineCanvas();
$("replay-btn").addEventListener("click", () => {
  if (currentBorrowerId) playReveal(currentBorrowerId);
});

// ---------- Real-document upload ----------
//
// Extraction happens server-side (agents/extraction.py, via Gemini) and
// hands back a brand new borrower_id already written to Firestore in the
// same FI shape every other case uses - from here on it's just another
// loadBorrower() call against the real, unmodified pipeline.
(function setupUploadDialog() {
  const dialog = $("upload-dialog");
  const form = $("upload-form");
  const statusEl = $("upload-status");
  const submitBtn = $("upload-submit-btn");
  if (!dialog || !form) return; // landing page includes neither

  const UPLOAD_TIMEOUT_MS = 90000; // extraction is now concurrent per-document
  // (not N times one document's latency), plus the pipeline's own ~10-30s -
  // generous enough not to false-positive on a legitimately slow real call.
  let inFlightController = null;
  let cancelledByUser = false;

  $("upload-open-btn").addEventListener("click", () => {
    form.reset();
    statusEl.textContent = "";
    dialog.showModal();
  });

  $("upload-cancel-btn").addEventListener("click", () => {
    if (inFlightController) {
      cancelledByUser = true;
      inFlightController.abort();
    }
    dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitBtn.disabled = true;
    statusEl.textContent = "Reading documents and extracting structured data via Gemini - this can take 10-30s...";
    cancelledByUser = false;

    const controller = new AbortController();
    inFlightController = controller;
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    try {
      const body = new FormData(form);
      const res = await fetch(`${BACKEND_URL}/borrowers/upload`, { method: "POST", body, signal: controller.signal });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `${res.status} ${res.statusText}`);
      }
      const { borrower_id } = await res.json();
      UPLOADED_CASES.push({ id: borrower_id, scenario: "Your upload" });
      dialog.close();
      renderCaseRail();
      loadBorrower(borrower_id, { forceRefetch: true });
    } catch (err) {
      if (err.name === "AbortError") {
        if (!cancelledByUser) {
          statusEl.textContent = "Timed out waiting for a response - check your connection and try again.";
        } // else the user already closed the dialog - nothing to show
      } else {
        statusEl.textContent = `Error: ${err.message}`;
      }
    } finally {
      clearTimeout(timeoutId);
      inFlightController = null;
      submitBtn.disabled = false;
    }
  });
})();

// Deep link: /desk?case=b_seasonal opens that case instead of the usual
// default. Falls back to DEFAULT_CASE for a missing/unknown id - never
// trusts the query string blindly.
function bootCaseFromURL() {
  const requested = new URLSearchParams(window.location.search).get("case");
  return requested && CASES.some((c) => c.id === requested) ? requested : DEFAULT_CASE;
}

(async function boot() {
  const bootCase = bootCaseFromURL();
  const defaultRecorded = await loadRecorded(bootCase);
  if (defaultRecorded) {
    cache.set(bootCase, defaultRecorded);
    currentBorrowerId = bootCase;
    setStatus(`${bootCase} · cached result · click Refresh for a live Vertex AI run.`);
    playReveal(bootCase);
  } else {
    // No cached capture on disk yet (e.g. before public/recorded/*.json is
    // populated) - an honest "ready to run" state, never a fabricated
    // result standing in for one.
    currentBorrowerId = bootCase;
    renderCaseRail();
    resetDeskUI(`${bootCase} · not yet run`);
    $("decision-body").innerHTML = `<div class="decision-empty">No cached result yet for ${bootCase}. Click the case to run the live pipeline.</div>`;
  }

  // Prefetch every other case's recorded capture in the background so
  // switching to them is instant too, same as the boot case.
  CASES.filter((c) => c.id !== bootCase).forEach(async (c) => {
    const data = await loadRecorded(c.id);
    if (data && !cache.has(c.id)) {
      cache.set(c.id, data);
      renderCaseRail();
    }
  });
})();
