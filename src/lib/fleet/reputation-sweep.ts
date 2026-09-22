/**
 * Fleet reputation sweep — turns the PASSIVE reputation engine into a live
 * signal every dispatch tick, WITHOUT unbounded webhook spam.
 *
 * Input: the public-portal leaderboard rows (real AgentEvidence-derived
 * reputation scores + 30d failure rates — no synthetic numbers).
 * State: AgentInstance.reputationTier (last seen tier per agent).
 *
 * Signals (dispatched ONLY on a detected change):
 *   tier dropped           -> reputation.degraded
 *   tier came back higher  -> reputation.restored
 *   first reach gold+      -> reputation.milestone
 * A first-ever observation records the baseline tier and dispatches nothing.
 *
 * Degraded sweeps also surface a fleet-level note when an ACTIVE agent's
 * failure rate breaches 50% over a >=10-evidence window — the brain's
 * playbook sees it in the next cycle's OUTCOME data.
 */

import { prisma } from "@/lib/db";
import { getLeaderboard } from "@/lib/public-portal/portal-service";
import { evaluateAndDispatchReputationSignals } from "@/lib/webhooks/webhook-service";
import { TIER_ORDER, type ReputationTier } from "@/lib/reputation/compute-score";

/** Bounded: at most this many agents swept per tick. */
const MAX_SWEEP_PER_TICK = 100;

export interface SweepSignal {
  commitment: string;
  kind: "degraded" | "restored" | "milestone";
  from?: string;
  to: string;
}

/** Pure tier-delta logic — deterministic, no side effects. */
export function computeTierSignals(previous: string | null, next: string): SweepSignal | null {
  const prevIdx = previous ? TIER_ORDER.indexOf(previous as ReputationTier) : -1;
  const nextIdx = TIER_ORDER.indexOf(next as ReputationTier);
  if (nextIdx < 0) return null;
  if (prevIdx < 0) {
    // First observation: record baseline; a gold+ baseline IS a milestone.
    return nextIdx >= TIER_ORDER.indexOf("gold")
      ? { commitment: "", kind: "milestone", to: next }
      : null;
  }
  if (nextIdx > prevIdx) {
    return nextIdx >= TIER_ORDER.indexOf("gold")
      ? { commitment: "", kind: "milestone", from: previous || undefined, to: next }
      : { commitment: "", kind: "restored", from: previous || undefined, to: next };
  }
  if (nextIdx < prevIdx) return { commitment: "", kind: "degraded", from: previous || undefined, to: next };
  return null;
}

export interface SignalRow {
  commitment: string;
  previousTier: string | null;
  nextTier: string;
  failureRate: number;
  evidenceCount: number;
}

export function buildSignalPayload(row: SignalRow, signal: SweepSignal): {
  event: "reputation.degraded" | "reputation.restored" | "reputation.milestone";
  reason?: string;
  failure_rate?: number;
  milestone?: string;
} {
  if (signal.kind === "degraded") {
    return {
      event: "reputation.degraded",
      reason: `reputation_tier_drop:${signal.from}->${signal.to}`,
      failure_rate: row.failureRate,
    };
  }
  if (signal.kind === "restored") {
    return {
      event: "reputation.restored",
      reason: `reputation_tier_recovered:${signal.from}->${signal.to}`,
    };
  }
  return { event: "reputation.milestone", milestone: signal.to };
}

/**
 * One sweep: reads leaderboard rows, diffs tiers, dispatches webhooks on
 * change only (bounded to 100 agents/tick), persists the new tier.
 */
export async function runReputationSweepTick(options: { lease?: boolean } = {}): Promise<{
  ran_lease: boolean;
  swept: number;
  signals_dispatched: Array<{ commitment: string; kind: string; to: string }>;
}> {
  if (options.lease === false) {
    return sweepOnce();
  }
  let ownerId: string | null = null;
  const { acquireLease, releaseLease } = await import("@/lib/scheduler/lease");
  try {
    const lease = await acquireLease("fleet-reputation-sweep");
    if (!lease) {
      return { ran_lease: false, swept: 0, signals_dispatched: [] };
    }
    ownerId = lease.ownerId;
    return await sweepOnce();
  } finally {
    if (ownerId) {
      await releaseLease("fleet-reputation-sweep", ownerId).catch(() => undefined);
    }
  }
}

async function sweepOnce() {
  const fleetRows = await prisma.agentInstance.findMany({
    where: { status: { in: ["active", "idle", "provisioning"] } },
    select: { id: true, commitment: true, operatorId: true, reputationTier: true, status: true },
    take: MAX_SWEEP_PER_TICK,
  });
  if (fleetRows.length === 0) {
    return { ran_lease: true, swept: 0, signals_dispatched: [] };
  }

  let board: Array<Record<string, unknown>> = [];
  try {
    board = (await getLeaderboard({ limit: MAX_SWEEP_PER_TICK })) as unknown as Array<Record<string, unknown>>;
  } catch {
    board = []; // leaderboard outage -> nothing to diff this tick, fail soft
  }
  const byCommitment = new Map(
    board.map((r) => [String(r.agent_commitment_hash ?? "").toLowerCase(), r])
  );

  const dispatches: Array<{ commitment: string; kind: string; to: string }> = [];
  for (const instance of fleetRows) {
    const boardRow = byCommitment.get(instance.commitment.toLowerCase());
    if (!boardRow) continue; // no evidence footprint yet — nothing to know
    const nextTier = String(boardRow.reputation_tier ?? "");
    if (!nextTier) continue;
    if (nextTier === instance.reputationTier) continue; // only changes dispatch

    const failureRate = Number(boardRow.failure_rate_rolling_30d ?? 0);
    const evidenceCount = Number(boardRow.evidence_count ?? 0);
    const signal = computeTierSignals(instance.reputationTier, nextTier);
    if (signal) {
      const payload = buildSignalPayload(
        {
          commitment: instance.commitment,
          previousTier: instance.reputationTier,
          nextTier,
          failureRate,
          evidenceCount,
        },
        signal
      );
      await evaluateAndDispatchReputationSignals(instance.operatorId, instance.commitment, payload as never).catch(
        () => undefined
      );
      dispatches.push({ commitment: instance.commitment, kind: signal.kind, to: nextTier });
    }
    await prisma.agentInstance.update({
      where: { id: instance.id },
      data: { reputationTier: nextTier, lastSweepAt: new Date() },
    }).catch(() => undefined);
  }

  return { ran_lease: true, swept: fleetRows.length, signals_dispatched: dispatches };
}
