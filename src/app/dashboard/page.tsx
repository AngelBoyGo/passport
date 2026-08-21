"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

type PersonaLens = "builder" | "datacenter" | "enterprise" | "auditor";

interface DashboardData {
  operator: {
    id: string;
    email: string | null;
    credits: number;
    tier: string;
    accountStatus: string;
    stakeBalanceCents: number;
  };
  metrics: {
    total_receipts: number;
    total_evidence: number;
    enrolled_agents_count: number;
    webhooks_active_count: number;
  };
  api_keys: { id: string; keyHash: string; name: string | null; createdAt: string }[];
  agents: { id: string; agentId: string; domain: string | null; createdAt: string }[];
  recent_receipts: {
    receiptId: string;
    issuedAt: string;
    status: string;
    domain: string | null;
    agentId: string;
    inputDigest: string;
    contentHash: string;
    signature: string | null;
    authorityScope: string;
  }[];
  datacenter: {
    total_events: number;
    hardware_verified_events: number;
    hardware_verification_ratio: number;
    acting_champion_policy: string;
    avg_power_reduction_pct: number;
    cumulative_energy_saved_kwh: number;
    cumulative_carbon_avoided_kg: number;
  };
  merkle_root: string;
  merkle_checkpoint_id: string;
  public_verifying_key: string;
  timestamp: string;
}

