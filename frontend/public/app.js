// Outliers Underwriting - replay UI.
//
// The single most important interaction here (per the build brief) is: when
// the orchestrator (step 4) flags a contradiction, clicking it must jump the
// viewer straight to the exact bank transaction / GST filing period in
// steps 1-3 that disagree - not just say "contradiction found."

const BACKEND_URL = (window.__CONFIG__ && window.__CONFIG__.BACKEND_URL) || "http://localhost:8081";

const STEP_DEFS = [
  { key: "bank_statement_agent", label: "1. Bank agent", isFinal: false },
  { key: "gst_tax_agent", label: "2. GST/Tax agent", isFinal: false },
  { key: "investment_agent", label: "3. MF/Insurance agent", isFinal: false },
  { key: "orchestrator_agent", label: "4. Orchestrator", isFinal: false },
  { key: "orchestrator_agent", label: "5. Decision, ledger", isFinal: true },
];

let currentLedger = [];
let activeStepIndex = null;

const $ = (id) => document.getElementById(id);

async function fetchJSON(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

function stepEntries(stepIndex) {
  const def = STEP_DEFS[stepIndex];
  return currentLedger.filter((e) => {
    if (e.agent !== def.key) return false;
    const isFinalEntry = e.action === "final_decision";
    return def.isFinal ? isFinalEntry : !isFinalEntry;
  });
}

function stepHasContradiction(stepIndex) {
  return stepEntries(stepIndex).some((e) => e.action === "flag_contradiction" || e.action === "flag_subtler_contradiction");
}

function renderStepper() {
  const track = $("stepper-track");
  track.innerHTML = "";
  STEP_DEFS.forEach((def, i) => {
    const entries = stepEntries(i);
    const box = document.createElement("button");
    box.className = "step-box" + (i === activeStepIndex ? " active" : "") + (stepHasContradiction(i) ? " has-contradiction" : "");
    box.textContent = `${def.label} (${entries.length})`;
    box.onclick = () => {
      activeStepIndex = i;
      renderStepper();
      renderStepDetail(i);
    };
    track.appendChild(box);
  });
}

function evidenceChip(ev) {
  const bits = [];
  if (ev.transaction_ids && ev.transaction_ids.length) bits.push(`txns: ${ev.transaction_ids.join(", ")}`);
  if (ev.period) bits.push(`period: ${ev.period}`);
  if (ev.field) bits.push(`field: ${ev.field}`);
  if (ev.source) bits.push(`source: ${ev.source}`);
  return bits.join(" · ") || "(no citation)";
}

const SOURCE_TO_AGENT = {
  bank_findings: "bank_statement_agent",
  gst_findings: "gst_tax_agent",
  investment_findings: "investment_agent",
};

function jumpToClaim(source, field) {
  const agent = SOURCE_TO_AGENT[source];
  const stepIndex = STEP_DEFS.findIndex((d) => d.key === agent && !d.isFinal);
  if (stepIndex === -1) return;
  activeStepIndex = stepIndex;
  renderStepper();
  renderStepDetail(stepIndex, field);
}

function renderEntry(entry, highlightMetric) {
  const wrap = document.createElement("div");
  const isContradiction = entry.action === "flag_contradiction" || entry.action === "flag_subtler_contradiction";
  wrap.className = "ledger-entry" + (isContradiction ? " contradiction" : "");
  if (highlightMetric && entry.claim && entry.claim.metric === highlightMetric) {
    wrap.classList.add("jump-target");
  }

  const header = document.createElement("div");
  header.className = "ledger-entry-header";
  header.textContent = `${entry.step_id} · ${entry.action}`;
  wrap.appendChild(header);

  if (entry.notes) {
    const notes = document.createElement("div");
    notes.className = "ledger-entry-notes";
    notes.textContent = entry.notes;
    wrap.appendChild(notes);
  }

  if (entry.claim && entry.claim.finding) {
    const finding = document.createElement("div");
    finding.className = "ledger-entry-finding";
    finding.textContent = entry.claim.finding;
    wrap.appendChild(finding);
  }

  // No step shows a bare number without the evidence panel beside it.
  const evidencePanel = document.createElement("div");
  evidencePanel.className = "evidence-panel";
  const evidenceList = entry.claim && entry.claim.evidence ? entry.claim.evidence : [];
  if (evidenceList.length === 0 && entry.claim && entry.claim.value) {
    evidencePanel.textContent = `value: ${entry.claim.value}`;
  }
  evidenceList.forEach((ev) => {
    const chip = document.createElement(isContradiction && ev.source ? "button" : "div");
    chip.className = "evidence-chip";
    chip.textContent = evidenceChip(ev);
    if (isContradiction && ev.source) {
      chip.title = "Click to jump to the exact citing step";
      chip.onclick = () => jumpToClaim(ev.source, ev.field);
    }
    evidencePanel.appendChild(chip);
  });
  wrap.appendChild(evidencePanel);

  const confidence = document.createElement("div");
  confidence.className = "confidence-badge";
  confidence.textContent = `confidence ${Number(entry.confidence).toFixed(2)}`;
  wrap.appendChild(confidence);

  return wrap;
}

function renderStepDetail(stepIndex, highlightMetric) {
  const container = $("step-detail");
  container.innerHTML = "";
  const entries = stepEntries(stepIndex);
  if (entries.length === 0) {
    container.textContent = "No ledger entries for this step.";
    return;
  }
  entries.forEach((entry) => container.appendChild(renderEntry(entry, highlightMetric)));

  const jumpTarget = container.querySelector(".jump-target");
  if (jumpTarget) jumpTarget.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderDecisionSummary(decision) {
  $("decision-summary").classList.remove("hidden");
  const badge = $("outcome-badge");
  badge.textContent = decision.outcome.replace("_", " ").toUpperCase();
  badge.className = `outcome-badge outcome-${decision.outcome}`;
  $("final-confidence").textContent = decision.final_confidence;
  $("model-confidence").textContent = decision.model_confidence;
}

function renderConsentStrip(sources) {
  const strip = $("consent-strip");
  strip.classList.remove("hidden");
  strip.innerHTML = "";
  sources.forEach((s) => {
    const item = document.createElement("div");
    const stale = s.confidence_multiplier < 1;
    item.className = "consent-item" + (stale ? " stale" : "");
    item.innerHTML = `
      <div class="consent-source">${s.source.replace("_findings", "")}</div>
      <div class="consent-days">${s.days_remaining}d left</div>
      <div class="consent-multiplier">c = ${s.confidence_multiplier}</div>
    `;
    strip.appendChild(item);
  });
}

async function evaluate() {
  const borrowerId = $("borrower-select").value;
  const status = $("status");
  $("evaluate-btn").disabled = true;
  status.textContent = "Running pipeline...";
  try {
    const decision = await fetchJSON(`/borrowers/${borrowerId}/evaluate`, { method: "POST" });
    const ledgerResp = await fetchJSON(`/borrowers/${borrowerId}/ledger`);
    const consentResp = await fetchJSON(`/borrowers/${borrowerId}/consent-status`);

    currentLedger = ledgerResp.steps;
    activeStepIndex = 3; // default to the orchestrator step - where the contradiction is.

    renderDecisionSummary(decision);
    $("stepper").classList.remove("hidden");
    renderStepper();
    renderStepDetail(activeStepIndex);
    renderConsentStrip(consentResp.sources);

    status.textContent = "Done.";
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
  } finally {
    $("evaluate-btn").disabled = false;
  }
}

$("evaluate-btn").addEventListener("click", evaluate);
