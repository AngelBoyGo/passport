"use client";

import { useEffect, useState, useCallback } from "react";

interface SchedulerStatus {
  status: string;
  total_ticks: number;
  last_tick_at: string | null;
  last_tick_summary: string | null;
  next_tick_at: string | null;
  interval: string;
}

interface TickResult {
  tick_id: string;
  system_state: {
    enrolled_agents: number;
    total_evidence: number;
    treasury_balance: number;
    active_instances: number;
  };
  think_tank: {
    allocation: { totalBudget: number; tiers: Array<{ instanceCount: number; costPerInstance: number }> };
    top_opportunities: Array<{ rank: number; title: string; expectedValue: number; confidence: string }>;
  };
  runtime: {
    instances_to_create: number;
    instances_to_stop: string[];
    task_assignments: number;
    total_cost: number;
    total_revenue: number;
    profitability: number;
    summary: string;
  };
  duration_ms: number;
}

/**
 * Scheduler Card — shows the continuous tick status and latest results.
 */
export function SchedulerCard() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [lastTick, setLastTick] = useState<TickResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/scheduler/tick", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 60000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  async function triggerTick() {
    setRunning(true);
    try {
      const res = await fetch("/api/v1/scheduler/tick", { method: "POST", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLastTick(data);
        loadStatus();
      }
    } catch {} finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="h-12 bg-slate-700 rounded" />
      </div>
    );
  }

  const profitPct = lastTick ? Math.round(lastTick.runtime.profitability * 100) : null;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>⏱️</span> Scheduler
        </h2>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${status?.status === "active" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          <span className="text-xs text-slate-400">{status?.total_ticks ?? 0} ticks</span>
        </div>
      </div>

      <p className="text-[10px] text-slate-400">
        Continuous Think Tank + Runtime cycle. Every tick analyzes the system,
        computes optimal allocations, and assigns tasks to agents.
      </p>

      {/* Status Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-900/80 px-2.5 py-1.5">
          <span className="text-slate-400 text-[10px]">Last Tick</span>
          <p className="font-semibold text-white">
            {status?.last_tick_at ? new Date(status.last_tick_at).toLocaleString() : "Never"}
          </p>
        </div>
        <div className="rounded bg-slate-900/80 px-2.5 py-1.5">
          <span className="text-slate-400 text-[10px]">Next Tick</span>
          <p className="font-semibold text-white">
            {status?.next_tick_at ? new Date(status.next_tick_at).toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded bg-slate-900/80 px-2.5 py-1.5">
          <span className="text-slate-400 text-[10px]">Interval</span>
          <p className="font-semibold text-white">{status?.interval ?? "—"}</p>
        </div>
        <div className="rounded bg-slate-900/80 px-2.5 py-1.5">
          <span className="text-slate-400 text-[10px]">Status</span>
          <p className="font-semibold text-emerald-400">{status?.status ?? "—"}</p>
        </div>
      </div>

      {/* Last Tick Results */}
      {lastTick && (
        <div className="rounded-lg bg-slate-900/80 p-3 border border-emerald-800/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300">Tick: {lastTick.tick_id.slice(0, 16)}</span>
            <span className="text-[10px] text-slate-400">{lastTick.duration_ms}ms</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-slate-400">System</span>
              <p className="text-white">{lastTick.system_state.enrolled_agents} agents · {lastTick.system_state.total_evidence} evidence</p>
            </div>
            <div>
              <span className="text-slate-400">Treasury</span>
              <p className="text-white">${lastTick.system_state.treasury_balance}</p>
            </div>
            <div>
              <span className="text-slate-400">Runtime</span>
              <p className="text-white">Create {lastTick.runtime.instances_to_create} · Stop {lastTick.runtime.instances_to_stop.length} · {lastTick.runtime.task_assignments} tasks</p>
            </div>
            <div>
              <span className="text-slate-400">Profitability</span>
              <p className={profitPct && profitPct >= 100 ? "text-emerald-400" : "text-amber-400"}>
                {profitPct !== null ? `${profitPct}%` : "—"}
              </p>
            </div>
          </div>

          <p className="text-[10px] text-slate-500">{lastTick.runtime.summary}</p>

          {lastTick.think_tank.top_opportunities.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-indigo-300 mb-1">Top Opportunities</p>
              {lastTick.think_tank.top_opportunities.slice(0, 3).map((opp, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                  <span className="text-slate-300 truncate">#{opp.rank} {opp.title.slice(0, 40)}</span>
                  <span className="font-mono text-emerald-400 ml-2">${opp.expectedValue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trigger Button */}
      <button
        onClick={triggerTick}
        disabled={running}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
      >
        {running ? "Running Tick..." : "Run Tick Now"}
      </button>
    </div>
  );
}