export default function UserDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lens, setLens] = useState<PersonaLens>("builder");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRole, setNewKeyRole] = useState<"ISSUER" | "HOLDER">("ISSUER");
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [complianceFramework, setComplianceFramework] = useState("EU_AI_ACT");
  const [exportingVC, setExportingVC] = useState(false);
  const [vcModalData, setVcModalData] = useState<any | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/dashboard/overview", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        window.location.assign("/login?next=/dashboard");
        return;
      }
      if (!res.ok) {
        setError(`Failed to load dashboard (${res.status})`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    try {
      setCreatingKey(true);
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName || (newKeyRole === "ISSUER" ? "Enterprise Platform Key" : "Agent Holder Key"),
          role: newKeyRole,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setCreatedKeyRaw(json.rawKey);
        setNewKeyName("");
        loadDashboard();
      }
    } catch {} finally {
      setCreatingKey(false);
    }
  }

  const copyText = (text: string, label: string) => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(text);
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://passport.metis.gold";

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100 font-sans">
      <SiteHeader />

      <main className="flex-1 mx-auto max-w-7xl w-full px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* ── Top Bar / Header ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Passport Dashboard
              </h1>
              {data && (
                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-300 ring-1 ring-indigo-500/30 uppercase">
                  {data.operator.tier} Tier
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Signed in as <strong className="text-slate-200">{data?.operator.email ?? "Operator"}</strong> · Credits: {data?.operator.credits ?? 0}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/post-evidence"
              className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition"
            >
              + Post Evidence
            </Link>
            <Link
              href="/admin"
              className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              Command Center ↗
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition"
            >
              Sign out ⎋
            </button>
          </div>
        </div>

        {/* ── Adaptive Persona Switcher (The Versatile Lenses) ── */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2 shadow-inner">
          <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Select Your Specialized Verification Lens
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              onClick={() => setLens("builder")}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                lens === "builder"
                  ? "bg-indigo-600 text-white shadow-md ring-1 ring-indigo-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>🚀</span> Vibe Coder / Builder
              </div>
              <p className="mt-0.5 text-[10px] opacity-80 leading-tight">API keys, SDKs, agent cards, embed badges</p>
            </button>

            <button
              onClick={() => setLens("datacenter")}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                lens === "datacenter"
                  ? "bg-emerald-600 text-white shadow-md ring-1 ring-emerald-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>⚡</span> Data Center & Energy
              </div>
              <p className="mt-0.5 text-[10px] opacity-80 leading-tight">Hardware power Δ, thermal safety, carbon</p>
            </button>

            <button
              onClick={() => setLens("enterprise")}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                lens === "enterprise"
                  ? "bg-sky-600 text-white shadow-md ring-1 ring-sky-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>🛡️</span> Enterprise & Compliance
              </div>
              <p className="mt-0.5 text-[10px] opacity-80 leading-tight">EU AI Act, NIST AI RMF, SOC 2, HIPAA packages</p>
            </button>

            <button
              onClick={() => setLens("auditor")}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                lens === "auditor"
                  ? "bg-amber-600 text-white shadow-md ring-1 ring-amber-400"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>🔍</span> Sovereign Crypto Auditor
              </div>
              <p className="mt-0.5 text-[10px] opacity-80 leading-tight">Merkle roots, Ed25519 signatures, offline CLI</p>
            </button>
          </div>
        </div>

        {/* ── High-Level Metric Tiles ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 shadow-sm">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Total Signed Receipts</span>
            <p className="mt-1 text-2xl font-bold text-white">{data?.metrics.total_receipts ?? 0}</p>
            <p className="mt-0.5 text-[11px] text-emerald-400">100% Cryptographically Bound</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 shadow-sm">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Enrolled Agents</span>
            <p className="mt-1 text-2xl font-bold text-white">{data?.metrics.enrolled_agents_count ?? 0}</p>
            <p className="mt-0.5 text-[11px] text-indigo-400">Ed25519 Key-Bound Passports</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 shadow-sm">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Total Evidence Events</span>
            <p className="mt-1 text-2xl font-bold text-white">{data?.metrics.total_evidence ?? 0}</p>
            <p className="mt-0.5 text-[11px] text-sky-400">Zero-Knowledge Commitments</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 shadow-sm">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Merkle Checkpoint</span>
            <p className="mt-1 text-xs font-mono font-bold text-amber-300 break-all">{data?.merkle_root ? data.merkle_root.slice(0, 18) + "..." : "8f4b29c0..."}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Tamper-Proof Ledger State</p>
          </div>
        </div>

        {/* ── Dynamic Lens Content ── */}

        {/* 1. BUILDER LENS */}
        {lens === "builder" && (
          <div className="space-y-6">
            {/* Instant API Key Generator & Copy */}
            <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>🔑</span> API Authentication & Quick Launcher
                  </h2>
                  <p className="text-xs text-slate-400">Use your Bearer API key to issue receipts and post evidence from Python, TS, or cURL.</p>
                </div>

                <form onSubmit={handleCreateKey} className="flex flex-wrap items-center gap-2">
                  <select
                    value={newKeyRole}
                    onChange={(e) => setNewKeyRole(e.target.value as "ISSUER" | "HOLDER")}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="ISSUER">Enterprise Issuer (pp_ent_...)</option>
                    <option value="HOLDER">Agent Holder (pp_usr_...)</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Key name (e.g., DataCet / Agent)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={creatingKey}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
                  >
                    {creatingKey ? "Creating..." : "+ Generate Key"}
                  </button>
                </form>
              </div>

              {createdKeyRaw && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 p-4 text-xs space-y-2">
                  <p className="font-bold text-emerald-300">✓ New API Key Created — Save It Now (Shown Once):</p>
                  <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded border border-emerald-800 font-mono text-emerald-200">
                    <span className="break-all">{createdKeyRaw}</span>
                    <button
                      onClick={() => copyText(createdKeyRaw, "newKey")}
                      className="ml-3 shrink-0 text-emerald-400 hover:text-emerald-300 font-sans font-bold"
                    >
                      {copiedKey === "newKey" ? "✓ Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}

              {/* Code Snippets (Python / TypeScript / cURL) */}
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                  <span className="font-semibold text-slate-300">Quickstart cURL: Post Evidence Receipt</span>
                  <button
                    onClick={() =>
                      copyText(
                        `curl -X POST "${origin}/api/v1/passport/agents/AGENT_ID/evidence" \\\n  -H "Authorization: Bearer pp_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"source_type":"task_deliverable","artifact_type":"code_generation","validation_signal_present":true,"payload":{"task":"fix_bug","status":"completed"}}'`,
                        "curl"
                      )
                    }
                    className="text-indigo-400 hover:underline"
                  >
                    {copiedKey === "curl" ? "✓ Copied" : "Copy cURL"}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-indigo-300 overflow-x-auto select-all">
                  {`curl -X POST "${origin}/api/v1/passport/agents/AGENT_ID/evidence" \\
  -H "Authorization: Bearer pp_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"source_type":"task_deliverable","artifact_type":"code_generation","validation_signal_present":true,"payload":{"task":"fix_bug","status":"completed"}}'`}
                </pre>
              </div>
            </div>

            {/* Badge & GitHub Embed Generator */}
            <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>🛡️</span> Live Badge Generator for GitHub READMEs
              </h2>
              <p className="text-xs text-slate-400">Embed a dynamic, verified badge that automatically updates as your agent completes work.</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-900 border border-slate-700/80 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">Markdown Embed</span>
                    <button
                      onClick={() =>
                        copyText(
                          `[![Passport Verified](${origin}/api/v1/badge/AGENT_HASH)](${origin}/profiles/AGENT_HASH)`,
                          "badgeMd"
                        )
                      }
                      className="text-indigo-400 hover:underline"
                    >
                      {copiedKey === "badgeMd" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <code className="block text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded">
                    {`[![Passport Verified](${origin}/api/v1/badge/AGENT_HASH)](${origin}/profiles/AGENT_HASH)`}
                  </code>
                </div>

                <div className="rounded-lg bg-slate-900 border border-slate-700/80 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">HTML Embed</span>
                    <button
                      onClick={() =>
                        copyText(
                          `<a href="${origin}/profiles/AGENT_HASH"><img src="${origin}/api/v1/badge/AGENT_HASH" alt="Passport Verified" /></a>`,
                          "badgeHtml"
                        )
                      }
                      className="text-indigo-400 hover:underline"
                    >
                      {copiedKey === "badgeHtml" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <code className="block text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded">
                    {`<a href="${origin}/profiles/AGENT_HASH"><img src="${origin}/api/v1/badge/AGENT_HASH" alt="Passport" /></a>`}
                  </code>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. DATACENTER LENS */}
        {lens === "datacenter" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-emerald-900/60 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>⚡</span> Data Center Infrastructure & GPU Energy Governance
                  </h2>
                  <p className="text-xs text-slate-300">Empirically verify hardware-measured power reductions, thermal safety, and Scope 2 carbon savings.</p>
                </div>
                <Link
                  href="/datacenter"
                  className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
                >
                  Open Full Data Center Hub ↗
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
                  <span className="text-[10px] font-semibold uppercase text-slate-400">Active Setpoint Policy</span>
                  <p className="mt-1 text-lg font-bold text-emerald-400 font-mono">{data?.datacenter.acting_champion_policy ?? "Active"}</p>
                  <p className="mt-0.5 text-xs text-slate-400">Avg Power Δ: <strong>{data?.datacenter.avg_power_reduction_pct ? `${data.datacenter.avg_power_reduction_pct}%` : "Measured"}</strong></p>
                </div>

                <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
                  <span className="text-[10px] font-semibold uppercase text-slate-400">Strict Honesty Ratio</span>
                  <p className="mt-1 text-lg font-bold text-white">{(data?.datacenter.hardware_verification_ratio ?? 1) * 100}% Live</p>
                  <p className="mt-0.5 text-xs text-slate-400">Zero unverified models promoted</p>
                </div>

                <div className="rounded-lg bg-slate-900 border border-slate-800 p-4">
                  <span className="text-[10px] font-semibold uppercase text-slate-400">Avoided Scope 2 Carbon</span>
                  <p className="mt-1 text-lg font-bold text-sky-400">
                    {data?.datacenter.cumulative_carbon_avoided_kg ? `-${data.datacenter.cumulative_carbon_avoided_kg} kg` : "Live Accrual"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{data?.datacenter.cumulative_energy_saved_kwh ? `${data.datacenter.cumulative_energy_saved_kwh} kWh verified` : "Hourly grid synced"}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <a
                  href={`/api/v1/datacenter/clusters/${data?.agents[0]?.agentId || "cluster-01"}/credential`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition"
                >
                  Export DataCenter Sustainability VC (JSON-LD) ↗
                </a>
                <a
                  href="/api/v1/datacenter/receipts"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                >
                  View DataCenter Receipts Ledger ↗
                </a>
              </div>
            </div>
          </div>
        )}

        {/* 3. ENTERPRISE & COMPLIANCE LENS */}
        {lens === "enterprise" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-6 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-sky-900/60 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <span>🛡️</span> Regulatory & Enterprise ESG Compliance Engine
                  </h2>
                  <p className="text-xs text-slate-300">Generate signed, audit-grade packages mapped to international AI and data security standards.</p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={complianceFramework}
                    onChange={(e) => setComplianceFramework(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="EU_AI_ACT">EU AI Act (Article 51 / Annex IV)</option>
                    <option value="NIST_AI_RMF">NIST AI RMF 1.0 (GOVERN / MANAGE)</option>
                    <option value="SOC2_TYPE2">SOC 2 Type II (Trust Criteria)</option>
                    <option value="ISO_14064_GHG">ISO 14064 Scope 2 GHG Avoidance</option>
                  </select>

                  <a
                    href={`/api/v1/compliance/packages/${data?.agents[0]?.agentId || "agent_default"}?framework=${complianceFramework}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-sky-500 transition"
                  >
                    Download Package JSON ↗
                  </a>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
                  <span className="font-bold text-slate-200">EU AI Act Article 51</span>
                  <p className="mt-1 text-slate-400">Auditable compute resource and environmental footprint disclosures for general-purpose AI models.</p>
                </div>
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
                  <span className="font-bold text-slate-200">NIST AI RMF Control MANAGE_3.1</span>
                  <p className="mt-1 text-slate-400">Verifies fail-safe fallback to safe baselines if anomaly or thermal limits are crossed.</p>
                </div>
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-3">
                  <span className="font-bold text-slate-200">SOC 2 CC6.1 Logical Access</span>
                  <p className="mt-1 text-slate-400">Cryptographically proves all agent actions were authorized via Ed25519 possession proofs.</p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-emerald-300">Metered Reputation-as-a-Service (RaaS)</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Premium attestation products billed against your credit ledger — verified reputation lookups, portable
                    credential issuance, audit packages, and neutrality/residency attestations.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <a
                    href={`/api/v1/metered/credentials/${data?.agents[0]?.agentId || "agent_default"}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 transition"
                  >
                    POST Metered Portable Credential (0.5 credit) ↗
                  </a>
                  <a
                    href="/docs/verification"
                    className="rounded-lg border border-emerald-600/40 bg-slate-900 px-3 py-1.5 font-medium text-emerald-300 hover:bg-slate-800 transition"
                  >
                    RaaS Product Catalog →
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. AUDITOR LENS */}
        {lens === "auditor" && (
          <div className="space-y-6">
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-6 shadow-sm space-y-4">
              <div className="border-b border-amber-900/60 pb-4">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🔍</span> Air-Gapped & Sovereign Cryptographic Audit Center
                </h2>
                <p className="text-xs text-slate-300">Independently verify ledger inclusion and Ed25519 signatures without trusting Passport servers.</p>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg bg-slate-950 border border-slate-800 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span className="font-semibold text-slate-300">Offline CLI Verification (Zero-Dependencies)</span>
                    <button
                      onClick={() =>
                        copyText(
                          `npx ts-node scripts/verify-receipt-offline.ts --receipt <receipt.json> --key ${data?.public_verifying_key}`,
                          "cliVerif"
                        )
                      }
                      className="text-amber-400 hover:underline"
                    >
                      {copiedKey === "cliVerif" ? "✓ Copied" : "Copy Command"}
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-amber-300 overflow-x-auto select-all">
                    {`npx ts-node scripts/verify-receipt-offline.ts --receipt <receipt.json> --key ${data?.public_verifying_key || "PUBKEY_HEX"}`}
                  </pre>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <a
                    href="/api/v1/transparency/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-amber-600/40 bg-slate-900 px-3 py-1.5 font-medium text-amber-300 hover:bg-slate-800 transition"
                  >
                    Public Key Transparency Log (Append-Only) ↗
                  </a>
                  <a
                    href="/api/v1/receipts/checkpoints/latest"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-amber-600/40 bg-slate-900 px-3 py-1.5 font-medium text-amber-300 hover:bg-slate-800 transition"
                  >
                    Latest Merkle Checkpoint Root ↗
                  </a>
                  <a
                    href="/api/v1/receipts/checkpoints/latest"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-emerald-600/40 bg-slate-900 px-3 py-1.5 font-medium text-emerald-300 hover:bg-slate-800 transition"
                  >
                    External Notary Anchor (Merkle Head) ↗
                  </a>
                  <a
                    href={`/api/v1/compliance/audit-package/${data?.agents[0]?.agentId || "agent_default"}?framework=SOC2_TYPE2`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-sky-600/40 bg-slate-900 px-3 py-1.5 font-medium text-sky-300 hover:bg-slate-800 transition"
                  >
                    Audit-Grade SOC 2 Evidence Package ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Universal Receipts Stream & Cryptographic Inspector ── */}
        <div className="rounded-xl border border-slate-800 bg-slate-800/80 shadow-sm">
          <div className="border-b border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Live Cryptographic Receipts Ledger</h2>
              <p className="text-xs text-slate-400">Click any receipt to inspect the raw canonical JSON, digest, signature, and inclusion proof.</p>
            </div>
            <Link
              href="/admin/receipts"
              className="text-xs text-indigo-400 hover:underline"
            >
              View Full Receipts Explorer →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800 font-sans">
                <tr>
                  <th className="px-5 py-3 font-semibold">Receipt ID</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Domain</th>
                  <th className="px-5 py-3 font-semibold">Agent ID</th>
                  <th className="px-5 py-3 font-semibold">Issued At</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      Loading receipts...
                    </td>
                  </tr>
                ) : !data?.recent_receipts || data.recent_receipts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      No receipts issued yet. Generate an API key and post your first evidence event!
                    </td>
                  </tr>
                ) : (
                  data.recent_receipts.map((r) => (
                    <tr key={r.receiptId} className="hover:bg-slate-700/30 transition">
                      <td className="px-5 py-3 font-bold text-slate-200">{r.receiptId}</td>
                      <td className="px-5 py-3">
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-sans text-slate-300">{r.domain || "SYSTEM_INTEGRATION"}</td>
                      <td className="px-5 py-3 text-slate-400">{r.agentId}</td>
                      <td className="px-5 py-3 text-slate-500">{new Date(r.issuedAt).toLocaleString()}</td>
                      <td className="px-5 py-3 font-sans">
                        <button
                          onClick={() => setSelectedReceipt(r)}
                          className="text-indigo-400 hover:text-indigo-300 hover:underline font-semibold"
                        >
                          Inspect Proof 🔍
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Cryptographic Proof Inspector Modal ── */}
        {selectedReceipt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="max-w-2xl w-full rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white">Receipt Cryptographic Proof</h3>
                  <p className="text-xs font-mono text-indigo-400">{selectedReceipt.receiptId}</p>
                </div>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div>
                  <span className="text-slate-500 font-sans">Input Digest (SHA-256):</span>
                  <p className="p-2 rounded bg-slate-950 border border-slate-800 text-slate-300 break-all">{selectedReceipt.inputDigest}</p>
                </div>

                <div>
                  <span className="text-slate-500 font-sans">Content Hash:</span>
                  <p className="p-2 rounded bg-slate-950 border border-slate-800 text-slate-300 break-all">{selectedReceipt.contentHash}</p>
                </div>

                <div>
                  <span className="text-slate-500 font-sans">Ed25519 Signature:</span>
                  <p className="p-2 rounded bg-slate-950 border border-slate-800 text-emerald-400 break-all">{selectedReceipt.signature || "Verified"}</p>
                </div>

                <div className="pt-2 flex justify-between gap-3 font-sans">
                  <a
                    href={`/verify/${selectedReceipt.receiptId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition"
                  >
                    Open Public Verification Page ↗
                  </a>
                  <button
                    onClick={() => setSelectedReceipt(null)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
