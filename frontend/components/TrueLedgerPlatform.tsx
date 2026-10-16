"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Layers,
  Search,
  Eye,
  EyeOff,
  Command,
  RefreshCw,
  SlidersHorizontal,
  Database,
  History,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

// --- TYPES & CONTRACTS ---

export type WorkspaceMode = "overview" | "forensics" | "ledger" | "settings";
export type Environment = "SANDBOX" | "PRODUCTION";
export type Verdict = "APPROVE" | "MANUAL_REVIEW" | "DECLINE";

export interface AgentExecutionState {
  id: string;
  name: string;
  model: string;
  status: "idle" | "evaluating" | "completed" | "flagged";
  finding: string;
  latencyMs: number;
  confidence: number;
}

export interface ContradictionRecord {
  id: string;
  title: string;
  ruleId: string;
  severity: "critical" | "warning";
  bankCitation: {
    label: string;
    value: string;
    ref: string;
  };
  gstCitation: {
    label: string;
    value: string;
    ref: string;
  };
  narrative: string;
}

const CONTRADICTIONS: ContradictionRecord[] = [
  {
    id: "CTR-8819",
    title: "Income Trajectory vs. GST Revenue Divergence",
    ruleId: "RULE_INCOME_REV_DIVERGENCE",
    severity: "critical",
    bankCitation: {
      label: "Bank Deposit Growth (H1-H2)",
      value: "+2.1% (Stable)",
      ref: "TXN_901-904",
    },
    gstCitation: {
      label: "GST-Declared Turnover",
      value: "-11.0% (Sharp Drop)",
      ref: "GSTR-3B_Q2",
    },
    narrative:
      "Bank ledger shows uniform credit growth of +2.1% across verified HDFC account while parallel GSTR-3B filings indicate an aggregate turnover shrinkage of -11.0% for the identical period.",
  },
  {
    id: "CTR-8820",
    title: "Declared Turnover vs. Actual Bank Credits Mismatch",
    ruleId: "RULE_DECLARED_VS_ACTUAL",
    severity: "critical",
    bankCitation: {
      label: "Actual Bank Credits",
      value: "₹2,10,00,000",
      ref: "CR_SUM_FY26",
    },
    gstCitation: {
      label: "Declared GSTR-1 Gross",
      value: "₹1,65,00,000",
      ref: "GSTR-1_ANNUAL",
    },
    narrative:
      "Total credited turnover exceeds tax-declared gross revenue by 27.2% (threshold: 15.0%). Discrepancy implies potential revenue under-reporting or unfiled secondary streams.",
  },
];

