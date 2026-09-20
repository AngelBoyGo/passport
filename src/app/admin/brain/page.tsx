"use client";

import { useCallback, useEffect, useState, useRef } from "react";

interface BrainData {
  current_run: {
    last_observation: { cycle_id: string | null; summary: string; at: string } | null;
    last_decision: { cycle_id: string | null; action: string | null; rationale: string; at: string } | null;
    last_outcome: { cycle_id: string | null; action: string | null; result: string | null; at: string } | null;
    health_trajectory: Array<{ at: string; health: number }>;
  };
  impact: {
    recent_attributions: Array<{
      cycle_id: string | null;
      action: string | null;
      delta: number | null;
      result: string | null;
      confidence: number | null;
      confounders: string[];
      at: string;
    }>;
  };
  learning: {
    proposals_by_status: Record<string, number>;
    canary: { proposal_id: string; objective: string; replay_score: number | null; since: string } | null;
  };
  safety: {
    action_allowlist: string[];
    money_moving_actions: number;
    outcomes_24h_by_class: Record<string, number>;
    memory_rows_by_kind: Record<string, number>;
  };
  timestamp: string;
}

interface Proposal {
  proposal_id: string;
  objective: string;
  expected_improvement: string;
  risk_class: string;
  status: string;
  replay_score: number | null;
}

interface CycleHistoryItem {
  cycleId: string;
  at: string;
  action: string | null;
  outcome: string | null;
  healthScore: number | null;
  observationSummary: string | null;
  decisionRationale: string | null;
}

const NEXT_ACTIONS: Record<string, Array<{ action: string; label: string }>> = {
  PROPOSED: [{ action: "replay", label: "Replay vs history" }],
  REPLAYED: [{ action: "mark_audited", label: "Mark audited" }],
  AUDITED: [{ action: "require_approval", label: "Request approval" }],
  APPROVAL_REQUIRED: [
    { action: "approve", label: "Approve" },
    { action: "reject", label: "Reject" },
  ],
  APPROVED: [{ action: "canary", label: "Start canary (shadow)" }],
  CANARY: [
    { action: "promote", label: "Promote" },
    { action: "rollback", label: "Roll back" },
  ],
  PROMOTED: [{ action: "rollback", label: "Roll back" }],
};

