"use client";

import { useCallback, useEffect, useState } from "react";

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

const REFRESH_MS = 60_000;

/** Legal transition per proposal status (mirrors the service-side machine). */
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
    case "POSITIVE": return { label: "POSITIVE", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
    case "NEGATIVE": return { label: "NEGATIVE", className: "bg-red-500/15 text-red-300 border-red-500/40" };
    case "NEUTRAL": return { label: "NEUTRAL", className: "bg-slate-500/15 text-slate-300 border-slate-500/40" };
    default: return { label: result ?? "UNKNOWN", className: "bg-slate-500/15 text-slate-400 border-slate-500/40" };
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-white/10 bg-slate-900/60 p-5"
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminBrainPage() {
  const [data, setData] = useState<BrainData | null>(null);
  const [error, setError] = useState("");
  const [busyProposal, setBusyProposal] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/brain", { cache: "no-store", credentials: "same-origin" });
    if (res.status === 403) throw new Error("Executive admin access required (ADMIN_OPERATOR_EMAILS).");
    if (!res.ok) throw new Error(`Unable to load brain state (${res.status})`);
    const json = await res.json();
    setData(json);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
    load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    const timer = setInterval(() => {
      load().catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function loadProposals(): Promise<Proposal[]> {
    const res = await fetch("/api/admin/brain/proposals?limit=25", { cache: "no-store", credentials: "same-origin" });
    if (res.status === 403) throw new Error("Executive admin access required (ADMIN_OPERATOR_EMAILS).");
    if (!res.ok) throw new Error(`Unable to load proposals (${res.status})`);
    const json = await res.json();
    return json.proposals ?? [];
  }

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
      await load().catch(() => {});
    } finally {
      setBusyProposal(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6" role="alert">
        <p className="text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError("");
            load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
          }}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">Loading brain state…</div>;
  }

  const run = data.current_run;
  const trajectory = run.health_trajectory;

  return (
    <div className="space-y-6" aria-label="AI brain command center">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Command Brain</h1>
          <p className="text-sm text-slate-400">
            The autonomous supervisor of Passport, AngelCoin, and the Sahel corridor.
            Cycles every 10 minutes. Updated {new Date(data.timestamp).toLocaleTimeString()}.
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          money-moving actions: {data.safety.money_moving_actions}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Current run">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-400">Last observation</dt>
              <dd className="text-slate-200">
                {run.last_observation ? `${run.last_observation.summary} · ${new Date(run.last_observation.at).toLocaleTimeString()}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Last decision</dt>
              <dd className="text-slate-200">
                {run.last_decision ? (
                  <>
                    <span className="font-mono text-indigo-300">{run.last_decision.action}</span>
                    <span className="block text-xs text-slate-400">{run.last_decision.rationale}</span>
                  </>
                ) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Last outcome</dt>
              <dd className="text-slate-200">
                {run.last_outcome ? `${run.last_outcome.action} → ${run.last_outcome.result}` : "—"}
              </dd>
            </div>
          </dl>

          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Health trajectory (last {trajectory.length} observations)
          </h3>
          {trajectory.length === 0 ? (
            <p className="text-xs text-slate-500">No health data yet.</p>
          ) : (
            <div className="flex h-16 items-end gap-2" role="img" aria-label={`Health trajectory: ${trajectory.map((t) => t.health).join(", ")}`}>
              {trajectory.map((t) => (
                <div key={t.at} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={
                      "w-full rounded-t " +
                      (t.health >= 0.8 ? "bg-emerald-500/60" : t.health >= 0.5 ? "bg-amber-500/60" : "bg-red-500/60")
                    }
                    style={{ height: `${Math.max(4, t.health * 100)}%` }}
                    title={`${t.health} at ${new Date(t.at).toLocaleTimeString()}`}
                  />
                  <span className="text-[10px] text-slate-500">{t.health}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Impact — measured attributions">
          {data.impact.recent_attributions.length === 0 ? (
            <p className="text-xs text-slate-500">
              No attributions yet. They appear after the brain takes a non-NOOP action and the
              next cycle measures its health effect.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.impact.recent_attributions.slice(0, 5).map((a) => {
                const badge = resultBadge(a.result);
                return (
                  <li key={a.at} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <span className="font-mono text-xs text-indigo-300">{a.action}</span>
                    <span className="text-xs text-slate-300">
                      {a.delta != null ? `${a.delta >= 0 ? "+" : ""}${a.delta}` : "?"}{" "}
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${badge.className}`}>{badge.label}</span>
                      {a.confidence != null && <span className="ml-1 text-slate-500">conf {a.confidence}</span>}
                      {a.confounders && a.confounders.length > 0 && (
                        <span className="ml-1 text-amber-400/80">({a.confounders.length} confounder{a.confounders.length > 1 ? "s" : ""})</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Learning — proposal pipeline">
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(data.learning.proposals_by_status).length === 0 ? (
              <p className="text-xs text-slate-500">
                No proposals yet. They are generated automatically when the brain runs a research
                scan.
              </p>
            ) : (
              Object.entries(data.learning.proposals_by_status).map(([status, count]) => (
                <span key={status} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
                  {status}: {count}
                </span>
              ))
            )}
          </div>
          {data.learning.canary && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <p className="font-semibold">Canary in shadow (never executes)</p>
              <p className="mt-1 text-slate-300">{data.learning.canary.objective}</p>
              <p className="mt-1 text-slate-500">
                replay score: {data.learning.canary.replay_score ?? "n/a"} · since {new Date(data.learning.canary.since).toLocaleString()}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Safety">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-400">Action allowlist ({data.safety.action_allowlist.length})</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {data.safety.action_allowlist.map((a) => (
                  <span key={a} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{a}</span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Outcome classes (24h)</dt>
              <dd className="text-slate-200">
                {Object.entries(data.safety.outcomes_24h_by_class).length === 0
                  ? "no cycles in the last 24h"
                  : Object.entries(data.safety.outcomes_24h_by_class).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <ProposalsTable
        loadProposals={loadProposals}
        busyProposal={busyProposal}
        onTransition={transition}
      />
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
    <section aria-label="Proposals" className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Improvement proposals — steer the promotion pipeline
      </h2>
      {proposals === null ? (
        <p className="text-sm text-slate-400">Loading proposals…</p>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-slate-400">No proposals yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-4">Objective</th>
                <th className="py-2 pr-4">Risk</th>
                <th className="py-2 pr-4">Replay score</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.proposal_id} className="border-b border-white/5">
                  <td className="py-2 pr-4 text-slate-200">
                    {p.objective}
                    <span className="block text-xs text-slate-500">{p.proposal_id}</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-300">{p.risk_class}</td>
                  <td className="py-2 pr-4 text-slate-300">{p.replay_score ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-indigo-300">
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {(NEXT_ACTIONS[p.status] ?? []).map((a) => (
                        <button
                          key={a.action}
                          type="button"
                          disabled={busyProposal === p.proposal_id}
                          onClick={() => act(p, a.action, a.label)}
                          className="rounded-lg bg-indigo-600/80 px-2.5 py-1 text-xs text-white hover:bg-indigo-600 disabled:opacity-50"
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