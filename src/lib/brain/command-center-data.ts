/**
 * Command-center data aggregation (Phase 44).
 *
 * Single source of truth for the brain's "watch it think" snapshot. Consumed by:
 *   - GET /api/v1/raillab/brain/command-center (ISSUER API-key machine access)
 *   - GET /api/admin/brain (executive-admin session browser access)
 *
 * Pure read-only aggregation over brain memory + proposals. Bounded queries only.
 */

import { prisma } from "@/lib/db";
import { BRAIN_ACTIONS } from "@/lib/brain/command-brain";

export interface CommandCenterData {
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

export async function buildCommandCenterData(): Promise<CommandCenterData> {
  const since24h = new Date(Date.now() - 24 * 3_600_000);

  const [recentRows, evaluations, proposalCounts, canary, outcomeCounts, memoryCounts] = await Promise.all([
    prisma.brainMemory.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.brainMemory.findMany({
      where: { kind: "EVALUATION" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.improvementProposal.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.improvementProposal.findFirst({ where: { status: "CANARY" }, orderBy: { updatedAt: "desc" } }),
    prisma.brainMemory.groupBy({
      by: ["actionResult"],
      where: { kind: "OUTCOME", createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.brainMemory.groupBy({ by: ["kind"], _count: { _all: true } }),
  ]);

  const lastObservation = recentRows.find((r) => r.kind === "OBSERVATION");
  const lastDecision = recentRows.find((r) => r.kind === "DECISION");
  const lastOutcome = recentRows.find((r) => r.kind === "OUTCOME");

  // Health trajectory: last up to 5 observations, oldest-first.
  const healthTrajectory = recentRows
    .filter((r) => r.kind === "OBSERVATION" && r.healthScore != null)
    .slice(0, 5)
    .map((r) => ({ at: r.createdAt.toISOString(), health: r.healthScore as number }))
    .reverse();

  const attributionResults = evaluations.map((e) => {
    const d = (e.data ?? null) as
      | { action?: string; delta?: number; result?: string; confidence?: number; confounders?: string[] }
      | null;
    return {
      cycle_id: e.cycleId,
      action: d?.action ?? e.action,
      delta: d?.delta ?? null,
      result: d?.result ?? null,
      confidence: d?.confidence ?? null,
      confounders: d?.confounders ?? [],
      at: e.createdAt.toISOString(),
    };
  });

  const statusCounts: Record<string, number> = {};
  for (const g of proposalCounts) statusCounts[g.status] = g._count._all;

  const outcomeByClass: Record<string, number> = {};
  for (const g of outcomeCounts) {
    if (g.actionResult) outcomeByClass[g.actionResult] = g._count._all;
  }

  return {
    current_run: {
      last_observation: lastObservation
        ? { cycle_id: lastObservation.cycleId, summary: lastObservation.summary, at: lastObservation.createdAt.toISOString() }
        : null,
      last_decision: lastDecision
        ? { cycle_id: lastDecision.cycleId, action: lastDecision.action, rationale: lastDecision.summary, at: lastDecision.createdAt.toISOString() }
        : null,
      last_outcome: lastOutcome
        ? { cycle_id: lastOutcome.cycleId, action: lastOutcome.action, result: lastOutcome.actionResult, at: lastOutcome.createdAt.toISOString() }
        : null,
      health_trajectory: healthTrajectory,
    },
    impact: {
      recent_attributions: attributionResults,
    },
    learning: {
      proposals_by_status: statusCounts,
      canary: canary
        ? { proposal_id: canary.proposalId, objective: canary.objective, replay_score: canary.replayScore, since: canary.updatedAt.toISOString() }
        : null,
    },
    safety: {
      action_allowlist: [...BRAIN_ACTIONS],
      money_moving_actions: 0, // structural: the allowlist contains no money-moving operation
      outcomes_24h_by_class: outcomeByClass,
      memory_rows_by_kind: memoryCounts.reduce<Record<string, number>>((acc, g) => {
        acc[g.kind] = g._count._all;
        return acc;
      }, {}),
    },
    timestamp: new Date().toISOString(),
  };
}