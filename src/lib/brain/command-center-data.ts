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
import { PERSONAS, personaModel } from "@/lib/brain/personas";
import { resolveTierModel, DEFAULT_TIER_MODEL } from "@/lib/llm/tiers";

/** Static descriptor for one persona, so the UI can show its exact model. */
export interface PersonaDescriptor {
  id: string;
  name: string;
  tier: string;
  /** Resolved model id (env override honoured) — the exact id sent to the gateway. */
  model: string;
  /** True for the self-hosted tier (MORE). */
  local: boolean;
}

/** One persisted turn of the most recent Plan → Critique → Revise → Commit dialogue. */
export interface DialogueTurnView {
  persona: string;
  role: string;
  content: string;
  confidence: number | null;
  /** Per-turn model-call duration in ms (null when not recorded). */
  ms: number | null;
}

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
  /** The four brains the UI renders (MARS/MUSE/MORE) with their resolved models. */
  personas: PersonaDescriptor[];
  /** The latest committed dialogue run, if any (drives per-persona status). */
  last_dialogue: {
    cycle_id: string | null;
    mission_id: string;
    at: string;
    turns: DialogueTurnView[];
  } | null;
  timestamp: string;
}

function mapDialogueTurns(dialogue: unknown): DialogueTurnView[] {
  if (!Array.isArray(dialogue)) return [];
  return dialogue
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
    .map((t) => ({
      persona: String(t.persona ?? "unknown"),
      role: String(t.role ?? "turn"),
      content: typeof t.content === "string" ? t.content : JSON.stringify(t.content ?? ""),
      confidence:
        typeof t.confidence === "number" && Number.isFinite(t.confidence) ? t.confidence : null,
      ms: typeof t.ms === "number" && Number.isFinite(t.ms) ? t.ms : null,
    }));
}

/** The orchestrator row (neuron tier). Never throws on a bad env override. */
function resolveNeuronModel(): string {
  try {
    return resolveTierModel("neuron");
  } catch {
    return DEFAULT_TIER_MODEL.neuron;
  }
}

/** MARS, MUSE, MORE (from config) + the neuron-tier Brain, with resolved models. */
function describePersonas(): PersonaDescriptor[] {
  return [
    ...Object.values(PERSONAS).map((p) => ({
      id: p.id,
      name: p.name,
      tier: p.tier,
      model: personaModel(p),
      local: p.tier === "local",
    })),
    { id: "brain", name: "Brain", tier: "neuron", model: resolveNeuronModel(), local: false },
  ];
}

export async function buildCommandCenterData(): Promise<CommandCenterData> {  const since24h = new Date(Date.now() - 24 * 3_600_000);

  const [recentRows, evaluations, proposalCounts, canary, outcomeCounts, memoryCounts, recentPlans] = await Promise.all([
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
    // Latest dialogue transcripts (MissionPlan.dialogue). Bounded take; the most
    // recent plan carrying turns is the run the UI shows. Reading existing rows
    // only — no orchestration change.
    prisma.missionPlan.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { cycleId: true, missionId: true, dialogue: true, createdAt: true },
    }),
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
    personas: describePersonas(),
    last_dialogue: (() => {
      const plan = recentPlans.find((p) => Array.isArray(p.dialogue) && (p.dialogue as unknown[]).length > 0);
      if (!plan) return null;
      return {
        cycle_id: plan.cycleId,
        mission_id: plan.missionId,
        at: plan.createdAt.toISOString(),
        turns: mapDialogueTurns(plan.dialogue),
      };
    })(),
    timestamp: new Date().toISOString(),
  };
}