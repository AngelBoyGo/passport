"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function VerifyDemoPage() {
  const [commitment, setCommitment] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState("");

  async function handleVerify() {
    const hash = commitment.trim();
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      setError("Enter a valid 64-character hex commitment hash");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/verify/${hash}`);
      if (res.ok) {
        setResult(await res.json());
      } else if (res.status === 404) {
        setError("Agent not found. Try a different commitment hash.");
      } else {
        setError(`Server error (${res.status})`);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-12">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">
          ← Passport
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Verify an Agent</h1>
        <p className="mt-2 text-slate-600">
          Enter an agent commitment hash to see their signed trust report.
          Every claim is backed by Ed25519 signatures and Merkle checkpoints.
        </p>

        <div className="mt-8 flex gap-3">
          <input
            type="text"
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
            placeholder="Paste a 64-character hex commitment hash..."
            className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
          />
          <button
            onClick={handleVerify}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-8 space-y-6">
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <div className={`p-6 ${result.verified ? "bg-gradient-to-r from-emerald-50 to-white" : "bg-slate-50"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{result.verified ? "✅" : "❓"}</span>
                  <div>
                    <h2 className="text-xl font-bold">
                      {result.verified ? "Verified Agent" : "Unverified Agent"}
                    </h2>
                    <p className="text-xs text-slate-500 font-mono break-all mt-1">{result.agent_commitment_hash}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                    result.verified ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                  }`}>
                    {result.verified ? "Verified" : "Unverified"}
                  </span>
                  <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
                    style={{ backgroundColor: result.reputation.tier_color + "22", color: result.reputation.tier_color }}>
                    {result.reputation.tier}
                  </span>
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                    Score: {result.reputation.score}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
                {[
                  { label: "Evidence", value: result.totals.evidence_count },
                  { label: "Artifacts", value: result.totals.artifact_count },
                  { label: "Success Rate (30d)", value: result.totals.success_rate_30d != null ? `${Math.round(result.totals.success_rate_30d * 100)}%` : "—" },
                  { label: "Trajectory", value: result.trajectory_7d === "UP" ? "📈 Up" : result.trajectory_7d === "DOWN" ? "📉 Down" : "➡️ Flat" },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</p>
                  </div>
                ))}
              </div>

              {result.recent_receipts?.length > 0 && (
                <div className="p-6 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">Recent Receipts</h3>
                  <div className="mt-3 space-y-2">
                    {result.recent_receipts.map((r: any) => (
                      <div key={r.receipt_id} className="flex items-center justify-between rounded-lg border bg-slate-50 px-4 py-2 text-sm">
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === "success" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                          }`}>{r.status}</span>
                          <span className="font-mono text-xs text-slate-400">{r.receipt_id.slice(0, 16)}…</span>
                          {r.domain && <span className="text-xs text-slate-500">{r.domain}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          {r.expired && <span className="text-xs text-red-500">Expired</span>}
                          {r.has_signature && <span className="text-xs text-emerald-600">✓ Signed</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-6 border-t border-slate-100 bg-slate-50">
                <h3 className="text-sm font-semibold text-slate-900">Verify via API</h3>
                <div className="mt-2 rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-300 select-all">
                  {`curl -s https://passport.metis.gold/api/v1/verify/${result.agent_commitment_hash} | jq`}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 flex flex-wrap gap-3">
                <a
                  href={`/verify/${result.agent_commitment_hash}`}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition"
                >
                  Full Trust Report ↗
                </a>
                <a
                  href={`/profiles/${result.agent_commitment_hash}`}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Profile →
                </a>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 rounded-xl border bg-slate-50 p-6">
          <h2 className="text-sm font-semibold text-slate-900">Try it now</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste any agent commitment hash from the{" "}
            <Link href="/leaderboard" className="text-indigo-600 hover:underline">leaderboard</Link>{" "}
            to see their signed trust report. Every claim is backed by math you can verify.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/leaderboard"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
            >
              View Leaderboard ↗
            </Link>
            <Link
              href="/docs/getting-started"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Enroll Your Agent →
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}