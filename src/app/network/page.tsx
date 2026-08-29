"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

interface NetworkData {
  totals: {
    enrolled_agents: number;
    evidence_entries: number;
    signed_receipts: number;
    finalized_receipts: number;
    operators: number;
    engagements: number;
    negotiations: number;
  };
  activity: {
    active_today: number;
    active_this_week: number;
    evidence_per_hour: number;
    receipts_per_hour: number;
    enrollments_this_month: number;
    growth_rate_pct: number;
  };
  top_domains: { domain: string; count: number }[];
  top_source_types: { source_type: string; count: number }[];
  health: { score: number; status: string };
  latest: { evidence_at: string | null; enrollment_at: string | null };
  timestamp: string;
}

export default function NetworkPage() {
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeAgo, setTimeAgo] = useState("");

  const loadNetwork = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/network", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setTimeAgo(new Date(d.timestamp).toLocaleTimeString());
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNetwork();
    const interval = setInterval(loadNetwork, 15000);
    return () => clearInterval(interval);
  }, [loadNetwork]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-900">
        <SiteHeader />
        <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-12">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-800 rounded w-1/3" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="h-24 bg-slate-800 rounded" />)}
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100 font-sans">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-12 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Passport Network</h1>
            <p className="mt-2 text-slate-400 text-sm">
              Live status of the cryptographic identity layer for AI agents.
              Auto-updates every 15 seconds.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block w-2 h-2 rounded-full ${data?.health.status === "healthy" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            <span className="text-xs text-slate-400">{data?.health.status.toUpperCase()}</span>
            <span className="text-xs text-slate-500">{timeAgo}</span>
          </div>
        </div>

        {/* Health Score */}
        <div className="rounded-xl border border-slate-800 bg-slate-800/80 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Network Health</span>
              <p className="text-4xl font-bold text-white mt-1">{data?.health.score ?? 0}<span className="text-lg text-slate-400">/100</span></p>
            </div>
            <div className="h-16 w-16 rounded-full border-4 flex items-center justify-center"
              style={{
                borderColor: (data?.health.score ?? 0) >= 75 ? "#22c55e" : (data?.health.score ?? 0) >= 50 ? "#f59e0b" : "#ef4444",
              }}
            >
              <span className="text-lg font-bold">{data?.health.score ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Totals Grid */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Enrolled Agents", value: data?.totals.enrolled_agents ?? 0, color: "#6366f1", sub: "Ed25519 key-bound" },
            { label: "Evidence Entries", value: data?.totals.evidence_entries ?? 0, color: "#22c55e", sub: "salted commitments" },
            { label: "Signed Receipts", value: data?.totals.signed_receipts ?? 0, color: "#f59e0b", sub: "Ed25519 signed" },
            { label: "Active Today", value: data?.activity.active_today ?? 0, color: "#38bdf8", sub: `${data?.activity.evidence_per_hour ?? 0}/hr` },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 shadow-sm">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{stat.label}</span>
              <p className="mt-1 text-3xl font-bold text-white">{stat.value.toLocaleString()}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: stat.color }}>{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Activity */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Active This Week", value: data?.activity.active_this_week ?? 0 },
            { label: "Growth Rate", value: `${data?.activity.growth_rate_pct ?? 0}%`, sub: "month over month" },
            { label: "Enrollments/Month", value: data?.activity.enrollments_this_month ?? 0 },
            { label: "Operators", value: data?.totals.operators ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-800/40 p-4 shadow-sm">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{stat.label}</span>
              <p className="mt-1 text-2xl font-bold text-white">{stat.value.toLocaleString()}</p>
              {stat.sub && <p className="mt-0.5 text-[11px] text-slate-400">{stat.sub}</p>}
            </div>
          ))}
        </div>

        {/* Top Domains + Source Types */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-white">Top Domains</h2>
            <div className="mt-4 space-y-2">
              {data?.top_domains?.map((d) => (
                <div key={d.domain} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{d.domain || "Unknown"}</span>
                  <span className="font-mono text-slate-400">{d.count}</span>
                </div>
              )) ?? <p className="text-xs text-slate-500">No domain data yet</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-white">Evidence Sources</h2>
            <div className="mt-4 space-y-2">
              {data?.top_source_types?.map((s) => (
                <div key={s.source_type} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{s.source_type}</span>
                  <span className="font-mono text-slate-400">{s.count}</span>
                </div>
              )) ?? <p className="text-xs text-slate-500">No source data yet</p>}
            </div>
          </div>
        </div>

        {/* Latest Activity */}
        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-white">Latest Activity</h2>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-slate-900 p-3">
              <span className="text-slate-400">Last Evidence</span>
              <p className="mt-1 text-slate-200 font-mono">{data?.latest.evidence_at ? new Date(data.latest.evidence_at).toLocaleString() : "—"}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <span className="text-slate-400">Last Enrollment</span>
              <p className="mt-1 text-slate-200 font-mono">{data?.latest.enrollment_at ? new Date(data.latest.enrollment_at).toLocaleString() : "—"}</p>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <span className="text-slate-400">Engagements</span>
              <p className="mt-1 text-slate-200 font-mono">{data?.totals.engagements ?? 0}</p>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/agents" className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition">Agent Embassy →</Link>
          <Link href="/leaderboard" className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition">Leaderboard →</Link>
          <Link href="/playground" className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition">API Playground →</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}