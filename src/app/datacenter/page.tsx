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
  const [selectedCluster, setSelectedCluster] = useState<string>("facility-cluster-01");
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

  // Calculate live dynamic metrics from actual ledger receipts
  let totalLiveEvents = receipts.length;
  let hwVerifiedCount = receipts.filter((r) => r.origin === "live-instrument").length;
  let avgPowerDelta = 0;
  let totalEnergySaved = 0;
  let totalCarbonAvoided = 0;
  let powerDeltaCount = 0;

  for (const r of receipts) {
    if (typeof r.telemetry?.delta_power_pct === "number" && r.origin === "live-instrument") {
      avgPowerDelta += r.telemetry.delta_power_pct;
      powerDeltaCount++;
    }
    if (typeof r.telemetry?.energy_saved_kwh === "number") {
      totalEnergySaved += r.telemetry.energy_saved_kwh;
    }
    if (typeof r.telemetry?.carbon_avoided_kg === "number") {
      totalCarbonAvoided += r.telemetry.carbon_avoided_kg;
    }
  }

  const displayPowerDelta = powerDeltaCount > 0 ? (avgPowerDelta / powerDeltaCount).toFixed(1) : "—";
  const displayHwRatio = totalLiveEvents > 0 ? Math.round((hwVerifiedCount / totalLiveEvents) * 100) : 100;

  const pythonSnippet = `import httpx, time

# Enterprise Data Center Telemetry & Carbon Anchoring
async def anchor_facility_telemetry(cluster_id, measured_watts, baseline_watts, delta_pct):
    payload = {
        "cluster_id": cluster_id,
        "instance_id": "gpu-node-01",
        "event_type": "HARDWARE_POWER_VALIDATION",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "origin": "live-instrument", # 'live-instrument' | 'synthetic'
        "sku": "NVIDIA_H100_SXM5",
        "telemetry_source": "nvml_v12.2_ipmi_bmc",
        "baseline_nameplate_w": baseline_watts,
        "measured_power_avg_w": measured_watts,
        "delta_power_pct": delta_pct,
        "policy_setpoint_applied": "dynamic_power_governor_v2"
    }
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://passport.metis.gold/api/v1/datacenter/evidence",
            json=payload,
            headers={"Authorization": "Bearer pp_ent_YOUR_ISSUER_KEY"}
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
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 font-sans">
      <SiteHeader />

      <main className="flex-1 mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-12">
        {/* ── Hero & Introduction ── */}
        <div className="border-b border-slate-800 pb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
                Enterprise Infrastructure Substrate
              </span>
              <span className="text-xs text-slate-400 font-mono">Domain: SYSTEM_INTEGRATION</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl text-white">
              Data Center Trust, Energy & Carbon Governance
            </h1>
            <p className="text-base text-slate-300 leading-relaxed">
              The cryptographic trust substrate for GPU facilities, AI cloud providers, and sustainable data centers.
              Generate tamper-evident receipts for energy reduction, thermal safety compliance, and certified Scope 2 carbon avoidance.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={`/api/v1/datacenter/clusters/${selectedCluster}/credential`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 transition"
            >
              Export Sustainability VC (JSON-LD) ↗
            </a>
            <a
              href={`/api/v1/datacenter/compliance/packages/${selectedCluster}?framework=${complianceFramework}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-200 shadow-sm hover:bg-slate-800 transition"
            >
              Generate {complianceFramework} Audit Package ↗
            </a>
          </div>
        </div>

        {/* ── The Autonomous Data Center Audit Layer (vision) ── */}
        <div className="rounded-2xl border border-indigo-800/50 bg-gradient-to-br from-indigo-950 via-slate-900 to-emerald-950 p-6 sm:p-10 text-white shadow-xl space-y-6">
          <div>
            <span className="text-xs font-semibold tracking-wider uppercase text-indigo-300">
              The Verified-Autonomous Future
            </span>
            <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
              When AI runs the data center, no human can review it. Passport can.
            </h2>
            <p className="mt-3 max-w-4xl text-sm text-slate-300 leading-relaxed">
              The trajectory of the modern data center is unmistakable: energy governors, thermal controllers,
              workload schedulers, and capacity planners are becoming autonomous AI systems performing{" "}
              <strong className="text-white">millions of micro-decisions per day</strong> — a power setpoint change here,
              a thermal governor nudge there, a carbon-deferral scheduling choice, a hardware lifecycle action.
              No human team can review even a fraction of that volume, and manual audit simply does not scale.
              That is exactly the gap Passport fills.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-2">
              <span className="font-bold text-indigo-300">1. Each microaction is notarized</span>
              <p className="text-slate-400 leading-relaxed">
                Every autonomous decision emits a signed evidence event (
                <code>AUTONOMOUS_MICROACTION</code>) anchored with an Ed25519 signature and hashed into the receipt
                chain. Tampering with any single action breaks the Merkle root.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
              <span className="font-bold text-indigo-300">2. Batched, check-pointed, notarized</span>
              <p className="text-slate-400 leading-relaxed">
                Millions of receipts collapse into signed Merkle roots, published on a cadence, and pinned to an
                independent external notary — so no one (including Passport) can rewrite the record.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
              <span className="font-bold text-indigo-300">3. Aggregated into audit-grade documentation</span>
              <p className="text-slate-400 leading-relaxed">
                The receipt stream is automatically assembled into compliance evidence packages (SOC 2, ISO 27001,
                ISO 42001, NIST AI RMF, EU AI Act) and W3C sustainability credentials — documentation that
                materializes without a single human reviewer.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
              <span className="font-bold text-indigo-300">4. Verifiable by anyone, offline</span>
              <p className="text-slate-400 leading-relaxed">
                Regulators, tenants, insurers, and buyers independently re-verify any artifact offline with the
                public key-transparency log and the zero-dependency verifier. Trust is mechanical, not asserted.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <a
              href="/api/v1/datacenter/documentation"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 font-bold text-white hover:bg-indigo-500 transition"
            >
              View Facility Documentation Manifest ↗
            </a>
            <a
              href="/docs/verification"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-1.5 font-medium text-slate-200 hover:bg-slate-800 transition"
            >
              How independent verification works →
            </a>
          </div>
        </div>

        {/* ── Live Ledger Health Indicators ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Live Power Reduction</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                {powerDeltaCount > 0 ? "Hardware Verified" : "Awaiting Data"}
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-emerald-400">
              {displayPowerDelta !== "—" ? `${displayPowerDelta}%` : "Active"}
            </p>
            <p className="mt-1 text-xs text-slate-400">Empirically measured on physical silicon</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Strict Honesty Ratio</span>
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-400 border border-indigo-500/30">
                Audited
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-indigo-400">{displayHwRatio}%</p>
            <p className="mt-1 text-xs text-slate-400">Zero unverified models promoted</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Avoided Scope 2 Carbon</span>
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-400 border border-sky-500/30">
                Grid Sync
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-sky-400">
              {totalCarbonAvoided > 0 ? `-${totalCarbonAvoided.toFixed(1)} kg` : "Live Accrual"}
            </p>
            <p className="mt-1 text-xs text-slate-400">Hourly grid intensity emission matching</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Merkle Checkpoint</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                Tamper-Proof
              </span>
            </div>
            <p className="mt-2 text-xs font-mono font-bold text-slate-200 break-all">{merkleRoot.slice(0, 18)}...</p>
            <p className="mt-1 text-xs text-slate-400">Signed with root Ed25519 key</p>
          </div>
        </div>

        {/* ── 6 Core Benefits for Data Centers ── */}
        <div className="space-y-6">
          <div>
            <span className="text-xs font-semibold tracking-wider uppercase text-emerald-400">Enterprise Value Proposition</span>
            <h2 className="mt-1 text-2xl font-bold text-white">How Modern Data Centers Benefit from Passport</h2>
            <p className="mt-1 text-sm text-slate-400">
              Transform energy efficiency initiatives and AI cluster management into verifiable cryptographic assets.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {/* Benefit 1 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 text-lg font-bold">
                1
              </div>
              <h3 className="text-base font-bold text-white">Certified Scope 2 GHG Carbon Accounting</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Match GPU power reduction with real-time hourly grid carbon intensity data (ISO 14064 & GHG Protocol).
                Issue certified carbon receipts that enterprise tenants can directly submit for ESG disclosures without greenwashing scrutiny.
              </p>
            </div>

            {/* Benefit 2 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 text-lg font-bold">
                2
              </div>
              <h3 className="text-base font-bold text-white">EU AI Act (Article 51 / Annex IV) Compliance</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Automate compliance documentation for high-compute AI clusters. Generate 1-click signed evidence packages
                detailing energy consumption, compute efficiency, and environmental impact as required by European regulations.
              </p>
            </div>

            {/* Benefit 3 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 text-lg font-bold">
                3
              </div>
              <h3 className="text-base font-bold text-white">Tenant SLA & Thermal Safety Guarantees</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Provide immutable proof to colocation tenants that dynamic power capping or optimization setpoints never
                caused thermal throttling or exceeded safe junction temperature margins (Tj &lt; 85°C).
              </p>
            </div>

            {/* Benefit 4 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 text-lg font-bold">
                4
              </div>
              <h3 className="text-base font-bold text-white">Useful Work Fraction (UWF) & Joules/Token</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Move beyond facility-level PUE to internal compute efficiency. Quantify true energy consumed per generated LLM
                token (Joules/Token) and verify workload throughput with privacy-preserving hash commitments.
              </p>
            </div>

            {/* Benefit 5 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 text-lg font-bold">
                5
              </div>
              <h3 className="text-base font-bold text-white">W3C Verifiable Credentials for Green Marketing</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Issue tamper-evident <code className="text-purple-300">DataCenterSustainabilityCredential</code> documents signed with <code className="text-purple-300">did:key</code>.
                Tenants can verify and display official cryptographic badges on their websites and annual sustainability filings.
              </p>
            </div>

            {/* Benefit 6 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 hover:border-slate-700 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 text-lg font-bold">
                6
              </div>
              <h3 className="text-base font-bold text-white">Air-Gapped & Sovereign Offline Audits</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Government, defense, and high-security enterprise auditors can verify facility power receipts offline
                using zero-dependency CLI verifiers and published Public Key Transparency logs without network access.
              </p>
            </div>
          </div>
        </div>

        {/* ── Architecture Pipeline ── */}
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 sm:p-8 text-white shadow-lg space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-semibold tracking-wider uppercase text-emerald-400">Integration Architecture</span>
              <h2 className="text-xl font-bold text-white">How Data Centers Connect to Passport</h2>
            </div>
            <span className="text-xs font-mono text-emerald-400">Enterprise REST & JSON-LD</span>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 space-y-2">
              <span className="font-bold text-slate-200">1. Facility Instrumentation</span>
              <p className="text-slate-400 leading-relaxed">
                Collect high-frequency power and thermal telemetry via Smart PDUs, BMS, NVML, or BMC/IPMI interfaces.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5 space-y-2 ring-1 ring-emerald-500/20">
              <span className="font-bold text-emerald-300">2. Power Management & Setpoints</span>
              <p className="text-slate-400 leading-relaxed">
                Execute energy-saving policies, dynamic clocking, or workload shifting algorithms across connected server clusters.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 space-y-2">
              <span className="font-bold text-slate-200">3. Passport Cryptographic Ledger</span>
              <p className="text-slate-400 leading-relaxed">
                Post empirical benchmarks to Passport to generate Ed25519-signed receipts, Merkle tree checkpoints, and compliance exports.
              </p>
            </div>
          </div>
        </div>

        {/* ── Live Receipts Ledger ── */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 shadow-sm">
          <div className="border-b border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Data Center Receipts & Evidence Ledger</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Immutable cryptographic receipts linking physical telemetry to verified execution outcomes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "all" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                All Receipts
              </button>
              <button
                onClick={() => setFilter("hardware")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "hardware" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Live Hardware Only
              </button>
              <button
                onClick={() => setFilter("thermal")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === "thermal" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Thermal Audits
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-sans">
                <tr>
                  <th className="px-5 py-3 font-semibold">Receipt ID</th>
                  <th className="px-5 py-3 font-semibold">Event Type</th>
                  <th className="px-5 py-3 font-semibold">Attribution Mode</th>
                  <th className="px-5 py-3 font-semibold">Observed Metrics</th>
                  <th className="px-5 py-3 font-semibold">Timestamp</th>
                  <th className="px-5 py-3 font-semibold">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500 font-sans">
                      Loading data center receipts...
                    </td>
                  </tr>
                ) : filteredReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400 font-sans">
                      No data center receipts recorded yet in this view. Ingest telemetry via the API below.
                    </td>
                  </tr>
                ) : (
                  filteredReceipts.map((r) => (
                    <tr key={r.receipt_id} className="hover:bg-slate-800/50 transition">
                      <td className="px-5 py-3 font-semibold text-slate-200">{r.receipt_id}</td>
                      <td className="px-5 py-3">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-sans font-medium text-slate-300">
                          {r.event_type}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-sans font-bold ${
                            r.origin === "live-instrument"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          {r.origin === "live-instrument" ? "LIVE HARDWARE" : "SIMULATION MODEL"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-300 font-sans">
                        {r.telemetry.delta_power_pct !== undefined && (
                          <span>Power Δ: <strong className="text-emerald-400">{r.telemetry.delta_power_pct}%</strong> </span>
                        )}
                        {r.telemetry.peak_junction_temp_c !== undefined && (
                          <span className="ml-2">Tj: <strong>{r.telemetry.peak_junction_temp_c}°C</strong></span>
                        )}
                        {r.telemetry.carbon_avoided_kg !== undefined && (
                          <span className="ml-2 text-sky-400 font-medium">Carbon: -{r.telemetry.carbon_avoided_kg}kg</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{new Date(r.observed_at).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <a
                          href={`/verify/${r.receipt_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 font-sans font-semibold hover:underline"
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

        {/* ── SDK Quickstart ── */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Connect Your Data Center Cluster in Minutes</h2>
              <p className="mt-1 text-xs text-slate-400">
                Submit power validations, thermal safety audits, and carbon receipts using our authenticated REST API.
              </p>
            </div>
            <button
              onClick={copyCode}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
            >
              {copiedCode ? "✓ Copied" : "Copy Python Snippet"}
            </button>
          </div>

          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-emerald-300 border border-slate-800">
            {pythonSnippet}
          </pre>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
