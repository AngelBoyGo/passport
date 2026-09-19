/**
 * Replay engine (Phase 43) — "would this policy have helped last week?"
 *
 * Deterministic counterfactual: replays a candidate policy against the brain's
 * OWN recorded cycles (observations → decisions → measured evaluation outcomes)
 * and scores where the candidate would have differed.
 *
 * Per-cycle contribution to the score (explainable, monotonic):
 *   match                          → +1   (candidate inherits the measured result)
 *   diff where actual was NEGATIVE → +1   (candidate avoids a proven regression)
 *   diff where actual was POSITIVE → −1   (candidate displaces a proven win)
 *   diff where outcome unknown     → +0.3 (mild risk credit — could be better, unproven)
 * score = (sum + cycles) / (2 × cycles), clamped 0..1.
 *
 * Verdicts are conservative:
 *   REGRESS  — candidate displaces more proven wins than regressions it avoids.
 *              Auto-rejects the proposal.
 *   IMPROVE  — candidate avoids proven regressions without displacing wins.
 *   NEUTRAL  — identical decisions, or mixed/unproven differences.
 *
 * Pure simulation: no production writes, no money movement, no LLM calls.
 */

import { prisma } from "@/lib/db";
import { decideFromPolicy, normalizePolicyParams, type PolicyDecision, type PolicyParams } from "@/lib/brain/policy";
import type { AttributionResult } from "@/lib/brain/attribution";

export const REPLAY_WINDOW_DAYS = 7;
/** Upper bound of cycles compared per replay (bounded reads). */
export const REPLAY_MAX_CYCLES = 200;

export interface ReplayCycle {
  cycleId: string;
  datapoints: {
    integrity: { ok: boolean; issues: string[] };
    rails: { enabled: number; quarantined: number };
    disputes_open: number;
    /** Cycles since the previous research scan decision (derived from history). */
    cycles_since_research_scan: number | null;
  };
  actualAction: string | null;
  /** Measured attribution of the actual action, when the window has closed. */
  attribution: AttributionResult | null;
}

export interface ReplayCycleOutcome {
  cycleId: string;
  actual: string | null;
  candidate: string;
  match: boolean;
  contribution: number;
  outcomeClass: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNKNOWN";
}

export interface ReplayResult {
  replayId: string;
  proposalId: string;
  cyclesCompared: number;
  decisionMatches: number;
  negativeAvoided: number;
  positiveDisplaced: number;
  unknownDiffs: number;
  score: number;
  verdict: "IMPROVE" | "NEUTRAL" | "REGRESS";
  perCycle: ReplayCycleOutcome[];
}

export function scoreReplay(perCycle: ReplayCycleOutcome[]): Pick<
  ReplayResult,
  "cyclesCompared" | "decisionMatches" | "negativeAvoided" | "positiveDisplaced" | "unknownDiffs" | "score" | "verdict"
> {
  const cyclesCompared = perCycle.length;
  let decisionMatches = 0;
  let negativeAvoided = 0;
  let positiveDisplaced = 0;
  let unknownDiffs = 0;

  for (const c of perCycle) {
    if (c.match) {
      decisionMatches++;
      continue;
    }
    if (c.outcomeClass === "NEGATIVE") negativeAvoided++;
    else if (c.outcomeClass === "POSITIVE") positiveDisplaced++;
    else unknownDiffs++;
  }

  if (cyclesCompared === 0) {
    return { cyclesCompared: 0, decisionMatches: 0, negativeAvoided: 0, positiveDisplaced: 0, unknownDiffs: 0, score: 0.5, verdict: "NEUTRAL" };
  }

  let sum = 0;
  for (const c of perCycle) {
    if (c.match) sum += 1;
    else if (c.outcomeClass === "NEGATIVE") sum += 1;
    else if (c.outcomeClass === "POSITIVE") sum -= 1;
    else sum += 0.3;
  }
  const score = Math.round(Math.min(1, Math.max(0, (sum + cyclesCompared) / (2 * cyclesCompared))) * 1000) / 1000;

  let verdict: ReplayResult["verdict"];
  if (cyclesCompared > 0 && decisionMatches === cyclesCompared) verdict = "NEUTRAL"; // identical behavior
  else if (negativeAvoided > positiveDisplaced && unknownDiffs <= negativeAvoided) verdict = "IMPROVE";
  else if (positiveDisplaced > negativeAvoided) verdict = "REGRESS";
  else verdict = "NEUTRAL";

  return { cyclesCompared, decisionMatches, negativeAvoided, positiveDisplaced, unknownDiffs, score, verdict };
}