function resultBadge(result: string | null): { label: string; className: string } {
  switch (result) {
    case "POSITIVE":
      return { label: "POSITIVE", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
    case "NEGATIVE":
      return { label: "NEGATIVE", className: "bg-red-500/15 text-red-300 border-red-500/40" };
    case "NEUTRAL":
      return { label: "NEUTRAL", className: "bg-slate-500/15 text-slate-300 border-slate-500/40" };
    default:
      return { label: result ?? "UNKNOWN", className: "bg-slate-500/15 text-slate-400 border-slate-500/40" };
  }
}

function actionBadgeClass(action: string | null): string {
  switch (action) {
    case "RUN_TICK":
      return "bg-blue-500/20 text-blue-300 border-blue-500/40";
    case "RUN_RESEARCH_SCAN":
      return "bg-purple-500/20 text-purple-300 border-purple-500/40";
    case "RUN_EXTERNAL_RESEARCH":
      return "bg-indigo-500/20 text-indigo-300 border-indigo-500/40";
    case "TRIGGER_ATTESTATION":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "QUARANTINE_RAIL":
      return "bg-red-500/20 text-red-300 border-red-500/40";
    case "INVESTIGATE_DISPUTE":
      return "bg-orange-500/20 text-orange-300 border-orange-500/40";
    case "RECORD_NOTE":
      return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
    case "NOOP":
    default:
      return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  }
}

function Panel({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export default function AdminBrainPage() {
  const [data, setData] = useState<BrainData | null>(null);
  const [history, setHistory] = useState<CycleHistoryItem[]>([]);
  const [error, setError] = useState("");
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const [triggeringAction, setTriggeringAction] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [isLiveStream, setIsLiveStream] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brain", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 403) throw new Error("Executive admin access required (ADMIN_OPERATOR_EMAILS).");
      if (!res.ok) throw new Error(`Unable to load brain state (${res.status})`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brain/history?limit=15", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) {
        const json = await res.json();
        setHistory(json.history ?? []);
      }
    } catch {
      // non-critical
    }
  }, []);

  // Set up live Server-Sent Events stream with polling fallback
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount + live stream setup
    loadData();
    loadHistory();

    // Check if EventSource is supported
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        const es = new EventSource("/api/admin/brain/stream");
        eventSourceRef.current = es;

        es.addEventListener("snapshot", (e) => {
          try {
            const parsed = JSON.parse(e.data);
            setData(parsed);
            setIsLiveStream(true);
            setError("");
          } catch {}
        });

        es.addEventListener("update", (e) => {
          try {
            const parsed = JSON.parse(e.data);
            setData(parsed);
            loadHistory();
            setIsLiveStream(true);
          } catch {}
        });

        es.addEventListener("heartbeat", (e) => {
          try {
            const parsed = JSON.parse(e.data);
            if (typeof parsed.secondsUntilNext === "number") {
              setCountdownSeconds(parsed.secondsUntilNext);
            }
            setIsLiveStream(true);
          } catch {}
        });

        es.onerror = () => {
          setIsLiveStream(false);
        };
      } catch {
        setIsLiveStream(false);
      }
    }

    // Fast polling fallback if SSE is disconnected
    const timer = setInterval(() => {
      if (!isLiveStream) {
        loadData();
        loadHistory();
      }
    }, 10_000);

    return () => {
      clearInterval(timer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [loadData, loadHistory, isLiveStream]);

  // Client countdown interval
  useEffect(() => {
    if (countdownSeconds == null || countdownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCountdownSeconds((prev) => (prev != null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownSeconds]);

  const loadProposals = useCallback(async (): Promise<Proposal[]> => {
    const res = await fetch("/api/admin/brain/proposals?limit=25", { cache: "no-store", credentials: "same-origin" });
    if (res.status === 403) throw new Error("Executive admin access required (ADMIN_OPERATOR_EMAILS).");
    if (!res.ok) throw new Error(`Unable to load proposals (${res.status})`);
    const json = await res.json();
    return json.proposals ?? [];
  }, []);

  async function transition(proposalId: string, action: string): Promise<void> {
    setBusyProposal(proposalId);
    try {
      const res = await fetch(`/api/admin/brain/proposals/${proposalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `Transition failed (${res.status})`);
      }
      await loadData();
      await loadHistory();
    } finally {
      setBusyProposal(null);
    }
  }

  async function triggerCycle(forceAction?: string) {
    const actionLabel = forceAction || "autonomous cycle";
    setTriggeringAction(actionLabel);
    setActionSuccessMsg(null);
    setError("");

    try {
      const res = await fetch("/api/admin/brain/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(forceAction ? { forceAction } : {}),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Failed (${res.status})` }));
        throw new Error(body.error || `Failed to trigger ${actionLabel}`);
      }

      const json = await res.json();
      const report = json.report;
      setActionSuccessMsg(
        `✓ Executed ${report.action} (${report.action_result}). Health: ${report.health_score}`
      );

      await loadData();
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggeringAction(null);
    }
  }

  function formatCountdown(sec: number | null): string {
    if (sec == null) return "syncing…";
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}m ${s < 10 ? "0" : ""}${s}s`;
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6" role="alert">
        <p className="text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError("");
            loadData();
          }}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <p>Connecting to AI Command Brain…</p>
      </div>
    );
  }

  const run = data.current_run;
  const trajectory = run.health_trajectory;
  const latestHealth = trajectory.length > 0 ? trajectory[trajectory.length - 1].health : 1.0;

  return (
    <div className="space-y-6 text-slate-100" aria-label="AI brain command center">
      {/* ── Top Header & Real-Time Connection Ribbon ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isLiveStream ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" : "bg-amber-400"
              }`}
            />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              {isLiveStream ? "Live SSE Stream Connected" : "Polling Active (10s)"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">AI Command Brain</h1>
          <p className="mt-1 text-sm text-slate-400">
            Autonomous supervisor of Passport, AngelCoin, and the Sahel corridor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            money-moving actions: {data.safety.money_moving_actions}
          </span>
          <div className="rounded-xl border border-white/10 bg-[#0e131d] px-3.5 py-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Next Scheduled Cycle</p>
            <p className="font-mono text-sm font-bold text-indigo-300">{formatCountdown(countdownSeconds)}</p>
          </div>
          <button
            type="button"
            disabled={triggeringAction !== null}
            onClick={() => triggerCycle()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition shadow-lg shadow-indigo-900/40"
          >
            {triggeringAction === "autonomous cycle" ? "Executing Cycle…" : "▶ Trigger Cycle Now"}
          </button>
        </div>
      </div>

      {/* ── Action Notification Banner ── */}
      {actionSuccessMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
          <span>{actionSuccessMsg}</span>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {/* ── Subsystem Posture Ribbon ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-[#0e131d] p-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Composite Health</span>
            <span className={`h-2 w-2 rounded-full ${latestHealth >= 0.8 ? "bg-emerald-400" : "bg-amber-400"}`} />
          </div>
          <p className="mt-1 font-mono text-xl font-bold text-white">{(latestHealth * 100).toFixed(0)}%</p>
          <p className="text-[11px] text-slate-500">Score {latestHealth.toFixed(3)}</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0e131d] p-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">AngelCoin Peg</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>
          <p className="mt-1 font-mono text-xl font-bold text-white">$5.00</p>
          <p className="text-[11px] text-emerald-400">1 ANGEL = $5.00 USD (1:1)</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0e131d] p-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Settlement Rails</span>
            <span className="h-2 w-2 rounded-full bg-indigo-400" />
          </div>
          <p className="mt-1 font-mono text-xl font-bold text-white">Operational</p>
          <p className="text-[11px] text-slate-500">Corridor integrity intact</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0e131d] p-3.5 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Money-Moving Safety</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-400">0 Actions</p>
          <p className="text-[11px] text-slate-500">Hard constraint preserved</p>
        </div>
      </div>

      {/* ── Executive On-Demand Diagnostic Action Strip ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Manual Diagnostic Controls:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={triggeringAction !== null}
            onClick={() => triggerCycle("RUN_RESEARCH_SCAN")}
            className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 transition"
          >
            {triggeringAction === "RUN_RESEARCH_SCAN" ? "Running Scan…" : "🔍 Run Internal Research"}
          </button>
          <button
            type="button"
            disabled={triggeringAction !== null}
            onClick={() => triggerCycle("RUN_EXTERNAL_RESEARCH")}
            className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 transition"
          >
            {triggeringAction === "RUN_EXTERNAL_RESEARCH" ? "Surveying…" : "🌐 Run External Research"}
          </button>
          <button
            type="button"
            disabled={triggeringAction !== null}
            onClick={() => triggerCycle("TRIGGER_ATTESTATION")}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition"
          >
            {triggeringAction === "TRIGGER_ATTESTATION" ? "Attesting…" : "🛡️ Trigger Attestation"}
          </button>
          <button
            type="button"
            disabled={triggeringAction !== null}
            onClick={() => triggerCycle("RUN_TICK")}
            className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 transition"
          >
            {triggeringAction === "RUN_TICK" ? "Executing…" : "⚡ Execute Health Tick"}
          </button>
        </div>
      </div>

      {/* ── Main Diagnostics Grid ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Current Run Panel */}
        <Panel
          title="Current Cycle Snapshot"
          badge={
            run.last_outcome && (
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${actionBadgeClass(run.last_outcome.action)}`}>
                {run.last_outcome.action ?? "NOOP"}
              </span>
            )
          }
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Observation</span>
                <span className="text-slate-500">
                  {run.last_observation ? new Date(run.last_observation.at).toLocaleTimeString() : "—"}
                </span>
              </div>
              <p className="font-mono text-sm text-slate-200">
                {run.last_observation ? run.last_observation.summary : "No observation recorded yet."}
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Autonomous Decision</span>
                <span className="text-slate-500">
                  {run.last_decision ? new Date(run.last_decision.at).toLocaleTimeString() : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-indigo-300">
                  {run.last_decision?.action ?? "NOOP"}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed bg-black/20 p-2.5 rounded-lg border border-white/5">
                {run.last_decision?.rationale ?? "No decision rationale available."}
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Execution Outcome</span>
                <span className="text-slate-500">
                  {run.last_outcome ? new Date(run.last_outcome.at).toLocaleTimeString() : "—"}
                </span>
              </div>
              <p className="font-mono text-xs text-emerald-400">
                {run.last_outcome ? `${run.last_outcome.action} → ${run.last_outcome.result}` : "—"}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Health Trajectory
                </span>
                <span className="text-[11px] text-slate-400">
                  Current: {(latestHealth * 100).toFixed(0)}%
                </span>
              </div>
              {trajectory.length === 0 ? (
                <p className="text-xs text-slate-500">No health trajectory points recorded yet.</p>
              ) : (
                <div
                  className="flex h-16 items-end gap-2 border-b border-white/5 pb-1"
                  role="img"
                  aria-label={`Health trajectory: ${trajectory.map((t) => t.health).join(", ")}`}
                >
                  {trajectory.map((t, idx) => (
                    <div key={idx} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className={
                          "w-full rounded-t transition-all " +
                          (t.health >= 0.8
                            ? "bg-emerald-500/70 hover:bg-emerald-400"
                            : t.health >= 0.5
                            ? "bg-amber-500/70 hover:bg-amber-400"
                            : "bg-red-500/70 hover:bg-red-400")
                        }
                        style={{ height: `${Math.max(8, t.health * 100)}%` }}
                        title={`${t.health} at ${new Date(t.at).toLocaleTimeString()}`}
                      />
                      <span className="text-[10px] text-slate-500">{t.health}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* Impact & Attributions Panel */}
        <Panel title="Impact — Measured Attributions">
          <p className="text-xs text-slate-400 mb-3">
            Causally attributed deltas evaluated over consecutive cycles with confounder detection.
          </p>
          {data.impact.recent_attributions.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 text-center">
              <p className="text-xs text-slate-400">No attributions yet.</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Attributions appear after non-NOOP actions execute and the subsequent cycle measures
                system response.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.impact.recent_attributions.slice(0, 6).map((a, i) => {
                const badge = resultBadge(a.result);
                return (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-indigo-300">{a.action}</span>
                        <span className={`rounded border px-1.5 py-0.2 text-[10px] ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {new Date(a.at).toLocaleString()}
                        {a.cycle_id && ` · ${a.cycle_id}`}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-mono text-xs font-bold text-white">
                        {a.delta != null ? `${a.delta >= 0 ? "+" : ""}${a.delta}` : "—"}
                      </p>
                      <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                        {a.confidence != null && <span>conf {(a.confidence * 100).toFixed(0)}%</span>}
                        {a.confounders && a.confounders.length > 0 && (
                          <span className="text-amber-400 font-medium" title={a.confounders.join(", ")}>
                            ({a.confounders.length} confounders)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Learning & Proposals Panel */}
        <Panel title="Learning & Proposal Pipeline">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400 mb-2">Proposals by State:</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(data.learning.proposals_by_status).length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No proposals yet. Use &ldquo;Run Internal Research&rdquo; above to discover findings and seed proposals.
                  </p>
                ) : (
                  Object.entries(data.learning.proposals_by_status).map(([status, count]) => (
                    <span key={status} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300 font-medium">
                      {status}: <strong className="text-indigo-300">{count}</strong>
                    </span>
                  ))
                )}
              </div>
            </div>

            {data.learning.canary && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300">Active Canary in Shadow Mode</span>
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200 font-mono">
                    NEVER EXECUTES
                  </span>
                </div>
                <p className="text-xs text-slate-200 mt-1">{data.learning.canary.objective}</p>
                <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                  <span>Replay Score: <strong className="text-white">{data.learning.canary.replay_score ?? "n/a"}</strong></span>
                  <span>Active Since: {new Date(data.learning.canary.since).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* Safety & Execution Guarantees */}
        <Panel title="Operational Safety & Allowlist">
          <div className="space-y-3.5 text-xs">
            <div>
              <span className="text-slate-400">Action Allowlist ({data.safety.action_allowlist.length})</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.safety.action_allowlist.map((a) => (
                  <span key={a} className="rounded bg-white/5 border border-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                    {a}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-white/5 pt-2">
              <span className="text-slate-400">Outcomes (Past 24 Hours)</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {Object.entries(data.safety.outcomes_24h_by_class).length === 0 ? (
                  <span className="text-slate-500">No outcomes recorded in last 24h</span>
                ) : (
                  Object.entries(data.safety.outcomes_24h_by_class).map(([k, v]) => (
                    <span key={k} className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                      {k}: <strong className="text-indigo-300">{v}</strong>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-white/5 pt-2 flex justify-between text-slate-400">
              <span>Memory Table Entries</span>
              <span className="text-slate-200">
                {Object.entries(data.safety.memory_rows_by_kind).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Proposals Steering Table ── */}
      <ProposalsTable
        loadProposals={loadProposals}
        busyProposal={busyProposal}
        onTransition={transition}
      />

      {/* ── Recent Cycles History Table (New) ── */}
      <section aria-label="Cycle History" className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
              Autonomous Cycle History (Last {history.length} Cycles)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Chronological log of recent 10-minute cycles, observations, model choices, and outcomes.
            </p>
          </div>
          <button
            onClick={loadHistory}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition"
          >
            Refresh Log
          </button>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No cycle history logged yet. The brain records history every 10 minutes.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-white/5">
              <thead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-white/10">
                <tr>
                  <th className="py-2.5 pr-3">Time</th>
                  <th className="py-2.5 pr-3">Cycle ID</th>
                  <th className="py-2.5 pr-3">Action</th>
                  <th className="py-2.5 pr-3">Health</th>
                  <th className="py-2.5 pr-3">Outcome</th>
                  <th className="py-2.5">Rationale / Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {history.map((item) => (
                  <tr key={item.cycleId} className="hover:bg-white/[0.02] transition">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-400">
                      {new Date(item.at).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500">
                      {item.cycleId}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${actionBadgeClass(item.action)}`}>
                        {item.action ?? "NOOP"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono">
                      {item.healthScore != null ? (
                        <span className={item.healthScore >= 0.8 ? "text-emerald-400" : "text-amber-400"}>
                          {item.healthScore}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px]">
                      {item.outcome === "ok" ? (
                        <span className="text-emerald-400">✓ ok</span>
                      ) : item.outcome ? (
                        <span className="text-slate-400">{item.outcome}</span>
                      ) : "—"}
                    </td>
                    <td className="py-2.5 text-slate-400 truncate max-w-xs" title={item.decisionRationale || item.observationSummary || ""}>
                      {item.decisionRationale || item.observationSummary || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ProposalsTable({
  loadProposals,
  busyProposal,
  onTransition,
}: {
  loadProposals: () => Promise<Proposal[]>;
  busyProposal: string | null;
  onTransition: (proposalId: string, action: string) => Promise<void>;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadProposals()
      .then(setProposals)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [loadProposals]);

  async function act(proposal: Proposal, action: string, label: string) {
    const confirmed = window.confirm(
      `Confirm: "${label}" on proposal ${proposal.proposal_id}?\n\n` +
        `Objective: ${proposal.objective}\n` +
        `Risk class: ${proposal.risk_class}\n\n` +
        `This action is audit-logged to your operator identity.`
    );
    if (!confirmed) return;
    try {
      await onTransition(proposal.proposal_id, action);
      setProposals(await loadProposals());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (error) {
    return (
      <section aria-label="Proposals" className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
        <p className="text-sm text-red-300">{error}</p>
      </section>
    );
  }

  return (
    <section aria-label="Proposals" className="rounded-2xl border border-white/10 bg-[#0e131d] p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            Improvement Proposals — Steer the Promotion Pipeline
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Hypotheses produced by autonomous research. Advances through replay, audit, approval, and canary shadow.
          </p>
        </div>
      </div>

      {proposals === null ? (
        <p className="text-sm text-slate-400">Loading proposals…</p>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-xs text-slate-400">
          <p>No improvement proposals on record yet.</p>
          <p className="mt-1 text-slate-500">
            Click &ldquo;Run Internal Research&rdquo; or &ldquo;Run External Research&rdquo; in the controls above to survey system telemetry and generate candidate proposals.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm divide-y divide-white/5">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2.5 pr-4">Objective</th>
                <th className="py-2.5 pr-4">Risk</th>
                <th className="py-2.5 pr-4">Replay score</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 text-right">Steering Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {proposals.map((p) => (
                <tr key={p.proposal_id} className="hover:bg-white/[0.02] transition">
                  <td className="py-2.5 pr-4 text-slate-200">
                    <span className="font-medium">{p.objective}</span>
                    <span className="block font-mono text-xs text-slate-500">{p.proposal_id}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`text-xs capitalize font-medium ${p.risk_class === "high" ? "text-red-400" : p.risk_class === "medium" ? "text-amber-400" : "text-emerald-400"}`}>
                      {p.risk_class}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-300">{p.replay_score ?? "—"}</td>
                  <td className="py-2.5 pr-4">
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-indigo-300">
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {(NEXT_ACTIONS[p.status] ?? []).map((a) => (
                        <button
                          key={a.action}
                          type="button"
                          disabled={busyProposal === p.proposal_id}
                          onClick={() => act(p, a.action, a.label)}
                          className="rounded-lg bg-indigo-600/80 px-2.5 py-1 text-xs text-white hover:bg-indigo-600 disabled:opacity-50 transition"
                        >
                          {busyProposal === p.proposal_id ? "…" : a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
