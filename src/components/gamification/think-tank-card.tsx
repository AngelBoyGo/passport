"use client";

import { useEffect, useState, useCallback } from "react";

interface ThinkTankData {
  analyzed_at: string;
  run_id: string;
  system_state: Record<string, number>;
  allocation: {
    totalBudget: number;
    budgetCurrency: string;
    tiers: Array<{ instanceCount: number; costPerInstance: number; capability: string; expectedOutput: string }>;
    rationale: string;
  };
  top_opportunities: Array<{
    rank: number;
    title: string;
    type: string;
    expectedValue: number;
    confidence: string;
    effort: string;
    timeToValue: string;
    description: string;
  }>;
  insights: string[];
  timestamp: string;
}

/**
 * Think Tank Dashboard — shows what the autonomous system is thinking.
 * Every analysis is an evidence entry — the think tank grows smarter over time.
 */
export function ThinkTankCard() {
  const [data, setData] = useState<ThinkTankData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadThinkTank = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/think-tank", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThinkTank();
    const interval = setInterval(loadThinkTank, 60000);
    return () => clearInterval(interval);
  }, [loadThinkTank]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-slate-700 rounded" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-5 shadow-sm">
        <p className="text-xs text-slate-400">Think tank initializing...</p>
      </div>
    );
  }

  const allocBudget = data.allocation?.totalBudget || 0;
  const totalInstances = data.allocation?.tiers?.reduce((s, t) => s + t.instanceCount, 0) || 0;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🧠</span> Think Tank
        </h2>
        <span className="text-[10px] text-slate-400 font-mono">{data.run_id.slice(0, 16)}</span>
      </div>

      <p className="text-[10px] text-slate-400">
        Autonomous reasoning engine. Analyzes system state, generates opportunities,
        and recommends agent allocations. Every analysis is recorded as evidence.
      </p>

      {/* System State Summary */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {Object.entries(data.system_state || {}).slice(0, 6).map(([key, value]) => (
          <div key={key} className="rounded bg-slate-900/80 px-2.5 py-1.5">
            <span className="text-slate-400 text-[10px]">{key.replace(/_/g, " ")}</span>
            <p className="font-semibold text-white">{typeof value === "number" ? value.toLocaleString() : String(value)}</p>
          </div>
        ))}
      </div>

      {/* Allocation */}
      {data.allocation && (
        <div className="rounded-lg bg-slate-900/80 p-3 border border-emerald-800/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300">Agent Allocation</span>
            <span className="text-xs font-mono text-emerald-300">${allocBudget}/mo</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">{totalInstances} instances across {data.allocation.tiers?.length || 0} tiers</p>
          {data.allocation.tiers?.map((tier, i) => (
            <div key={i} className="mt-1 flex items-center justify-between text-[10px]">
              <span className="text-slate-400">{tier.instanceCount} × ${tier.costPerInstance}<span className="text-slate-500">/mo</span></span>
              <span className="text-slate-300">{tier.capability}</span>
            </div>
          ))}
          <p className="mt-1 text-[9px] text-slate-500">{data.allocation.rationale?.slice(0, 120)}</p>
        </div>
      )}

      {/* Top Opportunities */}
      {data.top_opportunities && data.top_opportunities.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-300 mb-2">Top Opportunities</p>
          <div className="space-y-1.5">
            {data.top_opportunities.slice(0, 5).map((opp, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-slate-900/60 px-2.5 py-1.5 text-[10px]">
                <span className="text-slate-300 truncate flex-1">#{opp.rank} {opp.description?.slice(0, 60)}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="font-mono text-emerald-400">${opp.expectedValue}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${
                    opp.confidence === "high" || opp.confidence === "very_high" ? "bg-emerald-900/50 text-emerald-300" :
                    opp.confidence === "medium" ? "bg-amber-900/50 text-amber-300" :
                    "bg-slate-800 text-slate-400"
                  }`}>
                    {opp.confidence}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {data.insights && data.insights.length > 0 && (
        <div className="rounded-lg bg-indigo-950/30 border border-indigo-800/40 p-3">
          <p className="text-[10px] font-semibold text-indigo-300 mb-1">Lessons Learned</p>
          {data.insights.map((insight, i) => (
            <p key={i} className="text-[10px] text-indigo-200/80 mt-0.5">• {insight}</p>
          ))}
        </div>
      )}

      <p className="text-[9px] text-slate-500 text-center">
        Last analysis: {new Date(data.analyzed_at).toLocaleString()}
      </p>
    </div>
  );
}