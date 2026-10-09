// TrueLedger landing page.
//
// Same data-honesty rule as the Desk (app.js): every number here comes from
// a verbatim recorded capture under /recorded/<id>.json - real /evaluate +
// /ledger + /consent-status responses from this project's own deployed
// backend. Nothing on this page invents an outcome, a confidence number, a
// trend %, a gap, or a consent day count. No case card states an expected
// outcome in advance - the casebook only shows what a real run returned.

const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const OUTCOME_META = {
  approve: { label: "APPROVE", icon: "✓" },
  manual_review: { label: "MANUAL REVIEW", icon: "⚠" },
  decline: { label: "DECLINE", icon: "✕" },
};

// Same 8 cases as the Desk's CASES array (app.js) - duplicated here
// deliberately: this is a separate static page with no shared module
// system, and the scenario copy is static text, not data.
const CASEBOOK = [
  { id: "b_clean", scenario: "All sources agree", group: "Core" },
  { id: "b_contradiction", scenario: "Bank vs. GST disagree", group: "Core" },
  { id: "b_stale_consent", scenario: "Bank consent expiring", group: "Core" },
  { id: "b_freelancer", scenario: "Freelancer, thin file", group: "Edge" },
  { id: "b_roundtrip", scenario: "Deposits surge, GST flat", group: "Edge" },
  { id: "b_closing_consent", scenario: "Consent closing in days", group: "Edge" },
  { id: "b_seasonal", scenario: "Sweet shop, seasonal dip", group: "Edge" },
  { id: "b_double_flag", scenario: "Divergence + consent closing", group: "Edge" },
];

const $ = (id) => document.getElementById(id);

function delay(fn, ms) {
  return setTimeout(fn, REDUCE_MOTION ? 0 : ms);
}

