"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Activity,
  Lock,
  Unlock,
  Server,
  Cpu,
  Database,
  ArrowRight,
  RefreshCw,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Building,
  KeyRound,
  ExternalLink,
  ChevronRight,
  Eye,
  EyeOff,
  Radio,
  Layers,
  Search,
  LogIn,
  Sliders,
  Workflow,
  Sparkles,
  FileCheck,
  Check,
  RotateCcw,
  Clock,
  Fingerprint
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & SYSTEM CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

export type CustomerStep = 1 | 2 | 3 | 4;

export interface SystemAuditEvent {
  id: string;
  timestamp: string;
  eventToken: string;
  operator: string;
  targetNode: string;
  action: string;
  status: "SUCCESS" | "DENIED" | "WARNING";
  sha256BlockDigest: string;
  metadata?: Record<string, string | number>;
}

export interface ChannelState {
  id: "gstn" | "itr" | "bank";
  title: string;
  subtitle: string;
  protocol: string;
  recordsCount: number;
  verified: boolean;
}

// Deterministic cryptographic block digest generator
const generateBlockDigest = (seed: string): string => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `0x8f2a${hex}e9c14092b740e53a992bc44d32098d6541f5a11${hex}`;
};

export function TrueLedgerEnterpriseApp() {
  // ───────────────────────────────────────────────────────────────────────────
  // STATE MACHINE & ROUTING
  // ───────────────────────────────────────────────────────────────────────────
  // Customer progressive disclosure: Step 1 (Login) -> Step 2 (Onboarding) -> Step 3 (Processing) -> Step 4 (Verdict)
  const [currentStep, setCurrentStep] = useState<CustomerStep>(1);

  // Hidden Developer State (Completely isolated from Customer flow)
  const [isDevRouteActive, setIsDevRouteActive] = useState<boolean>(false);
  const [isDevAuthenticated, setIsDevAuthenticated] = useState<boolean>(false);
  const [devUsername, setDevUsername] = useState<string>("");
  const [devPassword, setDevPassword] = useState<string>("");
  const [devAuthError, setDevAuthError] = useState<string | null>(null);

  // Customer Step 1: Login credentials
  const [customerEmail, setCustomerEmail] = useState<string>("analyst@apexcapital.fi");
  const [customerPassword, setCustomerPassword] = useState<string>("••••••••••••");
  const [isCustomerAuthLoading, setIsCustomerAuthLoading] = useState<boolean>(false);

  // Customer Step 2: Onboarding & Document Upload Channels
  const [entityName, setEntityName] = useState<string>("Acme Hyperion Logistics Corp");
  const [channels, setChannels] = useState<Record<string, boolean>>({
    gstn: false,
    itr: false,
    bank: false,
  });

  // Customer Step 3: Raw Telemetry Stream & Agent Swarm Execution
  const [swarmProgress, setSwarmProgress] = useState<number>(0);
  const [activeAgentIndex, setActiveAgentIndex] = useState<number>(0);
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([]);

  // Customer Step 4: Final Output Privacy Mask
  const [gstinMasked, setGstinMasked] = useState<boolean>(true);

  // ───────────────────────────────────────────────────────────────────────────
  // APPEND-ONLY CENTRAL AUDIT LEDGER (Tracks customer activity invisibly)
  // ───────────────────────────────────────────────────────────────────────────
  const [auditLog, setAuditLog] = useState<SystemAuditEvent[]>([
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
  ]);

  const logSystemEvent = useCallback(
    (
      eventToken: string,
      operator: string,
      targetNode: string,
      action: string,
      status: "SUCCESS" | "DENIED" | "WARNING",
      metadata?: Record<string, string | number>
    ) => {
      const timestamp = new Date().toISOString();
      const digestSeed = `${timestamp}:${eventToken}:${operator}:${targetNode}:${action}`;
      const newEvent: SystemAuditEvent = {
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

      setAuditLog((prev) => [newEvent, ...prev]);
    },
    []
  );

  // ───────────────────────────────────────────────────────────────────────────
  // HIDDEN DEVELOPER ROUTE LISTENER (/app/dev-login or #dev-login or Key Shortcut)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const checkHashOrPath = () => {
      if (typeof window !== "undefined") {
        const hash = window.location.hash.toLowerCase();
        const path = window.location.pathname.toLowerCase();
        if (hash === "#dev-login" || hash === "#view=dev_auth" || path === "/app/dev-login") {
          setIsDevRouteActive(true);
        }
      }
    };

    checkHashOrPath();
    window.addEventListener("hashchange", checkHashOrPath);

    // Hidden Keyboard Sequence Trigger: Ctrl + Shift + D
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setIsDevRouteActive((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("hashchange", checkHashOrPath);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 HANDLERS (Customer Login)
  // ───────────────────────────────────────────────────────────────────────────
  const handleCustomerLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsCustomerAuthLoading(true);

    setTimeout(() => {
      setIsCustomerAuthLoading(false);
      logSystemEvent(
        "CUSTOMER_LOGIN_SUCCESS",
        customerEmail || "COMMERCIAL_USER",
        "gateway:auth-broker",
        `Corporate operator signed in successfully. Session token generated for ${customerEmail}.`,
        "SUCCESS"
      );
      setCurrentStep(2);
    }, 600);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2 HANDLERS (Onboarding & Ingestion Vector)
  // ───────────────────────────────────────────────────────────────────────────
  const isStep2Valid = useMemo(() => {
    return channels.gstn && channels.itr && channels.bank && entityName.trim().length > 0;
  }, [channels, entityName]);

  const toggleChannel = (channelKey: string) => {
    setChannels((prev) => {
      const updated = { ...prev, [channelKey]: !prev[channelKey] };
      const status = updated[channelKey] ? "CONNECTED" : "DISCONNECTED";
      logSystemEvent(
        `CHANNEL_${status}_${channelKey.toUpperCase()}`,
        "OPERATOR_CUSTOMER",
        `ingest:${channelKey}`,
        `Operator toggled ${channelKey.toUpperCase()} data rail: ${status}.`,
        "SUCCESS"
      );
      return updated;
    });
  };

  const handleProceedToIngestion = () => {
    if (!isStep2Valid) return;

    logSystemEvent(
      "ONBOARDING_DATA_INGESTION_CONFIRMED",
      "OPERATOR_CUSTOMER",
      "gateway:aa-broker",
      `Ingestion vector established for entity: '${entityName}'. All 3 rails verified (GSTN, ITR, Bank MFT).`,
      "SUCCESS",
      { entity: entityName, rails: "GSTN,ITR,BANK" }
    );

    setCurrentStep(3);
    startSwarmProcessing();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 HANDLERS (Agent Swarm Telemetry Processing)
  // ───────────────────────────────────────────────────────────────────────────
  const startSwarmProcessing = () => {
    setSwarmProgress(0);
    setActiveAgentIndex(0);
    setTelemetryLogs([
      `[0.00s] AA Protocol Broker handshake verified (ssl_tls1.3: asia-south1)`,
      `[0.15s] Initializing 3 parallel specialist execution nodes...`
    ]);

    logSystemEvent(
      "AGENT_SWARM_DISPATCHED",
      "ORCHESTRATOR_AGENT",
      "asia-south1:agent-swarm",
      "ParallelAgent swarm dispatched (Bank Specialist, GST Specialist, Investment Specialist).",
      "SUCCESS"
    );

    const stages = [
      { pct: 25, agent: 0, msg: `[0.42s] Bank Agent: Ingested 884 MFT transaction records. Gross inflows computed at ₹2,10,00,000 (+2.1% YoY).` },
      { pct: 55, agent: 1, msg: `[0.85s] GST Agent: Parsed 24 GSTR-3B filings. Turnover declared at ₹1,65,00,000 (-11.0% YoY).` },
      { pct: 80, agent: 2, msg: `[1.20s] Investment Agent: Portfolio audit complete. Liquid buffer validated at ₹32.4L.` },
      { pct: 100, agent: 3, msg: `[1.65s] Synthesizer: Flagged structural variance delta of 27.2% between Bank vs GST filings.` },
    ];

    stages.forEach((stage, idx) => {
      setTimeout(() => {
        setSwarmProgress(stage.pct);
        setActiveAgentIndex(stage.agent);
        setTelemetryLogs((prev) => [...prev, stage.msg]);

        if (stage.pct === 100) {
          logSystemEvent(
            "CONTRADICTION_FLAGGED",
            "RULE_INCOME_REV_DIVERGENCE",
            "rules:deterministic-core",
            "Flagged asymmetric revenue divergence: Bank credits (+2.1%) vs GSTR-3B (-11.0%). Applied capped confidence: 0.50.",
            "WARNING"
          );
        }
      }, (idx + 1) * 600);
    });
  };

  const handleAdvanceToVerdict = () => {
    setCurrentStep(4);
    logSystemEvent(
      "CUSTOMER_ACCESSED_FINAL_DOSSIER",
      "OPERATOR_CUSTOMER",
      "synthesizer:decision-card",
      `Rendered final algorithmic decision dossier for ${entityName}. Output Verdict: MANUAL REVIEW.`,
      "SUCCESS"
    );
  };

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4 HANDLERS (Final Reconciliation Verdict & Outputs)
  // ───────────────────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    logSystemEvent(
      "CUSTOMER_LEDGER_EXPORT_CSV",
      "OPERATOR_CUSTOMER",
      "export:dossier-builder",
      "Exported RFC 4180 audit trail and reconciliation ledger as CSV.",
      "SUCCESS"
    );

    const csvContent =
      "data:text/csv;charset=utf-8," +
      "Event_ID,Timestamp,Operator,Target_Node,Action,Status,SHA256_Digest\n" +
      auditLog
        .map(
          (e) =>
            `"${e.id}","${e.timestamp}","${e.operator}","${e.targetNode}","${e.action.replace(/"/g, '""')}","${e.status}","${e.sha256BlockDigest}"`
        )
        .join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `TrueLedger_Reconciliation_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPDF = () => {
    logSystemEvent(
      "CUSTOMER_AUDIT_REPORT_PDF_GENERATED",
      "OPERATOR_CUSTOMER",
      "export:pdf-render-engine",
      `Compiled cryptographic decision dossier for ${entityName}.`,
      "SUCCESS"
    );
    window.print();
  };

  const handleResetWizard = () => {
    setCurrentStep(1);
    setChannels({ gstn: false, itr: false, bank: false });
    setSwarmProgress(0);
    logSystemEvent(
      "CUSTOMER_WIZARD_RESET",
      "OPERATOR_CUSTOMER",
      "flow:state-machine",
      "Operator reset progressive disclosure wizard to Step 1.",
      "SUCCESS"
    );
  };

  // ───────────────────────────────────────────────────────────────────────────
  // DEVELOPER SYSTEM HANDLERS (Isolated credentials gate & governance console)
  // ───────────────────────────────────────────────────────────────────────────
  const handleDevLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (devUsername === "admin" && devPassword === "TrueLedger2026!") {
      setIsDevAuthenticated(true);
      setDevAuthError(null);
      logSystemEvent(
        "DEV_PORTAL_AUTH_GRANTED",
        devUsername,
        "auth:governance-vault",
        "Developer elevated permissions successfully issued. Session route initialized.",
        "SUCCESS"
      );
    } else {
      setDevAuthError("Access Restricted: Invalid administrative signature or key.");
      logSystemEvent(
        "DEV_PORTAL_AUTH_REJECTED",
        devUsername || "ANONYMOUS",
        "auth:governance-vault",
        "Failed authentication attempt against developer console endpoint.",
        "DENIED"
      );
    }
  };

  const handleExitDevConsole = () => {
    setIsDevAuthenticated(false);
    setIsDevRouteActive(false);
    setDevAuthError(null);
    setDevPassword("");
    if (typeof window !== "undefined" && window.location.hash.includes("dev")) {
      window.location.hash = "";
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#060913] font-sans text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* ─────────────────────────────────────────────────────────────────────
          GLOBAL APPLICATION HEADER
          (Completely sanitized of developer tools in Customer view)
      ───────────────────────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#090d1a] px-6">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 shadow-lg shadow-indigo-600/30 ring-1 ring-white/20">
            <ShieldCheck className="h-4 w-4 text-white" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="font-bold tracking-tight text-white text-base">TrueLedger</span>
            <span className="rounded bg-indigo-950 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-indigo-400 ring-1 ring-indigo-500/30">
              APEX RISK
            </span>
          </div>
        </div>

        {/* PROGRESSIVE DISCLOSURE WIZARD STEPPER (Customer View Only) */}
        {!isDevRouteActive && (
          <nav className="flex items-center space-x-2 font-mono text-xs" aria-label="Customer Progress">
            {[
              { num: 1, label: "Authentication" },
              { num: 2, label: "Onboarding & Rails" },
              { num: 3, label: "Raw Telemetry & Swarm" },
              { num: 4, label: "Final Verdict" },
            ].map((st, idx) => {
              const isPast = currentStep > st.num;
              const isCurrent = currentStep === st.num;
              const isLocked = currentStep < st.num;

              return (
                <React.Fragment key={st.num}>
                  {idx > 0 && <span className="text-slate-700">›</span>}
                  <div
                    className={`flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-[11px] transition-all ${
                      isCurrent
                        ? "bg-indigo-600/20 text-indigo-300 font-bold ring-1 ring-indigo-500/40"
                        : isPast
                        ? "text-emerald-400 bg-emerald-950/20"
                        : "text-slate-600"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                        isCurrent
                          ? "bg-indigo-600 text-white"
                          : isPast
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {isPast ? "✓" : st.num}
                    </span>
                    <span>{st.label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </nav>
        )}

        {/* RIGHT TOPBAR INDICATORS */}
        <div className="flex items-center space-x-4 text-xs font-mono text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline">Region: asia-south1</span>
          </div>

          {/* Invisible trigger hook: Clicking the release tag with Alt/Ctrl or double-click triggers /app/dev-login */}
          <span
            onDoubleClick={() => setIsDevRouteActive(true)}
            title="Institutional Release Build"
            className="cursor-default select-none rounded bg-slate-900 px-2 py-0.5 text-[10px] text-slate-500 border border-slate-800"
          >
            v2.4.0-prod
          </span>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────────────
          MAIN VIEWPORT ROUTER
      ───────────────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {/* ===================================================================
            SECTION A: THE INVISIBLE DEVELOPER SYSTEM (/app/dev-login)
        =================================================================== */}
        {isDevRouteActive ? (
          <div className="min-h-full">
            {!isDevAuthenticated ? (
              /* DEVELOPER AUTHENTICATION GATE */
              <div className="mx-auto flex max-w-md flex-col justify-center px-6 py-20">
                <div className="rounded-2xl border border-slate-800 bg-[#0c101d] p-8 shadow-2xl">
                  <div className="flex items-center space-x-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 text-amber-400">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white tracking-tight">System Developer Gateway</h2>
                      <span className="text-xs font-mono text-slate-500">Route: /app/dev-login</span>
                    </div>
                  </div>

                  <form onSubmit={handleDevLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">
                        Administrative Signature (Username)
                      </label>
                      <input
                        type="text"
                        value={devUsername}
                        onChange={(e) => setDevUsername(e.target.value)}
                        placeholder="admin"
                        required
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">
                        Cryptographic Key (Password)
                      </label>
                      <input
                        type="password"
                        value={devPassword}
                        onChange={(e) => setDevPassword(e.target.value)}
                        placeholder="••••••••••••••••"
                        required
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-indigo-500"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Mock signature: <code className="text-indigo-400">admin</code> / <code className="text-indigo-400">TrueLedger2026!</code>
                      </span>
                    </div>

                    {devAuthError && (
                      <div className="flex items-center space-x-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5 text-xs text-rose-400">
                        <XCircle className="h-4 w-4 shrink-0" />
                        <span>{devAuthError}</span>
                      </div>
                    )}

                    <div className="flex space-x-3 pt-2">
                      <button
                        type="button"
                        onClick={handleExitDevConsole}
                        className="w-1/2 rounded-lg border border-slate-800 bg-slate-900 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                      >
                        Return to Customer View
                      </button>
                      <button
                        type="submit"
                        className="w-1/2 rounded-lg bg-indigo-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
                      >
                        Authenticate
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              /* ISOLATED SYSTEM GOVERNANCE CONSOLE */
              <div className="space-y-6 p-8 max-w-7xl mx-auto">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-5">
                  <div>
                    <div className="flex items-center space-x-3">
                      <Terminal className="h-6 w-6 text-indigo-400" />
                      <h2 className="text-2xl font-bold tracking-tight text-white">System Governance Console</h2>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Isolated administrative suite. Captures append-only audit telemetry across customer actions without exposure.
                    </p>
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center space-x-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Dump Telemetry (.CSV)</span>
                    </button>
                    <button
                      onClick={handleExitDevConsole}
                      className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-1.5 font-mono text-xs text-rose-400 hover:bg-rose-900/30 transition-colors"
                    >
                      Exit Developer Mode
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: "Active Sub-Agent Workers", val: "3 Workers", sub: "ParallelAgent Group", ok: true },
                    { label: "Orchestrator Latency", val: "1,240 ms", sub: "Gemini 3.1 Pro preview", ok: true },
                    { label: "Firestore Read/Write Pool", val: "100% Synced", sub: "Native Mode (asia-south1)", ok: true },
                    { label: "Total Logged Audit Events", val: `${auditLog.length} Records`, sub: "Append-only immutable", ok: true },
                  ].map((kpi, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-[#0c101d] p-4">
                      <span className="text-[11px] font-mono uppercase text-slate-500">{kpi.label}</span>
                      <div className="mt-1 font-mono text-xl font-bold text-white">{kpi.val}</div>
                      <span className="text-xs text-slate-400 mt-0.5 block">{kpi.sub}</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-[#0c101d] p-6 shadow-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <Server className="h-4 w-4 text-indigo-400" />
                      <h3 className="font-semibold text-sm text-white tracking-tight">
                        Append-Only Immutable Event Bus Stream
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-slate-500">Live Memory State ({auditLog.length} Events)</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500 bg-slate-950/60">
                        <tr>
                          <th className="py-2.5 px-3">Timestamp</th>
                          <th className="py-2.5 px-3">Event Token</th>
                          <th className="py-2.5 px-3">Operator</th>
                          <th className="py-2.5 px-3">Target Node</th>
                          <th className="py-2.5 px-3">Action Description</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">SHA-256 Block Digest</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300">
                        {auditLog.map((ev) => (
                          <tr key={ev.id} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                              {ev.timestamp.replace("T", " ").slice(0, 19)}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-indigo-400 whitespace-nowrap">
                              {ev.eventToken}
                            </td>
                            <td className="py-2.5 px-3 text-slate-200 whitespace-nowrap">{ev.operator}</td>
                            <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{ev.targetNode}</td>
                            <td className="py-2.5 px-3 font-sans text-xs text-slate-300 max-w-md">{ev.action}</td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  ev.status === "SUCCESS"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : ev.status === "WARNING"
                                    ? "bg-amber-500/10 text-amber-400"
                                    : "bg-rose-500/10 text-rose-400"
                                }`}
                              >
                                {ev.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 text-[10px] max-w-xs truncate" title={ev.sha256BlockDigest}>
                              {ev.sha256BlockDigest}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ===================================================================
              SECTION B: THE CUSTOMER PROGRESSIVE DISCLOSURE FLOW (STEPS 1 - 4)
          =================================================================== */
          <div className="min-h-full">
            {/* ─────────────────────────────────────────────────────────────────
                STEP 1: CUSTOMER LOGIN PAGE
            ───────────────────────────────────────────────────────────────── */}
            {currentStep === 1 && (
              <div className="mx-auto flex max-w-md flex-col justify-center px-6 py-20">
                <div className="text-center mb-8">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/40">
                    <Shield className="h-6 w-6" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-white">Commercial Credit Gateway</h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Sign in to initialize borrower telemetry and multi-agent reconciliation.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-[#0c101d] p-8 shadow-2xl">
                  <form onSubmit={handleCustomerLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">
                        Corporate Analyst Email
                      </label>
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1">
                        Security Credential
                      </label>
                      <input
                        type="password"
                        value={customerPassword}
                        onChange={(e) => setCustomerPassword(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="pt-2 space-y-3">
                      <button
                        type="submit"
                        disabled={isCustomerAuthLoading}
                        className="flex w-full items-center justify-center space-x-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-all hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <LogIn className="h-4 w-4" />
                        <span>{isCustomerAuthLoading ? "Authenticating Vault..." : "Sign In to Credit Vault"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCustomerLogin()}
                        className="flex w-full items-center justify-center space-x-2 rounded-xl border border-slate-800 bg-slate-900/80 py-2.5 text-xs font-semibold text-indigo-300 transition-all hover:bg-slate-800 hover:text-white"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Demokit Simulation Login (Instant)</span>
                      </button>
                    </div>
                  </form>

                  <div className="mt-6 border-t border-slate-800/80 pt-4 text-center">
                    <span className="text-[11px] font-mono text-slate-500">
                      🔒 256-Bit TLS Encryption · SOC2 Type II Certified
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                STEP 2: ONBOARDING & DATA INGESTION VECTOR
            ───────────────────────────────────────────────────────────────── */}
            {currentStep === 2 && (
              <div className="mx-auto flex max-w-4xl flex-col justify-center px-6 py-12">
                <div className="mb-8 text-center">
                  <span className="rounded-full bg-indigo-500/10 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-indigo-400 ring-1 ring-indigo-500/30">
                    Step 2 of 4 · Telemetry Intake
                  </span>
                  <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                    Commercial Entity Onboarding & Data Vector
                  </h1>
                  <p className="mt-2 text-sm text-slate-400">
                    Connect official Account Aggregator rails to begin deterministic verification.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800/90 bg-[#0c101d] p-8 shadow-2xl">
                  {/* Entity Name Field */}
                  <div className="mb-6">
                    <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
                      Legal Business Entity Name
                    </label>
                    <div className="flex rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 focus-within:border-indigo-500">
                      <Building className="mr-3 h-5 w-5 text-slate-500" />
                      <input
                        type="text"
                        value={entityName}
                        onChange={(e) => setEntityName(e.target.value)}
                        placeholder="Enter legal business name"
                        className="w-full bg-transparent text-sm font-semibold text-white outline-none"
                      />
                    </div>
                  </div>

                  {/* 3 Verification Channels */}
                  <div className="mb-8 space-y-3">
                    <span className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                      Data Verification Channels (All 3 Channels Required to Proceed)
                    </span>

                    {[
                      {
                        id: "gstn",
                        title: "GSTN GSTR-1 & 3B Returns Ledger",
                        desc: "Automated G2G gateway connection. Reconciles period-by-period declared gross turnover.",
                        count: 24,
                        protocol: "REST / GSTN-OAuth2",
                      },
                      {
                        id: "itr",
                        title: "Income Tax Ingestion Framework",
                        desc: "Centralized ITR Form-16 / 26AS data. Validates filed taxable profit vs operational cash flow.",
                        count: 3,
                        protocol: "CBDT e-Filing API",
                      },
                      {
                        id: "bank",
                        title: "Bank Statement Aggregator Feed",
                        desc: "Direct Bank MFT transfer log across primary commercial accounts. Computes credit receipts.",
                        count: 884,
                        protocol: "Account Aggregator AA/Setu",
                      },
                    ].map((channel) => {
                      const isChecked = channels[channel.id as keyof typeof channels];
                      return (
                        <div
                          key={channel.id}
                          onClick={() => toggleChannel(channel.id)}
                          className={`flex cursor-pointer items-start justify-between rounded-xl border p-4 transition-all ${
                            isChecked
                              ? "border-emerald-500/40 bg-emerald-950/10 shadow-sm"
                              : "border-slate-800/80 bg-slate-950/50 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-start space-x-3.5">
                            <div
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                isChecked
                                  ? "border-emerald-500 bg-emerald-500 text-slate-950"
                                  : "border-slate-700 bg-slate-900"
                              }`}
                            >
                              {isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-semibold text-white">{channel.title}</span>
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                                  {channel.protocol}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-400 leading-relaxed">{channel.desc}</p>
                            </div>
                          </div>

                          <span className="font-mono text-xs text-slate-500 whitespace-nowrap ml-4">
                            {channel.count} records verified
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Verification Status & Proceed Button */}
                  <div className="flex items-center justify-between border-t border-slate-800/80 pt-6">
                    <div className="text-xs">
                      {isStep2Valid ? (
                        <span className="flex items-center text-emerald-400 font-medium">
                          <CheckCircle2 className="mr-1.5 h-4 w-4" /> All 3 telemetry rails connected. Ready for ingestion.
                        </span>
                      ) : (
                        <span className="flex items-center text-amber-400/90 font-medium">
                          <AlertTriangle className="mr-1.5 h-4 w-4" /> Please activate all 3 channels to proceed.
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleProceedToIngestion}
                      disabled={!isStep2Valid}
                      className="flex items-center space-x-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-indigo-600/30 transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span>Proceed to Ingestion</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                STEP 3: RAW DATA STREAM & TELEMETRY STREAM (Processing State)
            ───────────────────────────────────────────────────────────────── */}
            {currentStep === 3 && (
              <div className="mx-auto flex max-w-5xl flex-col justify-center px-6 py-12">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <span className="rounded-full bg-indigo-500/10 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-indigo-400 ring-1 ring-indigo-500/30">
                      Step 3 of 4 · Swarm Telemetry Processing
                    </span>
                    <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
                      Autonomous Multi-Agent Cross-Source Verification
                    </h1>
                  </div>

                  {swarmProgress === 100 && (
                    <button
                      onClick={handleAdvanceToVerdict}
                      className="flex items-center space-x-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 transition-all hover:bg-emerald-500 animate-bounce"
                    >
                      <span>Review Final Audit Verdict</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Shimmer Progress Track */}
                <div className="mb-6 rounded-2xl border border-slate-800 bg-[#0c101d] p-6 shadow-xl">
                  <div className="flex items-center justify-between text-xs font-mono mb-2">
                    <span className="text-slate-400">Orchestrator Execution Pipeline:</span>
                    <span className="font-bold text-indigo-400 tabular-nums">{swarmProgress}% Completed</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${swarmProgress}%` }}
                    />
                  </div>
                </div>

                {/* 3 Specialist Agent Cards */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    {
                      title: "Bank Statement Agent",
                      desc: "Analyzing 884 primary credit credits",
                      status: swarmProgress >= 25 ? "Completed" : "Running",
                      stat: "₹2.10 Cr Inflows (+2.1%)",
                    },
                    {
                      title: "GST Returns Agent",
                      desc: "Reconciling 24 GSTR-3B filings",
                      status: swarmProgress >= 55 ? "Completed" : swarmProgress >= 25 ? "Running" : "Pending",
                      stat: "₹1.65 Cr Declared (-11.0%)",
                    },
                    {
                      title: "Investment Agent",
                      desc: "Auditing liquid reserves & portfolio",
                      status: swarmProgress >= 80 ? "Completed" : swarmProgress >= 55 ? "Running" : "Pending",
                      stat: "₹32.4L Validated Buffer",
                    },
                  ].map((ag, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border p-4 transition-all ${
                        ag.status === "Completed"
                          ? "border-emerald-500/40 bg-emerald-950/10"
                          : ag.status === "Running"
                          ? "border-indigo-500/40 bg-indigo-950/20"
                          : "border-slate-800 bg-slate-950/40 opacity-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{ag.title}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-bold ${
                            ag.status === "Completed"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : ag.status === "Running"
                              ? "bg-indigo-500/20 text-indigo-400 animate-pulse"
                              : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          {ag.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{ag.desc}</p>
                      <div className="mt-3 font-mono text-xs font-bold text-slate-200">{ag.stat}</div>
                    </div>
                  ))}
                </div>

                {/* Live Console Trace Ticker */}
                <div className="rounded-2xl border border-slate-800 bg-[#0c101d] p-6 shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3">
                    <span className="text-xs font-mono font-bold text-slate-400 uppercase">
                      Raw Telemetry & Execution Trace Stream
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">Node: asia-south1</span>
                  </div>

                  <div className="space-y-2 font-mono text-xs text-slate-300">
                    {telemetryLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start space-x-2">
                        <ChevronRight className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <span className="break-all">{log}</span>
                      </div>
                    ))}
                    {swarmProgress < 100 && (
                      <div className="flex items-center space-x-2 text-indigo-400 animate-pulse">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Evaluating mathematical variance across rails...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                STEP 4: FINAL RECONCILIATION VERDICT & OUTPUTS
            ───────────────────────────────────────────────────────────────── */}
            {currentStep === 4 && (
              <div className="space-y-6 p-8 max-w-6xl mx-auto">
                {/* Header Banner */}
                <div className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-[#0c101d] p-6 shadow-xl">
                  <div>
                    <span className="font-mono text-xs uppercase tracking-wider text-slate-500">
                      Step 4 of 4 · Final Audit Dossier
                    </span>
                    <div className="flex items-center space-x-3 mt-1">
                      <h2 className="text-2xl font-bold tracking-tight text-white">{entityName}</h2>
                      <div className="flex items-center rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-mono text-slate-400">
                        <span className="mr-2">GSTIN:</span>
                        <span className="text-white">{gstinMasked ? "•••• •••• 9812" : "27AAECK1298P1Z8"}</span>
                        <button
                          onClick={() => setGstinMasked(!gstinMasked)}
                          className="ml-2 text-slate-400 hover:text-white"
                          title="Toggle Privacy Mask"
                        >
                          {gstinMasked ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-700"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Export Ledger (.CSV)</span>
                    </button>

                    <button
                      onClick={handleDownloadPDF}
                      className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-700"
                    >
                      <Download className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Download Audit Report (.PDF)</span>
                    </button>

                    <button
                      onClick={handleResetWizard}
                      className="flex items-center space-x-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-400 hover:text-white"
                      title="Run another audit flow"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Restart Flow</span>
                    </button>
                  </div>
                </div>

                {/* 4 Metric Cards */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { title: "Gross Ingested Capital", value: "₹2,10,00,000", sub: "Annualized Inflows", delta: "+2.1%" },
                    { title: "GST-Declared Turnover", value: "₹1,65,00,000", sub: "GSTR-3B Declared", delta: "-11.0%", warn: true },
                    { title: "Active Ingestion Channels", value: "3/3 Rails", sub: "GSTN · ITR · Bank AA", delta: "100% Ingested" },
                    { title: "Consent Decay Haircut", value: "0.29 Multiplier", sub: "2 Days Remaining", delta: "-71% Haircut", warn: true },
                  ].map((m, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border p-4.5 bg-slate-900/60 backdrop-blur-sm ${
                        m.warn ? "border-amber-500/30 bg-amber-950/5" : "border-slate-800"
                      }`}
                    >
                      <span className="text-xs font-medium text-slate-400">{m.title}</span>
                      <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
                        {m.value}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                        <span>{m.sub}</span>
                        <span className={`font-mono font-semibold ${m.warn ? "text-amber-400" : "text-emerald-400"}`}>
                          {m.delta}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Discrepancy Card & Synthesizer Outcome */}
                <div className="grid grid-cols-3 gap-6">
                  {/* Discrepancy Card */}
                  <div className="col-span-2 rounded-2xl border border-rose-500/30 bg-[#0c101d] p-6 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                      <div className="flex items-center space-x-2.5">
                        <ShieldAlert className="h-5 w-5 text-rose-400" />
                        <div>
                          <h3 className="font-semibold text-white tracking-tight">
                            Asymmetric GST vs Bank Inflow Discrepancy Card
                          </h3>
                          <span className="font-mono text-xs text-slate-400">Rule Engine: RULE_INCOME_REV_DIVERGENCE</span>
                        </div>
                      </div>
                      <span className="rounded bg-rose-500/10 px-2.5 py-1 font-mono text-xs font-bold text-rose-400 ring-1 ring-rose-500/30">
                        27.2% Variance Delta
                      </span>
                    </div>

                    <p className="mt-4 text-xs text-slate-300 leading-relaxed font-sans">
                      Deterministic cross-examination revealed a critical divergence: The primary commercial bank statement exhibits steady credit receipts totaling <strong>₹2,10,00,000</strong> (+2.1% YoY), whereas parallel GSTR-3B filings register only <strong>₹1,65,00,000</strong> (-11.0% YoY) for the identical period.
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-4 font-mono text-xs">
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                        <span className="text-[10px] uppercase text-slate-500 block">Bank Aggregator Ledger</span>
                        <span className="text-base font-bold text-emerald-400 block mt-1">₹2,10,00,000</span>
                        <span className="text-[11px] text-slate-400">Trend: Rising / Stable (+2.1%)</span>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                        <span className="text-[10px] uppercase text-slate-500 block">GSTN Official Filing</span>
                        <span className="text-base font-bold text-rose-400 block mt-1">₹1,65,00,000</span>
                        <span className="text-[11px] text-slate-400">Trend: Sharp Contraction (-11.0%)</span>
                      </div>
                    </div>
                  </div>

                  {/* Synthesizer Outcome Card */}
                  <div className="rounded-2xl border border-slate-800 bg-[#0c101d] p-6 shadow-xl flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-mono uppercase tracking-wider text-slate-500 block">
                        Synthesizer Outcome
                      </span>
                      <div className="mt-2 flex items-center space-x-2">
                        <span className="flex items-center space-x-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>MANUAL REVIEW</span>
                        </span>
                        <span className="font-mono text-xs text-slate-400">Score: 0.14</span>
                      </div>

                      <div className="mt-4 space-y-2 border-t border-slate-800/80 pt-4 text-xs font-mono">
                        <div className="flex justify-between text-slate-400">
                          <span>Model Confidence:</span>
                          <span className="text-slate-200">0.50 (Capped)</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Consent Multiplier:</span>
                          <span className="text-amber-400">×0.29 (2d left)</span>
                        </div>
                        <div className="flex justify-between text-slate-400 font-bold border-t border-slate-800 pt-1">
                          <span>Final Confidence:</span>
                          <span className="text-amber-400">0.14</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 border-t border-slate-800/80 pt-4">
                      <span className="text-[10px] uppercase font-mono text-slate-500 block mb-1">
                        SHA-256 Decision Block Digest
                      </span>
                      <span className="block break-all font-mono text-[10px] text-indigo-400/90 bg-slate-950 p-2 rounded border border-slate-800">
                        {auditLog[0]?.sha256BlockDigest || "0x8f2ae9c14092b740e53a992bc44d32098d6541f5a11e89bc"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default TrueLedgerEnterpriseApp;
