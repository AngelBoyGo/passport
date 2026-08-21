"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

interface ReceiptItem {
  receipt_id: string;
  event_type: string;
  observed_at: string;
  origin: "live-instrument" | "synthetic";
  attribution_mode: string;
  telemetry: Record<string, any>;
}

export default function DataCenterPage() {
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [merkleRoot, setMerkleRoot] = useState<string>("8f4b29c0...");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [selectedCluster, setSelectedCluster] = useState<string>("vast-michigan-1");
  const [complianceFramework, setComplianceFramework] = useState<string>("EU_AI_ACT");
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch("/api/v1/datacenter/receipts?limit=20");
        if (res.ok) {
          const data = await res.json();
          setReceipts(data.receipts || []);
          if (data.merkle_root) setMerkleRoot(data.merkle_root);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const filteredReceipts = receipts.filter((r) => {
    if (filter === "all") return true;
    if (filter === "hardware") return r.origin === "live-instrument";
    if (filter === "modeled") return r.origin === "synthetic";
    if (filter === "thermal") return r.event_type === "THERMAL_SAFETY_AUDIT";
    if (filter === "carbon") return r.event_type === "CARBON_AVOIDED_ACCRUAL";
    return true;
  });

  const pythonSnippet = `import httpx, time

# DataCet -> Passport Cryptographic Anchoring
async def anchor_power_validation(cluster_id, measured_w, baseline_w, delta_pct):
    payload = {
        "cluster_id": cluster_id,
        "instance_id": "vast-michigan-1",
        "event_type": "HARDWARE_POWER_VALIDATION",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "origin": "live-instrument", # 'live-instrument' | 'synthetic'
        "sku": "NVIDIA_RTX_4090",
        "telemetry_source": "nvml_v12.2",
        "baseline_nameplate_w": baseline_w,
        "measured_power_avg_w": measured_w,
        "delta_power_pct": delta_pct,
        "policy_setpoint_applied": "gap7_load_stable"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://passport.metis.gold/api/v1/datacenter/evidence",
            json=payload,
            headers={"Authorization": "Bearer pp_YOUR_API_KEY"}
        )
        return res.json()["receipt_id"]`;

  const copyCode = () => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(pythonSnippet);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <SiteHeader />

      <main className="flex-1 mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-10">
        {/* ── Header ── */}
        <div className="border-b border-slate-200 pb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Data Center Energy & Trust Protocol
              </span>
              <span className="text-xs text-slate-500 font-mono">Domain: SYSTEM_INTEGRATION</span>
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-slate-900">
              Data Center Infrastructure & Carbon Governance
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Cryptographically verified energy reductions, thermal safety guarantees, and auditable Scope 2 carbon
              receipts for GPU data centers and AI clusters. Powering DataCet with immutable Ed25519 proofs.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/v1/datacenter/clusters/${selectedCluster}/credential`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition"
            >
              Export W3C Sustainability VC ↗
            </a>
            <a
              href={`/api/v1/datacenter/compliance/packages/${selectedCluster}?framework=${complianceFramework}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
            >
              Export {complianceFramework} Audit Package ↗
            </a>
          </div>
        </div>

        {/* ── Key Governance Gauges ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Hardware Power Δ</span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Measured</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-emerald-600">-9.6%</p>
            <p className="mt-1 text-xs text-slate-500">Champion: <code className="font-mono font-semibold text-slate-700">gap7_load_stable</code> (RTX 4090)</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Peak Ramp Mitigation</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">Grid Safe</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-indigo-600">-14.7%</p>
            <p className="mt-1 text-xs text-slate-500">Latency overhead capped at +2.6%</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Thermal Safety Pass</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">100% Clean</span>
            </div>
            <p className="mt-2 text-3xl font-bold text-sky-600">100.0%</p>
            <p className="mt-1 text-xs text-slate-500">0 thermal throttle events (Tj ≤ 68.2°C)</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Merkle Checkpoint</span>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Tamper-Proof</span>
            </div>
            <p className="mt-2 text-sm font-mono font-bold text-slate-800 break-all">{merkleRoot.slice(0, 16)}...</p>
            <p className="mt-1 text-xs text-slate-500">Anchored in immutable ledger root</p>
          </div>
        </div>

        {/* ── 3-Tier Integration Architecture Diagram ── */}
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 sm:p-8 text-white shadow-md">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-4">
            <div>
              <span className="text-xs font-semibold tracking-wider uppercase text-indigo-400">Enterprise Topology</span>
              <h2 className="text-xl font-bold text-white">The Three-Pillar Energy Governance Architecture</h2>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono text-emerald-400">Active Live Feed</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Pillar 1 */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-400">1</span>
                <h3 className="font-semibold text-slate-100">Replica Datacenter</h3>
              </div>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Physical & simulated GPU nodes (<code className="text-indigo-300">vast-michigan-1</code>, <code className="text-indigo-300">vast-replica-live</code>) executing live workloads. Emits raw NVML/IPMI power, junction temperatures, and latency traces.
              </p>
              <div className="mt-4 rounded bg-slate-900/80 p-2.5 font-mono text-[11px] text-slate-400 border border-slate-700/50">
                • Target: Hardware Silicon<br />
                • Output: High-Hz Telemetry<br />
                • Direct Passport: <strong>None (via DataCet)</strong>
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-xl border border-indigo-600/50 bg-indigo-950/40 p-5 backdrop-blur ring-1 ring-indigo-500/30">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">2</span>
                <h3 className="font-semibold text-white">DataCet Control Plane</h3>
              </div>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Autonomous energy management engine. Explores policy Pareto frontiers, enforces acting champion (<code className="text-emerald-300">gap7_load_stable</code>), performs measured-vs-predicted probes, and manages carbon deferral.
              </p>
              <div className="mt-4 rounded bg-slate-900/80 p-2.5 font-mono text-[11px] text-slate-400 border border-slate-700/50">
                • Policy: -9.6% Avg Power<br />
                • Strict Honesty: Never Fakes Measured<br />
                • Anchoring: Calls Passport API
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-400">3</span>
                <h3 className="font-semibold text-slate-100">Passport Trust Layer</h3>
              </div>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                The cryptographic ledger & compliance authority. Verifies hardware evidence, issues Ed25519-signed receipts, aggregates Merkle checkpoints, and generates W3C Verifiable Credentials.
              </p>
              <div className="mt-4 rounded bg-slate-900/80 p-2.5 font-mono text-[11px] text-slate-400 border border-slate-700/50">
                • Proof: Ed25519 & Merkle Trees<br />
                • Standards: W3C VC & EU AI Act<br />
                • Offline Verifiable: Yes (Zero Dep)
              </div>
            </div>
          </div>
        </div>

        {/* ── Live Receipts Ledger ── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Data Center Receipts & Evidence Ledger</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Immutable cryptographic receipts linking physical telemetry to verified execution outcomes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "all" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                All Receipts
              </button>
              <button
                onClick={() => setFilter("hardware")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "hardware" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Live Hardware Only
              </button>
              <button
                onClick={() => setFilter("thermal")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "thermal" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Thermal Audits
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b">
                <tr>
                  <th className="px-5 py-3 font-semibold">Receipt ID</th>
                  <th className="px-5 py-3 font-semibold">Event Type</th>
                  <th className="px-5 py-3 font-semibold">Attribution Mode</th>
                  <th className="px-5 py-3 font-semibold">Observed Metrics</th>
                  <th className="px-5 py-3 font-semibold">Timestamp</th>
                  <th className="px-5 py-3 font-semibold">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      Loading data center receipts...
                    </td>
                  </tr>
                ) : filteredReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No matching receipts found in the ledger. Ingest evidence via DataCet API.
                    </td>
                  </tr>
                ) : (
                  filteredReceipts.map((r) => (
                    <tr key={r.receipt_id} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-3 font-semibold text-slate-900">{r.receipt_id}</td>
                      <td className="px-5 py-3">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-sans font-medium text-slate-800">
                          {r.event_type}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-sans font-bold ${
                            r.origin === "live-instrument"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {r.origin === "live-instrument" ? "LIVE INSTRUMENT" : "SYNTHETIC MODEL"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700 font-sans">
                        {r.telemetry.delta_power_pct !== undefined && (
                          <span>Power Δ: <strong className="text-emerald-600">{r.telemetry.delta_power_pct}%</strong> </span>
                        )}
                        {r.telemetry.peak_junction_temp_c !== undefined && (
                          <span className="ml-2">Tj: <strong>{r.telemetry.peak_junction_temp_c}°C</strong></span>
                        )}
                        {r.telemetry.carbon_avoided_kg !== undefined && (
                          <span className="ml-2 text-indigo-600 font-medium">Carbon: -{r.telemetry.carbon_avoided_kg}kg</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{new Date(r.observed_at).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <a
                          href={`/verify/${r.receipt_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 font-sans font-medium hover:underline"
                        >
                          Inspect Proof →
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── DataCet SDK Quickstart ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Connect DataCet to Passport in 3 Lines of Code</h2>
              <p className="mt-1 text-xs text-slate-500">
                Use our authenticated REST API to post power benchmarks, policy setpoint transitions, and thermal safety checks.
              </p>
            </div>
            <button
              onClick={copyCode}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
            >
              {copiedCode ? "✓ Copied" : "Copy Python Snippet"}
            </button>
          </div>

          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-indigo-200 border border-slate-800">
            {pythonSnippet}
          </pre>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
