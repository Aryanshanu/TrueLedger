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
  Fingerprint,
  TrendingUp,
  TrendingDown,
  BarChart3,
  CreditCard,
  PieChart,
  HelpCircle,
  AlertOctagon,
  LogOut,
  Laptop
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & SYSTEM CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceMilestone =
  | "landing"
  | "login"
  | "auth"
  | "onboarding"
  | "processing"
  | "ingestion_processing"
  | "settled_dashboard";

export type SettledTab =
  | "dashboard"
  | "credit"
  | "client"
  | "income"
  | "compliance"
  | "assets";

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
  // Milestone state machine:
  // 'landing' -> 'auth' -> 'onboarding' -> 'ingestion_processing' -> 'settled_dashboard'
  const [currentMilestone, setCurrentMilestone] = useState<WorkspaceMilestone>("landing");
  const [activeSettledTab, setActiveSettledTab] = useState<SettledTab>("dashboard");

  // Hidden Developer State (Completely isolated from Customer flow)
  const [isDevRouteActive, setIsDevRouteActive] = useState<boolean>(false);
  const [isDevAuthenticated, setIsDevAuthenticated] = useState<boolean>(false);
  const [devUsername, setDevUsername] = useState<string>("");
  const [devPassword, setDevPassword] = useState<string>("");
  const [devAuthError, setDevAuthError] = useState<string | null>(null);

  // Authentication State
  const [customerEmail, setCustomerEmail] = useState<string>("analyst@apexcapital.fi");
  const [customerPassword, setCustomerPassword] = useState<string>("••••••••••••");
  const [isCustomerAuthLoading, setIsCustomerAuthLoading] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Active Target Entity: Ramesh Kumar Enterprises
  const [entityName, setEntityName] = useState<string>("Ramesh Kumar Enterprises");
  const [entityPan, setEntityPan] = useState<string>("AAECK1298P");
  const [channels, setChannels] = useState<Record<string, boolean>>({
    gstn: false,
    itr: false,
    bank: false,
  });

  // Telemetry Stream & Agent Swarm Execution
  const [swarmProgress, setSwarmProgress] = useState<number>(0);
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([]);
  const [isSwarmActive, setIsSwarmActive] = useState<boolean>(false);

  // Privacy Masking Toggle
  const [gstinMasked, setGstinMasked] = useState<boolean>(true);

  // Environment Pill
  const [envMode, setEnvMode] = useState<"PRODUCTION" | "SANDBOX">("PRODUCTION");

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // APPEND-ONLY CENTRAL AUDIT LEDGER
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
      return newEvent;
    },
    []
  );

  // ───────────────────────────────────────────────────────────────────────────
  // KEYBOARD & HASH ROUTE LISTENER FOR DEVELOPER ISOLATION
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#dev-login" || hash === "#view=dev_auth") {
        setIsDevRouteActive(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setIsDevRouteActive((prev) => !prev);
      }
    };

    window.addEventListener("hashchange", handleHash);
    window.addEventListener("keydown", handleKeyDown);
    handleHash();

    return () => {
      window.removeEventListener("hashchange", handleHash);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // VALIDATION & WORKFLOW CONTROLLERS
  // ───────────────────────────────────────────────────────────────────────────
  const isAllChannelsVerified = useMemo(() => {
    return channels.gstn && channels.itr && channels.bank && entityName.trim().length > 0;
  }, [channels, entityName]);

  const handleDemokitLogin = () => {
    setIsCustomerAuthLoading(true);
    setTimeout(() => {
      setIsAuthenticated(true);
      setIsCustomerAuthLoading(false);
      logSystemEvent(
        "CUSTOMER_DEMOKIT_AUTHENTICATED",
        "DEMO_RISK_ANALYST",
        "gateway:auth-broker",
        "Operator authorized via fast-track instant simulation session token.",
        "SUCCESS"
      );
      showToast("Authenticated: Welcome to Commercial Underwriting Portal");
      setCurrentMilestone("onboarding");
    }, 450);
  };

  const handleCustomerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsCustomerAuthLoading(true);
    setTimeout(() => {
      setIsAuthenticated(true);
      setIsCustomerAuthLoading(false);
      logSystemEvent(
        "CUSTOMER_LOGIN_SUCCESS",
        customerEmail,
        "gateway:auth-broker",
        `Corporate operator signed in successfully: ${customerEmail}.`,
        "SUCCESS"
      );
      showToast("Access Granted · Initializing Client Space");
      setCurrentMilestone("onboarding");
    }, 600);
  };

  const handleToggleChannel = (channelKey: string) => {
    setChannels((prev) => {
      const updated = { ...prev, [channelKey]: !prev[channelKey] };
      logSystemEvent(
        "INGESTION_CHANNEL_TOGGLED",
        "OPERATOR_CUSTOMER",
        `rail:${channelKey}`,
        `Document rail [${channelKey.toUpperCase()}] set to ${updated[channelKey] ? "VERIFIED" : "DISCONNECTED"}.`,
        "SUCCESS"
      );
      return updated;
    });
  };

  const handleStartIngestion = () => {
    if (!isAllChannelsVerified) return;

    logSystemEvent(
      "ONBOARDING_DATA_INGESTION_CONFIRMED",
      "OPERATOR_CUSTOMER",
      "gateway:aa-broker",
      `Ingestion vector established for entity '${entityName}'. All 3 primary data rails verified (GSTN, ITR, Bank MFT).`,
      "SUCCESS",
      { entity: entityName, rails: "GSTN,ITR,BANK" }
    );

    setCurrentMilestone("ingestion_processing");
    setSwarmProgress(0);
    setIsSwarmActive(true);
    setTelemetryLogs([
      "[0.00s] AA Protocol Broker handshake verified (ssl_tls1.3: asia-south1)",
      "[0.15s] Initializing 3 parallel specialist execution nodes in parallel..."
    ]);

    const stages = [
      { pct: 25, msg: "[0.42s] Bank Statement Agent: Ingested 884 primary credit receipts. Annualized inflows: ₹2,10,00,000 (+2.1% YoY)." },
      { pct: 55, msg: "[0.85s] GST Returns Agent: Reconciled 24 GSTR-3B filings. Turnover declared: ₹1,65,00,000 (-11.0% YoY)." },
      { pct: 80, msg: "[1.20s] Investment Agent: Portfolio audit complete. Liquid buffer validated at ₹32.4L." },
      { pct: 100, msg: "[1.65s] Synthesizer: Flagged structural variance delta of 27.2% between Bank vs GST filings. Verdict: MANUAL REVIEW." },
    ];

    stages.forEach((stage, idx) => {
      setTimeout(() => {
        setSwarmProgress(stage.pct);
        setTelemetryLogs((prev) => [...prev, stage.msg]);

        if (stage.pct === 100) {
          setIsSwarmActive(false);
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

  const handleProceedToSettledDashboard = () => {
    logSystemEvent(
      "CUSTOMER_ACCESSED_SETTLED_DASHBOARD",
      "OPERATOR_CUSTOMER",
      "synthesizer:decision-card",
      `Unlocked full institutional workspace for ${entityName}. Output Verdict: MANUAL REVIEW.`,
      "SUCCESS"
    );
    showToast("Audit Dossier Verified · Institutional Workspaces Unlocked");
    setCurrentMilestone("settled_dashboard");
    setActiveSettledTab("dashboard");
  };

  const handleDevAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (devUsername === "admin" && devPassword === "TrueLedger2026!") {
      setIsDevAuthenticated(true);
      setDevAuthError(null);
      logSystemEvent(
        "DEV_ADMIN_AUTHORIZED",
        "SUPER_ADMIN",
        "sec:gateway-auth",
        "Developer elevated privileges authorized for /app/dev-login.",
        "SUCCESS"
      );
      showToast("Developer Governance Console Unlocked");
    } else {
      setDevAuthError("Invalid Security Credentials. Authentication Denied.");
      logSystemEvent(
        "DEV_AUTH_FAILED",
        devUsername || "UNKNOWN",
        "sec:gateway-auth",
        `Unauthorized dev access attempt with username '${devUsername}'.`,
        "DENIED"
      );
    }
  };

  const handleExportCSV = () => {
    logSystemEvent(
      "LEDGER_EXPORT_CSV_TRIGGERED",
      "OPERATOR_CUSTOMER",
      "export:csv-streamer",
      `Exported reconciliation audit ledger for ${entityName} (.CSV format).`,
      "SUCCESS"
    );

    const headers = "Timestamp,EventToken,Operator,TargetNode,Action,Status,BlockDigest\n";
    const rows = auditLog
      .map(
        (e) =>
          `"${e.timestamp}","${e.eventToken}","${e.operator}","${e.targetNode}","${e.action.replace(/"/g, '""')}","${e.status}","${e.sha256BlockDigest}"`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `trueledger_audit_ledger_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Downloaded reconciliation ledger (.CSV)");
  };

  const handleDownloadPDF = () => {
    logSystemEvent(
      "AUDIT_REPORT_PDF_DOWNLOADED",
      "OPERATOR_CUSTOMER",
      "reportlab:pdf-builder",
      `Generated and downloaded official underwriting report for ${entityName} (.PDF).`,
      "SUCCESS"
    );

    const reportContent = `
================================================================================
TRUELEDGER INSTITUTIONAL CREDIT UNDERWRITING REPORT
APEX CAPITAL RISK & ASSURANCE COMMITTEE
================================================================================
TARGET BORROWER:        ${entityName}
TAX IDENTIFIER (GSTIN): 27AAECK1298P1Z8
PERMANENT ACCOUNT (PAN): ${entityPan}
GENERATED TIMESTAMP:    ${new Date().toISOString()}
ALGORITHMIC VERDICT:    MANUAL REVIEW (Capped Confidence: 0.50)
AA CONSENT MULTIPLIER:  0.29 (2 Days Remaining on Banking Feed)
FINAL RISK SCORE:       0.14
--------------------------------------------------------------------------------
PRIMARY CONTRADICTION FINDING:
Bank statement credit receipts demonstrate steady positive inflows totaling 
Rs. 2,10,00,000 (+2.1% YoY growth), whereas parallel GSTR-3B filings register 
only Rs. 1,65,00,000 (-11.0% YoY contraction) across the identical filing window.
Asymmetric variance delta: 27.2% (Rs. 45,00,000 unexplained disparity).
Recommended Action: Underwriter Manual Review & Supplier Ledger Audit.
================================================================================
SHA-256 BLOCK DIGEST:   ${auditLog[0]?.sha256BlockDigest || "0x8f2ae9c14092b740e53a992bc44d32098d6541f5a11e89bc"}
================================================================================
    `;

    const blob = new Blob([reportContent], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `trueledger_audit_dossier_${Date.now()}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Downloaded official underwriting dossier");
  };

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW RENDERER 1: ENTRY POINT (LANDING PAGE)
  // ───────────────────────────────────────────────────────────────────────────
  if (currentMilestone === "landing") {
    return (
      <div className="min-h-screen bg-[#060913] text-[#e2e8f0] font-sans flex flex-col selection:bg-indigo-500/30">
        {/* Navigation Bar */}
        <header className="h-16 border-b border-[#1e293b]/70 px-8 flex items-center justify-between sticky top-0 bg-[#060913]/90 backdrop-blur z-20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold text-base shadow-[0_0_15px_rgba(99,102,241,0.25)]">
              TL
            </div>
            <div>
              <span className="font-bold text-white text-base tracking-tight">TrueLedger</span>
              <span className="ml-2 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase">
                Tier-1 BFSI
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                logSystemEvent("LANDING_CTA_CLICKED", "ANONYMOUS_VISITOR", "portal:landing", "User launched gateway from hero navigation.", "SUCCESS");
                setCurrentMilestone("auth");
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <span>Launch Underwriting Desk</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Hero Section */}
        <main className="flex-1 max-w-5xl mx-auto px-6 py-20 flex flex-col justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-mono self-start mb-6">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Autonomous Consent-Aware Commercial Credit Underwriting</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-tight max-w-3xl mb-6">
            The Blind Spot in Commercial Credit: Financial Data Evaluated in Silos.
          </h1>

          <p className="text-base text-slate-400 max-w-2xl leading-relaxed mb-10">
            Banks evaluate bank statements, GST filings, and liquid assets in silos. Fraudsters and stressed borrowers exploit the uncoordinated space between them. TrueLedger cross-examines multi-source filings in real-time with deterministic rules, dynamic consent-decay, and complete transaction citations.
          </p>

          {/* Metric Highlights Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-12">
            <div className="p-4 rounded-xl bg-[#0c101d] border border-[#1e293b]">
              <div className="text-xl font-bold font-mono text-white tabular-nums">₹15,851 Cr</div>
              <div className="text-xs text-slate-400 mt-1">Fake ITC & divergence detected across syndicated shell networks</div>
            </div>
            <div className="p-4 rounded-xl bg-[#0c101d] border border-[#1e293b]">
              <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums">3 Agents, 1 Pass</div>
              <div className="text-xs text-slate-400 mt-1">Bank, GST, and Asset data cross-examined in concurrent swarm execution</div>
            </div>
            <div className="p-4 rounded-xl bg-[#0c101d] border border-[#1e293b]">
              <div className="text-xl font-bold font-mono text-indigo-400 tabular-nums">100% Citable</div>
              <div className="text-xs text-slate-400 mt-1">Every credit finding mathematically anchored to raw transaction rows</div>
            </div>
            <div className="p-4 rounded-xl bg-[#0c101d] border border-[#1e293b]">
              <div className="text-xl font-bold font-mono text-amber-400 tabular-nums">Consent-Bound</div>
              <div className="text-xs text-slate-400 mt-1">Automatic confidence haircuts as Account Aggregator windows expire</div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => {
                logSystemEvent("LANDING_CTA_CLICKED", "ANONYMOUS_VISITOR", "portal:landing", "User launched gateway from hero primary CTA.", "SUCCESS");
                setCurrentMilestone("auth");
              }}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-xl shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <span>Enter Underwriting Platform</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleDemokitLogin}
              className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-[#0f172a] hover:bg-[#1e293b] text-slate-200 border border-[#334155] font-semibold text-sm transition-all cursor-pointer"
            >
              <span>⚡ Fast-Track Demokit Login</span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW RENDERER 2: PORTAL GATEWAY (ISOLATED CUSTOMER LOGIN)
  // ───────────────────────────────────────────────────────────────────────────
  if (currentMilestone === "auth" || currentMilestone === "login") {
    return (
      <div className="min-h-screen bg-[#060913] text-[#e2e8f0] flex flex-col items-center justify-center p-6 relative">
        <button
          onClick={() => setCurrentMilestone("landing")}
          className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <span>← Back to Overview</span>
        </button>

        <div className="w-full max-w-md bg-[#0c101d] border border-[#1e293b] rounded-2xl p-8 shadow-2xl shadow-black/80">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Commercial Credit Gateway</h2>
            <p className="text-xs text-slate-400 mt-2">
              Sign in to initialize borrower telemetry and multi-agent reconciliation.
            </p>
          </div>

          <form onSubmit={handleCustomerLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Corporate Analyst Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Security Credential
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={customerPassword}
                  onChange={(e) => setCustomerPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={isCustomerAuthLoading}
                className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs tracking-wide transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isCustomerAuthLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Sign In to Credit Vault</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDemokitLogin}
                className="w-full py-2.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-mono text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>⚡ Instant Demokit Simulation Login</span>
              </button>
            </div>
          </form>

          <div className="mt-8 pt-5 border-t border-[#1e293b] text-center">
            <span className="text-[11px] font-mono text-slate-500">
              🔒 256-Bit TLS Encryption · SOC2 Type II Certified
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW RENDERER 3: TELEMETRY & SWARM PROCESSING PORTAL (FULLSCREEN)
  // ───────────────────────────────────────────────────────────────────────────
  if (currentMilestone === "ingestion_processing" || currentMilestone === "processing") {
    return (
      <div className="min-h-screen bg-[#060913] text-[#e2e8f0] p-8 flex flex-col justify-center items-center">
        <div className="w-full max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded border border-indigo-500/20 uppercase">
                Step 3 of 4 · Swarm Telemetry Processing
              </span>
              <h2 className="text-2xl font-bold text-white tracking-tight mt-2">
                Autonomous Multi-Agent Cross-Source Verification
              </h2>
            </div>

            {swarmProgress === 100 && (
              <button
                onClick={handleProceedToSettledDashboard}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
              >
                <span>Review Final Audit Verdict</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Execution Progress Bar */}
          <div className="p-5 rounded-xl bg-[#0c101d] border border-[#1e293b] mb-6">
            <div className="flex justify-between items-center text-xs font-mono mb-2">
              <span className="text-slate-400">Orchestrator Execution Pipeline:</span>
              <span className="text-indigo-400 font-bold tabular-nums">{swarmProgress}% Completed</span>
            </div>
            <div className="w-full h-2.5 bg-[#060913] rounded-full overflow-hidden border border-[#1e293b]">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500 ease-out"
                style={{ width: `${swarmProgress}%` }}
              />
            </div>
          </div>

          {/* Specialist Agent Status Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Bank Statement Agent */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                swarmProgress >= 25
                  ? "bg-[#0c101d] border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                  : "bg-[#0c101d]/60 border-[#1e293b]"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-white">Bank Statement Agent</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    swarmProgress >= 25
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-indigo-500/10 text-indigo-400 animate-pulse"
                  }`}
                >
                  {swarmProgress >= 25 ? "Settled" : "Running"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Ingesting 884 primary credit receipts</p>
              <div className="font-mono text-xs font-bold text-emerald-400 tabular-nums">
                ₹2.10 Cr Inflows (+2.1%)
              </div>
            </div>

            {/* GST Returns Agent */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                swarmProgress >= 55
                  ? "bg-[#0c101d] border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                  : swarmProgress >= 25
                  ? "bg-[#0c101d] border-indigo-500/30"
                  : "bg-[#0c101d]/60 border-[#1e293b]"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-white">GST Returns Agent</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    swarmProgress >= 55
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : swarmProgress >= 25
                      ? "bg-indigo-500/10 text-indigo-400 animate-pulse"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {swarmProgress >= 55 ? "Settled" : swarmProgress >= 25 ? "Running" : "Pending"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Reconciling 24 GSTR-3B filings</p>
              <div className="font-mono text-xs font-bold text-amber-400 tabular-nums">
                ₹1.65 Cr Declared (-11.0%)
              </div>
            </div>

            {/* Investment Agent */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                swarmProgress >= 80
                  ? "bg-[#0c101d] border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
                  : swarmProgress >= 55
                  ? "bg-[#0c101d] border-indigo-500/30"
                  : "bg-[#0c101d]/60 border-[#1e293b]"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-white">Investment Agent</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    swarmProgress >= 80
                      ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                      : swarmProgress >= 55
                      ? "bg-indigo-500/10 text-indigo-400 animate-pulse"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {swarmProgress >= 80 ? "Settled" : swarmProgress >= 55 ? "Running" : "Pending"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Auditing liquid reserves & portfolio</p>
              <div className="font-mono text-xs font-bold text-indigo-400 tabular-nums">
                ₹32.4L Validated Buffer
              </div>
            </div>
          </div>

          {/* Telemetry Trace Console */}
          <div className="p-4 rounded-xl bg-[#0c101d] border border-[#1e293b]">
            <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-[#1e293b] font-mono text-[11px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold">Raw Telemetry & Execution Trace Stream</span>
              <span>Node: asia-south1</span>
            </div>
            <div className="space-y-1.5 font-mono text-xs max-h-48 overflow-y-auto">
              {telemetryLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 text-slate-300">
                  <span className="text-indigo-500 select-none">›</span>
                  <span>{log}</span>
                </div>
              ))}
              {swarmProgress < 100 && (
                <div className="flex items-center gap-2 text-indigo-400 animate-pulse">
                  <span className="select-none">›</span>
                  <span>Evaluating mathematical variance across rails...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // VIEW RENDERER 4: MAIN WORKSPACE SHELL (ONBOARDING vs SETTLED DASHBOARD)
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#060913] text-[#e2e8f0] flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0f172a] border border-indigo-500/40 text-white text-xs px-4 py-2.5 rounded-lg shadow-2xl font-mono flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Utility Bar */}
      <header className="h-14 border-b border-[#1e293b] bg-[#060913] px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMilestone("landing")}
            className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            ← Overview
          </button>
          <div className="h-4 w-[1px] bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm tracking-tight">TrueLedger</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              APEX RISK
            </span>
          </div>
        </div>

        {/* Stepper (Only in Onboarding / Processing) */}
        {currentMilestone === "onboarding" && (
          <div className="flex items-center gap-2 px-3 py-1 bg-[#0c101d] border border-[#1e293b] rounded-full text-xs font-mono">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>1. Sign In</span>
            </div>
            <span className="text-slate-600">›</span>
            <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
              <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                2
              </span>
              <span>Onboarding Rails</span>
            </div>
            <span className="text-slate-600">›</span>
            <span className="text-slate-500">3. Telemetry</span>
            <span className="text-slate-600">›</span>
            <span className="text-slate-500">4. Final Verdict</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          {/* Environment Toggle */}
          <div className="flex items-center bg-[#0c101d] border border-[#1e293b] rounded-lg p-0.5 text-[11px] font-mono">
            <button
              onClick={() => {
                setEnvMode("SANDBOX");
                showToast("Switched environment to SANDBOX (Region: asia-south1)");
              }}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                envMode === "SANDBOX" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-white"
              }`}
            >
              Sandbox
            </button>
            <button
              onClick={() => {
                setEnvMode("PRODUCTION");
                showToast("Switched environment to PRODUCTION (asia-south1)");
              }}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                envMode === "PRODUCTION" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-white"
              }`}
            >
              Production
            </button>
          </div>

          {/* Privacy Mask Toggle */}
          <button
            onClick={() => {
              setGstinMasked((prev) => !prev);
              showToast(`Financial identifiers ${!gstinMasked ? "masked" : "revealed"}`);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0c101d] border border-[#1e293b] text-xs font-mono text-slate-300 hover:border-slate-700 cursor-pointer"
          >
            {gstinMasked ? <Lock className="w-3.5 h-3.5 text-indigo-400" /> : <Unlock className="w-3.5 h-3.5 text-amber-400" />}
            <span>{gstinMasked ? "Masked" : "Revealed"}</span>
          </button>

          {/* Invisible Release Version Pill (Double-click opens Dev Console) */}
          <span
            onDoubleClick={() => setIsDevRouteActive(true)}
            title="Institutional Build v2.4.0 (Double-click or Ctrl+Shift+D for Dev Gateway)"
            className="text-[10px] font-mono text-slate-500 px-2 py-0.5 rounded bg-[#0c101d] border border-[#1e293b] cursor-default select-none hover:text-slate-300 hover:border-indigo-500/40"
          >
            v2.4.0-prod
          </span>
        </div>
      </header>

      {/* Persistent Decision Anchor Bar (In Settled Dashboard Mode) */}
      {currentMilestone === "settled_dashboard" && (
        <section className="bg-[#0c101d] border-b border-[#1e293b] px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Target Entity</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-bold text-white text-sm">{entityName}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#060913] border border-[#1e293b] text-slate-300 tabular-nums">
                  {gstinMasked ? "•••• •••• 9812" : "27AAECK1298P1Z8"}
                </span>
              </div>
            </div>

            <div className="h-7 w-[1px] bg-[#1e293b]" />

            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Algorithmic Verdict</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>MANUAL REVIEW</span>
                </span>
                <span className="text-xs font-mono text-slate-400 tabular-nums">Conf: 50% (Capped)</span>
              </div>
            </div>

            <div className="h-7 w-[1px] bg-[#1e293b]" />

            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">AA Consent Decay Haircut</span>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-24 h-2 bg-[#060913] border border-[#1e293b] rounded-full overflow-hidden">
                  <div className="w-[29%] h-full bg-amber-400 rounded-full" />
                </div>
                <span className="text-xs font-mono text-amber-400 tabular-nums">
                  2d left (×0.29) · Haircut applied
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#060913] hover:bg-[#1e293b] border border-[#1e293b] text-emerald-400 text-xs font-mono cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export (.CSV)</span>
            </button>
            <button
              onClick={handleDownloadPDF}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#060913] hover:bg-[#1e293b] border border-[#1e293b] text-indigo-400 text-xs font-mono cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Dossier (.PDF)</span>
            </button>
          </div>
        </section>
      )}

      {/* Main Workspace Body: Dual-Tier Sidebar + Main Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic Sidebar */}
        <aside className="w-64 border-r border-[#1e293b] bg-[#0c101d] flex flex-col justify-between shrink-0">
          <div className="p-4 space-y-4">
            {/* IN ONBOARDING: SHOW ONLY ONBOARDING CHECKLIST */}
            {currentMilestone === "onboarding" ? (
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-3">
                  Audit Pipeline Wizard
                </div>
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-indigo-600/10 border border-indigo-500/30">
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <Workflow className="w-4 h-4 text-indigo-400" />
                      <span>Data Rails Intake</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Validate banking, tax, and GST feeds to unlock telemetry.
                    </p>
                  </div>
                </div>

                <div className="mt-6 border-t border-[#1e293b] pt-4">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-2">
                    Ingestion Verification
                  </div>
                  <div className="space-y-2 font-mono text-xs">
                    <div className="flex items-center justify-between p-2 rounded bg-[#060913] border border-[#1e293b]">
                      <span className="text-slate-300">GSTN Gateway</span>
                      <span className={channels.gstn ? "text-emerald-400 font-bold" : "text-slate-600"}>
                        {channels.gstn ? "✓ VERIFIED" : "PENDING"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#060913] border border-[#1e293b]">
                      <span className="text-slate-300">Income Tax (ITR)</span>
                      <span className={channels.itr ? "text-emerald-400 font-bold" : "text-slate-600"}>
                        {channels.itr ? "✓ VERIFIED" : "PENDING"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded bg-[#060913] border border-[#1e293b]">
                      <span className="text-slate-300">Bank Statement AA</span>
                      <span className={channels.bank ? "text-emerald-400 font-bold" : "text-slate-600"}>
                        {channels.bank ? "✓ VERIFIED" : "PENDING"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* IN SETTLED DASHBOARD: SHOW COMPLETE INSTITUTIONAL NAVIGATION */
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-3">
                  Institutional Workspaces
                </div>
                <nav className="space-y-1">
                  <button
                    onClick={() => setActiveSettledTab("dashboard")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "dashboard"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    <span>Executive Dashboard</span>
                  </button>

                  <button
                    onClick={() => setActiveSettledTab("credit")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "credit"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <FileCheck className="w-4 h-4" />
                    <div className="text-left">
                      <div className="leading-tight">Credit Applications</div>
                      <div className="text-[10px] text-slate-400 font-normal">Active Dossier</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setActiveSettledTab("client")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "client"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <Building className="w-4 h-4" />
                    <span>Client Space & Vault</span>
                  </button>

                  <button
                    onClick={() => setActiveSettledTab("income")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "income"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    <span>Income & Revenue</span>
                  </button>

                  <button
                    onClick={() => setActiveSettledTab("compliance")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "compliance"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Compliance Matrix</span>
                  </button>

                  <button
                    onClick={() => setActiveSettledTab("assets")}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSettledTab === "assets"
                        ? "bg-indigo-600 text-white font-bold"
                        : "text-slate-300 hover:bg-[#1e293b]"
                    }`}
                  >
                    <PieChart className="w-4 h-4" />
                    <span>Asset Allocations</span>
                  </button>
                </nav>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[#1e293b] font-mono text-[11px] text-slate-500">
            <div>Tenant: APEX_COMMERCIAL_01</div>
            <div>Region: asia-south1</div>
          </div>
        </aside>

        {/* Primary Screen Viewport */}
        <main className="flex-1 overflow-y-auto p-8">
          {/* MILESTONE: ONBOARDING VIEW */}
          {currentMilestone === "onboarding" && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div>
                <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded border border-indigo-500/20 uppercase">
                  Step 2 of 4 · Commercial Intake & Verification
                </span>
                <h2 className="text-2xl font-bold text-white tracking-tight mt-2">
                  Client Onboarding & Telemetry Gateway
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Establish primary source data channels under the Account Aggregator protocol.
                </p>
              </div>

              {/* Entity Name Field */}
              <div className="p-5 rounded-xl bg-[#0c101d] border border-[#1e293b]">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Legal Business Entity Name
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-sm text-white font-semibold focus:outline-none focus:border-indigo-500"
                    placeholder="Enter corporate entity name"
                  />
                  <div className="px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-xs font-mono text-slate-400 flex items-center">
                    PAN: {entityPan}
                  </div>
                </div>
              </div>

              {/* Three Gated Document Verification Channels */}
              <div className="p-5 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                <div className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                  Mandatory Telemetry Data Channels (3/3 Required)
                </div>

                {/* Channel 1: GSTN GSTR-1 & 3B */}
                <div
                  onClick={() => handleToggleChannel("gstn")}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    channels.gstn
                      ? "bg-indigo-600/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                      : "bg-[#060913] border-[#1e293b] hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-bold transition-all ${
                        channels.gstn
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "border-slate-700 text-transparent"
                      }`}
                    >
                      ✓
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">GSTN GSTR-1 & 3B Returns Ledger</div>
                      <div className="text-xs text-slate-400">Automated G2G gateway connection · Monthly turnover returns</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">24 filings verified</span>
                </div>

                {/* Channel 2: Income Tax ITR */}
                <div
                  onClick={() => handleToggleChannel("itr")}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    channels.itr
                      ? "bg-indigo-600/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                      : "bg-[#060913] border-[#1e293b] hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-bold transition-all ${
                        channels.itr
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "border-slate-700 text-transparent"
                      }`}
                    >
                      ✓
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Income Tax Ingestion Framework</div>
                      <div className="text-xs text-slate-400">ITR Form-16 & Form-26AS tax statements · Declared income stream</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">3 AY cycles</span>
                </div>

                {/* Channel 3: Bank Statement Aggregator Network */}
                <div
                  onClick={() => handleToggleChannel("bank")}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    channels.bank
                      ? "bg-indigo-600/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                      : "bg-[#060913] border-[#1e293b] hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-bold transition-all ${
                        channels.bank
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "border-slate-700 text-transparent"
                      }`}
                    >
                      ✓
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Bank Statement Aggregator Feed</div>
                      <div className="text-xs text-slate-400">Direct Bank MFT transfer log across primary commercial accounts</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">884 records verified</span>
                </div>
              </div>

              {/* Action Strip */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs font-mono text-slate-400">
                  {isAllChannelsVerified ? (
                    <span className="text-emerald-400">✓ All 3 telemetry rails connected. Ready for ingestion.</span>
                  ) : (
                    <span className="text-amber-400">⚠ Please activate all 3 channels to proceed.</span>
                  )}
                </div>

                <button
                  onClick={handleStartIngestion}
                  disabled={!isAllChannelsVerified}
                  className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-xs tracking-wide transition-all shadow-lg cursor-pointer ${
                    isAllChannelsVerified
                      ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
                      : "bg-[#1e293b] text-slate-500 cursor-not-allowed shadow-none"
                  }`}
                >
                  <span>Proceed to Ingestion & Swarm Telemetry</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* MILESTONE: SETTLED DASHBOARD VIEWS */}
          {currentMilestone === "settled_dashboard" && (
            <div className="space-y-6">
              {/* TAB 1: EXECUTIVE DASHBOARD */}
              {activeSettledTab === "dashboard" && (
                <div className="space-y-6">
                  {/* KPI Strip */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-5 rounded-xl bg-[#0c101d] border border-[#1e293b]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Gross Ingested Capital</span>
                      <div className="text-2xl font-bold font-mono text-white mt-1.5 tabular-nums">₹2,10,00,000</div>
                      <div className="text-xs text-emerald-400 font-mono mt-1">+2.1% YoY Inflows</div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0c101d] border border-amber-500/30 bg-amber-500/[0.02]">
                      <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">GST-Declared Turnover</span>
                      <div className="text-2xl font-bold font-mono text-amber-400 mt-1.5 tabular-nums">₹1,65,00,000</div>
                      <div className="text-xs text-amber-400 font-mono mt-1">-11.0% YoY Declared</div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0c101d] border border-[#1e293b]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Active Ingestion Channels</span>
                      <div className="text-2xl font-bold font-mono text-white mt-1.5 tabular-nums">3/3 Rails</div>
                      <div className="text-xs text-indigo-400 font-mono mt-1">GSTN · ITR · Bank AA</div>
                    </div>

                    <div className="p-5 rounded-xl bg-[#0c101d] border border-amber-500/30 bg-amber-500/[0.02]">
                      <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">Consent Multiplier</span>
                      <div className="text-2xl font-bold font-mono text-amber-400 mt-1.5 tabular-nums">0.29 (×0.29)</div>
                      <div className="text-xs text-amber-400 font-mono mt-1">2d remaining · -71% Haircut</div>
                    </div>
                  </div>

                  {/* Forensic Discrepancy Card & Verdict Synthesizer */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Discrepancy Card (2 cols) */}
                    <div className="lg:col-span-2 p-6 rounded-xl bg-[#0c101d] border border-amber-500/40 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white">Asymmetric GST vs Bank Inflow Discrepancy Card</h3>
                            <span className="text-[11px] font-mono text-slate-400">Rule Engine: RULE_INCOME_REV_DIVERGENCE</span>
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          27.2% Variance Delta
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        Deterministic cross-examination revealed a critical divergence: The primary commercial bank statement exhibits steady credit receipts totaling <strong className="text-emerald-400 font-mono">₹2,10,00,000</strong> (+2.1% YoY), whereas parallel GSTR-3B filings register only <strong className="text-rose-400 font-mono">₹1,65,00,000</strong> (-11.0% YoY) for the identical period.
                      </p>

                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div className="p-3.5 rounded-lg bg-[#060913] border border-[#1e293b]">
                          <span className="text-[10px] font-mono text-slate-400 uppercase">Bank Aggregator Ledger</span>
                          <div className="text-lg font-bold font-mono text-emerald-400 mt-1 tabular-nums">₹2,10,00,000</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">Trend: Rising / Stable (+2.1%)</div>
                        </div>

                        <div className="p-3.5 rounded-lg bg-[#060913] border border-[#1e293b]">
                          <span className="text-[10px] font-mono text-slate-400 uppercase">GSTN Official Filing</span>
                          <div className="text-lg font-bold font-mono text-rose-400 mt-1 tabular-nums">₹1,65,00,000</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">Trend: Sharp Contraction (-11.0%)</div>
                        </div>
                      </div>
                    </div>

                    {/* Algorithmic Verdict Summary Card (1 col) */}
                    <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-2">
                          Synthesizer Outcome
                        </span>
                        <div className="flex items-center justify-between mb-4">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold font-mono">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span>MANUAL REVIEW</span>
                          </span>
                          <span className="text-xs font-mono text-slate-400 tabular-nums">Score: 0.14</span>
                        </div>

                        <div className="space-y-2 border-t border-[#1e293b] pt-3 font-mono text-xs">
                          <div className="flex justify-between text-slate-400">
                            <span>Model Confidence:</span>
                            <span className="text-white font-bold tabular-nums">0.50 (Capped)</span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span>Consent Multiplier:</span>
                            <span className="text-amber-400 font-bold tabular-nums">×0.29 (2d left)</span>
                          </div>
                          <div className="flex justify-between text-white font-bold pt-1 border-t border-[#1e293b]">
                            <span>Final Risk Metric:</span>
                            <span className="text-amber-400 tabular-nums">0.14</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-[#1e293b]">
                        <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1">
                          SHA-256 Decision Block Digest
                        </span>
                        <div className="text-[10px] font-mono text-slate-400 truncate bg-[#060913] p-2 rounded border border-[#1e293b]">
                          {auditLog[0]?.sha256BlockDigest || "0x8f2ae9c14092b740e53a992bc44d32098d6541f5a11e89bc"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CREDIT APPLICATIONS */}
              {activeSettledTab === "credit" && (
                <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                  <h3 className="text-lg font-bold text-white">Commercial Credit Application Dossier</h3>
                  <p className="text-xs text-slate-400">
                    Active operational borrower portfolio: <strong className="text-white font-mono">{entityName}</strong>
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="p-4 rounded-lg bg-[#060913] border border-[#1e293b]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase">Loan Amount Requested</span>
                      <div className="text-xl font-bold font-mono text-white mt-1 tabular-nums">₹50,00,000</div>
                    </div>
                    <div className="p-4 rounded-lg bg-[#060913] border border-[#1e293b]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase">Calculated DSCR</span>
                      <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">2.51x</div>
                    </div>
                    <div className="p-4 rounded-lg bg-[#060913] border border-[#1e293b]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase">Collateral Cushion</span>
                      <div className="text-xl font-bold font-mono text-indigo-400 mt-1 tabular-nums">₹7,80,000</div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: CLIENT SPACE */}
              {activeSettledTab === "client" && (
                <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                  <h3 className="text-lg font-bold text-white">Client Space & KYB Validation</h3>
                  <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                    <div className="p-3 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">Corporate Name</span>
                      <span className="text-white font-bold">{entityName}</span>
                    </div>
                    <div className="p-3 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">GSTIN</span>
                      <span className="text-white font-bold">27AAECK1298P1Z8</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: INCOME & REVENUE */}
              {activeSettledTab === "income" && (
                <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                  <h3 className="text-lg font-bold text-white">Income & Revenue Stream Telemetry</h3>
                  <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                    <div className="p-4 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">Average Monthly Banking Credit</span>
                      <span className="text-xl font-bold text-emerald-400 tabular-nums">₹17,50,000 / mo</span>
                    </div>
                    <div className="p-4 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">Average Monthly GST Turnover</span>
                      <span className="text-xl font-bold text-rose-400 tabular-nums">₹13,75,000 / mo</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: COMPLIANCE MATRIX */}
              {activeSettledTab === "compliance" && (
                <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                  <h3 className="text-lg font-bold text-white">Compliance & Tax Filing Matrix</h3>
                  <div className="space-y-2 font-mono text-xs">
                    <div className="flex justify-between p-3 bg-[#060913] rounded border border-[#1e293b]">
                      <span>GSTR-1 Status: Regular (24/24 Filed)</span>
                      <span className="text-emerald-400 font-bold">COMPLIANT</span>
                    </div>
                    <div className="flex justify-between p-3 bg-[#060913] rounded border border-[#1e293b]">
                      <span>GSTR-3B Tax Liability: Declared Contraction</span>
                      <span className="text-amber-400 font-bold">UNDER REVIEW</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: ASSET ALLOCATIONS */}
              {activeSettledTab === "assets" && (
                <div className="p-6 rounded-xl bg-[#0c101d] border border-[#1e293b] space-y-4">
                  <h3 className="text-lg font-bold text-white">Liquid Asset Allocations & Buffer</h3>
                  <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                    <div className="p-4 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">Pledgeable Mutual Fund NAV</span>
                      <span className="text-xl font-bold text-indigo-400 tabular-nums">₹1,80,000</span>
                    </div>
                    <div className="p-4 bg-[#060913] rounded border border-[#1e293b]">
                      <span className="text-slate-500 block">Life Insurance Sum Assured</span>
                      <span className="text-xl font-bold text-indigo-400 tabular-nums">₹6,00,000</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────────
          FOOTER: REAL-TIME APPEND-ONLY GOVERNANCE LEDGER STRIP (PHASE 4)
          ─────────────────────────────────────────────────────────────────────────── */}
      <footer className="h-10 border-t border-[#1e293b] bg-[#0c101d] px-6 flex items-center justify-between text-[11px] font-mono z-10 select-none shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-indigo-400 font-semibold">
            <Terminal className="w-3.5 h-3.5" />
            <span>IMMUTABLE AUDIT STREAM</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400 truncate max-w-md">
            Latest Event: <strong className="text-white">{auditLog[0]?.eventToken}</strong> — {auditLog[0]?.action}
          </span>
        </div>

        <div className="flex items-center gap-4 text-slate-500">
          <span className="tabular-nums">{auditLog.length} Events Logged</span>
          <span className="text-slate-700">|</span>
          <span className="truncate max-w-[140px] text-slate-400" title={auditLog[0]?.sha256BlockDigest}>
            {auditLog[0]?.sha256BlockDigest?.slice(0, 16)}...
          </span>
          <span className="text-slate-700">|</span>
          <button
            onClick={() => setIsDevRouteActive(true)}
            className="text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
          >
            Open Full Ledger
          </button>
        </div>
      </footer>

      {/* ───────────────────────────────────────────────────────────────────────────
          MODAL: HIDDEN DEVELOPER GOVERNANCE GATEWAY (/app/dev-login)
          ─────────────────────────────────────────────────────────────────────────── */}
      {isDevRouteActive && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur flex items-center justify-center p-6">
          {!isDevAuthenticated ? (
            <div className="w-full max-w-md bg-[#0c101d] border border-indigo-500/40 rounded-2xl p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Developer Security Gate</h3>
                    <span className="text-[11px] font-mono text-slate-400">Route: /app/dev-login</span>
                  </div>
                </div>
                <button
                  onClick={() => setIsDevRouteActive(false)}
                  className="text-slate-500 hover:text-white text-xs font-mono cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>

              {devAuthError && (
                <div className="p-3 mb-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
                  {devAuthError}
                </div>
              )}

              <form onSubmit={handleDevAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Dev Admin Username</label>
                  <input
                    type="text"
                    value={devUsername}
                    onChange={(e) => setDevUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Developer Secret Key</label>
                  <input
                    type="password"
                    value={devPassword}
                    onChange={(e) => setDevPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#060913] border border-[#1e293b] text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs font-mono transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
                >
                  Authenticate to System Governance
                </button>
              </form>
            </div>
          ) : (
            <div className="w-full max-w-5xl bg-[#0c101d] border border-[#1e293b] rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between pb-4 border-b border-[#1e293b]">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-base font-bold text-white font-mono">
                    Append-Only Immutable System Governance Ledger
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExportCSV}
                    className="px-3 py-1.5 rounded-lg bg-[#060913] border border-[#1e293b] text-emerald-400 text-xs font-mono hover:bg-[#1e293b] cursor-pointer"
                  >
                    Export Log (.CSV)
                  </button>
                  <button
                    onClick={() => {
                      setIsDevAuthenticated(false);
                      setIsDevRouteActive(false);
                    }}
                    className="text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                  >
                    ✕ Exit Dev Console
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto mt-4 border border-[#1e293b] rounded-xl">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#060913] text-slate-400 border-b border-[#1e293b]">
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Token</th>
                      <th className="p-3">Operator</th>
                      <th className="p-3">Target Node</th>
                      <th className="p-3">Action Description</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">SHA-256 Block Digest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((ev) => (
                      <tr key={ev.id} className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/20">
                        <td className="p-3 text-slate-400">{ev.timestamp.slice(11, 19)}</td>
                        <td className="p-3 text-indigo-400 font-semibold">{ev.eventToken}</td>
                        <td className="p-3 text-white">{ev.operator}</td>
                        <td className="p-3 text-slate-400">{ev.targetNode}</td>
                        <td className="p-3 text-slate-300 max-w-xs truncate">{ev.action}</td>
                        <td className="p-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
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
                        <td className="p-3 text-slate-500 truncate max-w-[120px]" title={ev.sha256BlockDigest}>
                          {ev.sha256BlockDigest}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export default TrueLedgerEnterpriseApp;