async function fetchRecorded(id) {
  try {
    const res = await fetch(`/recorded/${id}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// Same rule as app.js's dedupLedgerSteps(): the ledger endpoint returns the
// full append-only history across every past /evaluate call for a
// borrower, so this keeps only the latest value of each claim. Duplicated
// here for the same reason CASEBOOK is duplicated - no shared module
// system between the Desk and the landing page.
function dedupLedgerSteps(steps) {
  const latestByKey = new Map();
  steps.forEach((step) => {
    const key = step.action === "record_claim" ? `${step.agent}::${step.claim.metric}` : `${step.agent}::${step.action}`;
    const prev = latestByKey.get(key);
    if (!prev || step.timestamp > prev.timestamp) latestByKey.set(key, step);
  });
  return [...latestByKey.values()];
}

function findClaim(steps, agent, metric) {
  const entry = steps.find((e) => e.agent === agent && e.action === "record_claim" && e.claim && e.claim.metric === metric);
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

function periodRange(bankClaim, gstClaim) {
  const bankPeriod = bankClaim && bankClaim.evidence && bankClaim.evidence[0] && bankClaim.evidence[0].period;
  if (bankPeriod && bankPeriod.includes(" to ")) {
    const [start, end] = bankPeriod.split(" to ").map((s) => s.trim());
    return [start, end];
  }
  const periods = ((gstClaim && gstClaim.evidence) || []).map((e) => e.period).filter(Boolean).sort();
  return [periods[0], periods[periods.length - 1]];
}

// ---------- Chapter 3: Act II - b_contradiction chart from real data ----------

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
  // actually examined - see app.js's identical comment on its own copy
  // of this function.
  const gapPts = bothPresent ? Math.abs(bankPct - gstPct).toFixed(1) : null;

  return `
<svg viewBox="0 0 400 156" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <line x1="${startX}" y1="${baseY}" x2="${endX}" y2="${baseY}" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 3"></line>
  ${bothPresent ? `<polygon class="gap-band ${hasContradiction ? "show pulse" : ""}" points="${startX},${baseY} ${endX},${bankY} ${endX},${gstY}"></polygon>` : ""}
  <polyline class="signal-line bank drawn${hasBank ? "" : " unavailable"}" points="${startX},${baseY} ${endX},${bankY}"></polyline>
  <polyline class="signal-line gst drawn${hasGst ? "" : " unavailable"}" points="${startX},${baseY} ${endX},${gstY}"></polyline>
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

async function renderAct2() {
  const data = await fetchRecorded("b_contradiction");
  const titleEl = $("landing-chart-title");
  const subEl = $("landing-chart-sub");
  if (!data) {
    titleEl.textContent = "Case data not available.";
    return;
  }
  const steps = dedupLedgerSteps(data.ledgerSteps);
  const bankClaim = findClaim(steps, "bank_statement_agent", "income_trend");
  const gstClaim = findClaim(steps, "gst_tax_agent", "revenue_trend");
  const contradiction = (data.decision.contradictions || []).find((c) => c.rule === "income_vs_revenue_divergence");

  $("landing-chart").innerHTML = divergenceSvg(bankClaim, gstClaim, !!contradiction);
  if (contradiction) {
    titleEl.textContent = "⚠ Income vs. revenue signals diverge";
    titleEl.className = "divergence-title contradiction";
  } else {
    titleEl.textContent = "✓ Income vs. revenue signals agree";
    titleEl.className = "divergence-title agree";
  }
  subEl.textContent = contradiction
    ? contradiction.finding
    : "The bank and GST agents agree on direction - no divergence to cross-check here.";
}

// ---------- Chapter 4: Climax - b_stale_consent, fully data-driven ----------
//
// Deliberately generic: the brief's working draft described this moment as
// "confidence counts 0.95 -> 0.00; DECLINE stamps in", but the real
// recorded b_stale_consent.json has since drifted (its consent is
// time-based) and currently shows a MANUAL REVIEW, not a DECLINE, and a
// 1.00 -> 0.14 count, not 0.95 -> 0.00. This renders whatever the real
// recorded file actually says, every time - never a hardcoded number or
// outcome label, so it can't go stale the way a scripted value would.

function climaxSummarySentence(decision, weakest) {
  if (!weakest) return "";
  const sourceLabel = weakest.source.replace("_findings", "");
  const age = weakest.days_remaining <= 0 ? `expired ${Math.abs(weakest.days_remaining)}d ago` : `expires in ${weakest.days_remaining}d`;
  return `${sourceLabel} consent ${age}, capping confidence from ${decision.model_confidence.toFixed(2)} to ${decision.final_confidence.toFixed(2)}.`;
}

async function renderClimax(onDone) {
  const data = await fetchRecorded("b_stale_consent");
  if (!data) {
    $("climax-sub").textContent = "Case data not available.";
    if (onDone) onDone();
    return;
  }
  const { decision, consentSources } = data;
  const weakest = consentSources.find((s) => s.source === decision.weakest_consent_source) || consentSources[0];
  const meta = OUTCOME_META[decision.outcome];

  $("climax-days").textContent = weakest.days_remaining <= 0 ? `expired ${Math.abs(weakest.days_remaining)}d ago` : `expires in ${weakest.days_remaining}d`;
  $("climax-model-confidence").textContent = `model confidence ${decision.model_confidence.toFixed(2)}`;
  $("climax-sub").textContent = climaxSummarySentence(decision, weakest);

  const gaugeFill = $("climax-gauge-fill");
  const numberEl = $("climax-confidence-number");
  const outcomeEl = $("climax-outcome");
  outcomeEl.className = `outcome-badge outcome-${decision.outcome}`;
  outcomeEl.textContent = `${meta.icon} ${meta.label}`;

  const targetPct = Math.max(3, Math.min(100, weakest.confidence_multiplier * 100));

  if (REDUCE_MOTION) {
    gaugeFill.style.width = `${targetPct}%`;
    if (weakest.confidence_multiplier < 1) gaugeFill.classList.add(decision.final_confidence <= 0 ? "bad" : "warn");
    numberEl.textContent = decision.final_confidence.toFixed(2);
    outcomeEl.classList.add("show");
    if (onDone) onDone();
    return;
  }

  // Starts full (the model's own confidence, pre-decay) and drains down to
  // the real post-decay target - a draining gauge in sync with the number
  // counting down, same duration.
  const duration = 1400;
  gaugeFill.style.width = "100%";
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const widthNow = 100 + (targetPct - 100) * eased;
    const confNow = decision.model_confidence + (decision.final_confidence - decision.model_confidence) * eased;
    gaugeFill.style.width = `${widthNow}%`;
    numberEl.textContent = confNow.toFixed(2);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      gaugeFill.style.width = `${targetPct}%`;
      numberEl.textContent = decision.final_confidence.toFixed(2);
      if (weakest.confidence_multiplier < 1) gaugeFill.classList.add(decision.final_confidence <= 0 ? "bad" : "warn");
      delay(() => outcomeEl.classList.add("show"), 150);
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(tick);
}

// ---------- Chapter 5: Casebook - all 8 real recorded cases ----------

async function renderCasebook() {
  const grid = $("casebook-grid");
  const results = await Promise.all(CASEBOOK.map((c) => fetchRecorded(c.id)));

  grid.innerHTML = CASEBOOK.map((c, i) => {
    const data = results[i];
    if (!data) {
      return `<div class="casebook-card casebook-card-missing"><div class="casebook-id mono">${c.id}</div><div class="casebook-scenario">${c.scenario}</div><div class="casebook-status">Case data not available</div></div>`;
    }
    const meta = OUTCOME_META[data.decision.outcome];
    return `
      <a class="casebook-card reveal-item" href="/desk?case=${c.id}">
        <div class="casebook-group-tag">${c.group}</div>
        <div class="casebook-id mono">${c.id}</div>
        <div class="casebook-scenario">${c.scenario}</div>
        <div class="casebook-chip outcome-badge outcome-${data.decision.outcome} show">${meta.icon} ${meta.label}</div>
        <div class="casebook-confidence mono">${data.decision.final_confidence.toFixed(2)}</div>
      </a>`;
  }).join("");

  if (!REDUCE_MOTION) {
    grid.querySelectorAll(".reveal-item").forEach((el, i) => {
      delay(() => el.classList.add("in-view"), 40 * i);
    });
  } else {
    grid.querySelectorAll(".reveal-item").forEach((el) => el.classList.add("in-view"));
  }
}

// ---------- Chapter reveal on scroll ----------

function setupReveal() {
  const chapters = document.querySelectorAll(".chapter");
  if (REDUCE_MOTION) {
    chapters.forEach((ch) => {
      ch.classList.add("in-view");
      ch.querySelectorAll(".reveal-item").forEach((el) => el.classList.add("in-view"));
    });
    return;
  }

  const announcer = $("chapter-announcer");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const ch = entry.target;
        if (ch.classList.contains("in-view")) return;
        ch.classList.add("in-view");
        ch.querySelectorAll(".reveal-item").forEach((el, i) => {
          delay(() => el.classList.add("in-view"), 60 * i);
        });
        if (ch.dataset.chapter === "4") renderAct2();
        if (ch.dataset.chapter === "5") renderClimax();
        if (announcer) announcer.textContent = ch.getAttribute("aria-label") || "";
      });
    },
    { threshold: 0.35 }
  );
  chapters.forEach((ch) => observer.observe(ch));
}

// ---------- Boot ----------

setupReveal();
renderCasebook();
if (REDUCE_MOTION) {
  // Chapters 3/4 are data-driven and weren't triggered by the (skipped)
  // observer above - render them immediately instead.
  renderAct2();
  renderClimax();
}