export function TrueLedgerPlatform() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceMode>("overview");
  const [environment, setEnvironment] = useState<Environment>("PRODUCTION");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isMasked, setIsMasked] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [isAuditing, setIsAuditing] = useState(false);
  const [consentDaysRemaining, setConsentDaysRemaining] = useState<number>(2);
  const [activeHighlightRef, setActiveHighlightRef] = useState<string | null>(null);

  const [agents] = useState<AgentExecutionState[]>([
    {
      id: "agent_bank",
      name: "Bank Statement Agent",
      model: "Gemini 3.8 Flash",
      status: "completed",
      finding: "Stable credits (+2.1%), cash flow volatility CoV: 0.12",
      latencyMs: 840,
      confidence: 0.88,
    },
    {
      id: "agent_gst",
      name: "GST/Tax Agent",
      model: "Gemini 3.8 Flash",
      status: "flagged",
      finding: "Declining turnover (-11.0%), GSTR-3B filings delayed 12d",
      latencyMs: 910,
      confidence: 0.94,
    },
    {
      id: "agent_inv",
      name: "Investment & Asset Agent",
      model: "Gemini 3.8 Flash",
      status: "completed",
      finding: "Liquid cushion: ₹44.5L, Insurance coverage ratio: 1.25x",
      latencyMs: 720,
      confidence: 0.82,
    },
  ]);

  const consentMultiplier = useMemo(() => {
    if (consentDaysRemaining > 7) return 1.0;
    if (consentDaysRemaining <= 0) return 0.0;
    return Number((consentDaysRemaining / 7).toFixed(2));
  }, [consentDaysRemaining]);

  const rawModelConfidence = 0.88;
  const finalConfidence = useMemo(() => {
    const capped = Math.min(rawModelConfidence, 0.5);
    return Number((capped * consentMultiplier).toFixed(2));
  }, [consentMultiplier]);

  const verdict: Verdict = useMemo(() => {
    if (finalConfidence <= 0.0) return "DECLINE";
    if (finalConfidence < 0.6) return "MANUAL_REVIEW";
    return "APPROVE";
  }, [finalConfidence]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleTriggerAudit = () => {
    setIsAuditing(true);
    setActiveWorkspace("forensics");
    setTimeout(() => {
      setIsAuditing(false);
    }, 1800);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      <aside
        className={`flex flex-col border-r border-slate-800/80 bg-slate-900/50 backdrop-blur-xl transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? "w-20" : "w-72"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-4">
          {!isSidebarCollapsed && (
            <div className="flex items-center space-x-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div className="leading-tight">
                <span className="block font-semibold tracking-tight text-white">TrueLedger</span>
                <span className="text-xs text-slate-400">Apex Risk Engine</span>
              </div>
            </div>
          )}

          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Toggle Sidebar"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3">
          <div
            className={`flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-medium text-slate-400 ${
              isSidebarCollapsed ? "justify-center" : ""
            }`}
          >
            <button
              onClick={() => setEnvironment("SANDBOX")}
              className={`rounded px-2.5 py-1 transition-all ${
                environment === "SANDBOX"
                  ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
                  : "hover:text-slate-200"
              }`}
            >
              {isSidebarCollapsed ? "S" : "Sandbox"}
            </button>
            <button
              onClick={() => setEnvironment("PRODUCTION")}
              className={`rounded px-2.5 py-1 transition-all ${
                environment === "PRODUCTION"
                  ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "hover:text-slate-200"
              }`}
            >
              {isSidebarCollapsed ? "P" : "Production"}
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {[
            { id: "overview", label: "Executive Dashboard", icon: Layers, badge: null },
            { id: "forensics", label: "Forensic Matrix", icon: ShieldAlert, badge: "2 Flags" },
            { id: "ledger", label: "Explainability Ledger", icon: History, badge: "Live" },
            { id: "settings", label: "Regulatory Rulesets", icon: Database, badge: null },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeWorkspace === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveWorkspace(item.id as WorkspaceMode)}
                className={`group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-indigo-600/10 text-indigo-400 ring-1 ring-indigo-500/30"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-200"}`} />
                {!isSidebarCollapsed && (
                  <span className="ml-3 flex-1 text-left tracking-tight">{item.label}</span>
                )}
                {!isSidebarCollapsed && item.badge && (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                      item.badge === "2 Flags"
                        ? "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800/80 p-3">
          <button
            onClick={() => setIsMasked(!isMasked)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200"
          >
            <div className="flex items-center space-x-2">
              {isMasked ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-emerald-400" />}
              {!isSidebarCollapsed && <span>{isMasked ? "Financial Mask Active" : "Unmasked Telemetry"}</span>}
            </div>
            {!isSidebarCollapsed && (
              <span className="font-mono text-[10px] text-slate-500">Auto-10s</span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-slate-800/80 bg-slate-900/40 px-6 backdrop-blur-md">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex w-96 items-center justify-between rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-400 shadow-inner hover:border-slate-700 hover:text-slate-200 transition-all"
          >
            <div className="flex items-center space-x-2">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <span>Search entity, GSTIN, PAN, transaction hash...</span>
            </div>
            <kbd className="flex items-center space-x-0.5 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              <Command className="h-2.5 w-2.5" />
              <span>K</span>
            </kbd>
          </button>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 border-r border-slate-800 pr-4 text-xs font-mono text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>AA Node: asia-south1</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 ring-2 ring-indigo-500/20 flex items-center justify-center font-bold text-xs text-white">
                AK
              </div>
              <div className="text-left text-xs">
                <span className="block font-medium text-slate-200">A. Kapoor</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Sr. Underwriter</span>
              </div>
            </div>
          </div>
        </header>

        <section className="flex items-center justify-between border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900/90 to-slate-950 px-6 py-3">
          <div className="flex items-center space-x-6">
            <div>
              <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 block">
                Target Entity
              </span>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-sm tracking-tight text-white">
                  Ramesh Kumar Enterprises
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {isMasked ? "•••• •••• 9812" : "27AAECK1298P1Z8"}
                </span>
              </div>
            </div>

            <div className="border-l border-slate-800 pl-6">
              <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 block">
                Algorithmic Verdict
              </span>
              <div className="flex items-center space-x-2">
                <span
                  className={`flex items-center space-x-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                    verdict === "MANUAL_REVIEW"
                      ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30"
                      : verdict === "APPROVE"
                      ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
                      : "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30"
                  }`}
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span>{verdict.replace("_", " ")}</span>
                </span>
                <span className="text-xs text-slate-400">Confidence: {(finalConfidence * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="border-l border-slate-800 pl-6">
              <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500 block">
                AA Consent Decay Haircut
              </span>
              <div className="flex items-center space-x-3">
                <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      consentDaysRemaining <= 2 ? "bg-rose-500" : "bg-indigo-500"
                    }`}
                    style={{ width: `${consentMultiplier * 100}%` }}
                  />
                </div>
                <span className="font-mono text-xs text-slate-300">
                  {consentDaysRemaining}d left (×{consentMultiplier})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleTriggerAudit}
              disabled={isAuditing}
              className="flex items-center space-x-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:bg-indigo-500 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isAuditing ? "animate-spin" : ""}`} />
              <span>{isAuditing ? "Auditing Pipeline..." : "Run Forensic Audit"}</span>
            </button>
          </div>
        </section>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { title: "Requested Facility", raw: "₹50,00,000", masked: "₹••,••,•••", delta: "Term: 36M", sub: "Working Capital" },
              { title: "Annualized Bank Credits", raw: "₹2,10,00,000", masked: "₹•,••,••,•••", delta: "+2.1% YoY", sub: "HDFC Primary Current" },
              { title: "GST-Declared Turnover", raw: "₹1,65,00,000", masked: "₹•,••,••,•••", delta: "-11.0% YoY", sub: "Turnover Discrepancy", flag: true },
              { title: "Pledgeable Liquid Assets", raw: "₹44,50,000", masked: "₹••,••,•••", delta: "1.25x Coverage", sub: "Mutual Fund Folios" },
            ].map((kpi, idx) => (
              <div
                key={idx}
                className={`rounded-xl border p-4 bg-slate-900/60 backdrop-blur-sm transition-all ${
                  kpi.flag ? "border-rose-500/30 bg-rose-950/10" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{kpi.title}</span>
                  {kpi.flag && <span className="font-mono text-[10px] text-rose-400 uppercase font-semibold">Flagged</span>}
                </div>
                <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
                  {isMasked ? kpi.masked : kpi.raw}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{kpi.sub}</span>
                  <span className={`font-mono ${kpi.flag ? "text-rose-400 font-semibold" : "text-emerald-400"}`}>
                    {kpi.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-indigo-400" />
                <h2 className="text-sm font-semibold tracking-tight text-white">
                  Autonomous Specialist Agent Swarm (Parallel Execution)
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-400">ADK Synthesizer Pattern</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 transition-all hover:border-slate-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">{agent.name}</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        agent.status === "flagged"
                          ? "bg-rose-500 ring-4 ring-rose-500/20"
                          : "bg-emerald-500 ring-4 ring-emerald-500/20"
                      }`}
                    />
                  </div>

                  <p className="mt-2 text-xs text-slate-400 leading-relaxed font-sans">{agent.finding}</p>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 font-mono text-[10px] text-slate-500">
                    <span>Model: {agent.model}</span>
                    <span>Latency: {agent.latencyMs}ms</span>
                    <span>Confidence: {(agent.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                <h2 className="text-sm font-semibold tracking-tight text-white">
                  Cross-Source Contradiction Matrix (Deterministic Rules Core)
                </h2>
              </div>
              <span className="rounded bg-rose-500/10 px-2 py-0.5 text-xs font-mono font-semibold text-rose-400 ring-1 ring-rose-500/30">
                2 Mismatches Detected
              </span>
            </div>

            <div className="space-y-4">
              {CONTRADICTIONS.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg border p-4 transition-all ${
                    activeHighlightRef === c.id
                      ? "border-indigo-500 bg-indigo-950/10 ring-1 ring-indigo-500/30"
                      : "border-slate-800/90 bg-slate-950/70 hover:border-slate-700"
                  }`}
                  onClick={() => setActiveHighlightRef(activeHighlightRef === c.id ? null : c.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {c.id}
                      </span>
                      <h3 className="text-xs font-semibold text-white tracking-tight">{c.title}</h3>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">{c.ruleId}</span>
                  </div>

                  <p className="mt-2 text-xs text-slate-300 leading-relaxed">{c.narrative}</p>

                  <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 font-mono text-xs">
                    <div className="rounded bg-slate-900/90 p-2.5 border border-slate-800">
                      <span className="text-[10px] uppercase text-slate-500 block">Bank Citation (AA Deposit)</span>
                      <div className="flex items-center justify-between mt-1">
                        <span className="font-semibold text-slate-200">{c.bankCitation.label}</span>
                        <span className="text-emerald-400">{c.bankCitation.value}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1 block">Ref: {c.bankCitation.ref}</span>
                    </div>

                    <div className="rounded bg-slate-900/90 p-2.5 border border-slate-800">
                      <span className="text-[10px] uppercase text-slate-500 block">GST Citation (GSTR-3B)</span>
                      <div className="flex items-center justify-between mt-1">
                        <span className="font-semibold text-slate-200">{c.gstCitation.label}</span>
                        <span className="text-rose-400">{c.gstCitation.value}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1 block">Ref: {c.gstCitation.ref}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {commandPaletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black overflow-hidden ring-1 ring-white/10">
            <div className="flex items-center border-b border-slate-800 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400 mr-3" />
              <input
                type="text"
                placeholder="Type a command or search entities, rules, or citations..."
                autoFocus
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              />
              <kbd className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ESC
              </kbd>
            </div>

            <div className="p-2 space-y-1 text-xs">
              <span className="px-3 py-1 font-mono text-[10px] uppercase text-slate-500 block">Actions</span>
              {[
                { label: "Trigger Complete Forensic Re-evaluation", action: "evaluate" },
                { label: "Export Immutable Firestore Audit Ledger", action: "export" },
                { label: "Switch to Stale Consent Case (b_stale_consent)", action: "case_stale" },
                { label: "Toggle Masked Financial View", action: "mask" },
              ].map((cmd, idx) => (
                <button
                  key={idx}
                  onClick={() => setCommandPaletteOpen(false)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-slate-300 hover:bg-indigo-600 hover:text-white transition-all text-left"
                >
                  <span>{cmd.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TrueLedgerPlatform;