/** Pure: evaluates one cycle — candidate decision vs actual, with measured outcome. */
export function evaluateReplayCycle(
  cycle: ReplayCycle,
  policy: PolicyParams
): ReplayCycleOutcome {
  const candidate: PolicyDecision = decideFromPolicy(cycle.datapoints, policy);
  const match = cycle.actualAction === candidate.action;
  const outcomeClass =
    cycle.attribution?.result === "POSITIVE"
      ? "POSITIVE"
      : cycle.attribution?.result === "NEGATIVE"
        ? "NEGATIVE"
        : cycle.attribution?.result === "NEUTRAL"
          ? "NEUTRAL"
          : "UNKNOWN";

  let contribution = 0.3; // unknown diff
  if (match) contribution = 1;
  else if (outcomeClass === "NEGATIVE") contribution = 1;
  else if (outcomeClass === "POSITIVE") contribution = -1;
  else if (outcomeClass === "NEUTRAL") contribution = 0.3;

  return {
    cycleId: cycle.cycleId,
    actual: cycle.actualAction,
    candidate: candidate.action,
    match,
    contribution,
    outcomeClass,
  };
}

/** Loads the brain's recorded cycles (observation + decision + evaluation) for the window. */
export async function loadReplayHistory(windowDays: number = REPLAY_WINDOW_DAYS): Promise<ReplayCycle[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [observations, decisions, evaluations] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { kind: "OBSERVATION", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: REPLAY_MAX_CYCLES,
    }),
    prisma.brainMemory.findMany({
      where: { kind: "DECISION", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: REPLAY_MAX_CYCLES,
    }),
    prisma.brainMemory.findMany({
      where: { kind: "EVALUATION", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: REPLAY_MAX_CYCLES,
    }),
  ]);

  const decisionByCycle = new Map(
    decisions
      .filter((d) => d.cycleId)
      .map((d) => [d.cycleId as string, d.action])
  );
  const evalByCycle = new Map(
    evaluations
      .filter((e) => e.cycleId)
      .map((e) => [e.cycleId as string, (e.data ?? null) as unknown])
  );

  const cycles: ReplayCycle[] = [];
  for (const obs of observations) {
    if (!obs.cycleId) continue;
    const data = (obs.data ?? null) as unknown;
    if (!data || typeof data !== "object") continue;
    const dp = data as {
      integrity?: { ok?: boolean; issues?: string[] };
      rails?: { enabled?: number; quarantined?: number };
      disputes_open?: number;
    };
    cycles.push({
      cycleId: obs.cycleId,
      datapoints: {
        integrity: { ok: Boolean(dp.integrity?.ok), issues: Array.isArray(dp.integrity?.issues) ? dp.integrity!.issues! : [] },
        rails: { enabled: Number(dp.rails?.enabled ?? 0), quarantined: Number(dp.rails?.quarantined ?? 0) },
        disputes_open: Number(dp.disputes_open ?? 0),
        cycles_since_research_scan: null,
      },
      actualAction: decisionByCycle.get(obs.cycleId) ?? null,
      attribution: (evalByCycle.get(obs.cycleId) as AttributionResult | null) ?? null,
    });
  }

  // Derive research staleness chronologically (list is newest-first, so walk in
  // reverse). Staleness counts cycles since the previous research-type decision;
  // it resets to 0 AFTER a research cycle.
  let staleness: number | null = null;
  for (let i = cycles.length - 1; i >= 0; i--) {
    cycles[i].datapoints.cycles_since_research_scan = staleness;
    const action = cycles[i].actualAction;
    if (action === "RUN_RESEARCH_SCAN" || action === "RUN_EXTERNAL_RESEARCH") {
      staleness = 0;
    } else if (staleness != null) {
      staleness++;
    }
  }

  return cycles;
}

/**
 * Replays a proposal against recorded history and persists a ReplayRun.
 * Deterministic: same history + same params → same score, every time.
 */
export async function replayProposal(
  proposalId: string,
  params: unknown,
  windowDays: number = REPLAY_WINDOW_DAYS
): Promise<ReplayResult> {
  const policy = normalizePolicyParams(params);
  const history = await loadReplayHistory(windowDays);
  const perCycle = history.map((c) => evaluateReplayCycle(c, policy));
  const summary = scoreReplay(perCycle);

  const replayId = `replay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.replayRun.create({
    data: {
      replayId,
      proposalId,
      windowDays,
      cyclesCompared: summary.cyclesCompared,
      decisionMatches: summary.decisionMatches,
      negativeAvoided: summary.negativeAvoided,
      positiveDisplaced: summary.positiveDisplaced,
      unknownDiffs: summary.unknownDiffs,
      score: summary.score,
      verdict: summary.verdict,
      details: perCycle as unknown as object,
    },
  });

  return { replayId, proposalId, ...summary, perCycle };
}