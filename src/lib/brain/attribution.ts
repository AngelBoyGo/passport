/**
 * Outcome attribution (Phase 41) — the brain proves impact instead of claiming it.
 *
 * Previously "success" meant `actionResult === "ok"` (execution success, not
 * business success). This module upgrades the learning loop: after each cycle,
 * the most recent executed action is evaluated against the health score it was
 * *supposed* to improve.
 *
 * Method (honest-causal, deliberately conservative):
 *   - Baseline: the OBSERVATION from the same cycle as the action (pre-action health).
 *   - Post: the newest OBSERVATION recorded after the action (window closed only
 *     when a later cycle has observed again).
 *   - Delta: post − baseline health.
 *   - Confounders: any OTHER successful non-NOOP action inside the same window —
 *     each one halves confidence (1 / (1 + confounders)) and is listed by cycle.
 *   - Result: POSITIVE / NEGATIVE / NEUTRAL against a ±0.02 significance band.
 *
 * Actions that failed, were skipped, or were NOOP are never evaluated — they did
 * nothing whose effect could be measured. Each action is evaluated at most once;
 * evaluations persist as EVALUATION memory rows (kind is a free string — no
 * migration needed) keyed by the evaluated cycle's ID.
 */

import { prisma } from "@/lib/db";
import { isOutcomeSuccessful } from "@/lib/brain/outcomes";

/** Significance band: deltas inside ±0.02 are attributed as NEUTRAL. */
export const ATTRIBUTION_SIGNIFICANCE_BAND = 0.02;

/** Memory rows scanned per evaluation (desc by createdAt). */
const ATTRIBUTION_READ_LIMIT = 100;

/** Previously-persisted evaluations scanned to prevent re-evaluation. */
const EVALUATION_SCAN_LIMIT = 50;

export interface AttributionMemoryRow {
  id: string;
  cycleId: string | null;
  kind: string;
  action: string | null;
  actionResult: string | null;
  healthScore: number | null;
  createdAt: Date;
}

export interface AttributionResult {
  /** cycleId of the evaluated action's cycle. */
  evaluated_cycle_id: string;
  action: string;
  baseline_health: number;
  post_health: number;
  delta: number;
  result: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  /** 1.0 = clean single-action window; lower = confounded. */
  confidence: number;
  /** Cycle IDs of other successful actions inside the attribution window. */
  confounders: string[];
  /** Minutes between the action and the post observation. */
  window_minutes: number;
}

function isEvaluableAction(action: string | null): action is string {
  return Boolean(action) && action !== "NOOP";
}

/**
 * Pure attribution computation over memory rows ordered newest-first.
 * Returns null when there is nothing to evaluate or the evidence is incomplete —
 * never fabricates an attribution from missing baselines or open windows.
 */
export function computeAttribution(
  rowsDesc: AttributionMemoryRow[],
  evaluatedCycleIds: ReadonlySet<string> = new Set()
): AttributionResult | null {
  // Try newest first, but skip incomplete/orphaned candidates so one malformed
  // row cannot permanently block attribution of older valid actions.
  for (let candIdx = 0; candIdx < rowsDesc.length; candIdx++) {
    const candidate = rowsDesc[candIdx];
    if (
      candidate.kind !== "OUTCOME" ||
      !isEvaluableAction(candidate.action) ||
      !isOutcomeSuccessful(candidate.actionResult) ||
      !candidate.cycleId ||
      evaluatedCycleIds.has(candidate.cycleId)
    ) {
      continue;
    }

    let baseline: AttributionMemoryRow | undefined;
    for (let i = candIdx + 1; i < rowsDesc.length; i++) {
      const r = rowsDesc[i];
      if (r.kind === "OBSERVATION" && r.cycleId === candidate.cycleId) {
        baseline = r;
        break;
      }
    }
    if (!baseline || baseline.healthScore == null) continue;

    let post: AttributionMemoryRow | undefined;
    for (let i = 0; i < candIdx; i++) {
      const r = rowsDesc[i];
      if (r.kind === "OBSERVATION" && r.healthScore != null) {
        post = r;
        break;
      }
    }
    if (!post) continue;
    const postHealth = post.healthScore;
    if (postHealth == null) continue;

    const confounders: string[] = [];
    for (const r of rowsDesc) {
      if (
        r.kind === "OUTCOME" &&
        isEvaluableAction(r.action) &&
        isOutcomeSuccessful(r.actionResult) &&
        r.cycleId !== candidate.cycleId &&
        r.createdAt.getTime() >= baseline.createdAt.getTime() &&
        r.createdAt.getTime() <= post.createdAt.getTime()
      ) {
        confounders.push(r.cycleId ?? r.id);
      }
    }

    const delta = Math.round((postHealth - baseline.healthScore) * 1000) / 1000;
    const result =
      delta > ATTRIBUTION_SIGNIFICANCE_BAND
        ? "POSITIVE"
        : delta < -ATTRIBUTION_SIGNIFICANCE_BAND
          ? "NEGATIVE"
          : "NEUTRAL";
    const confidence = Math.round((1 / (1 + confounders.length)) * 100) / 100;
    const windowMinutes = Math.max(
      0,
      Math.round((post.createdAt.getTime() - candidate.createdAt.getTime()) / 60_000)
    );

    return {
      evaluated_cycle_id: candidate.cycleId,
      action: candidate.action,
      baseline_health: baseline.healthScore,
      post_health: postHealth,
      delta,
      result,
      confidence,
      confounders,
      window_minutes: windowMinutes,
    };
  }

  return null;
}

/**
 * Evaluates the most recent attributable action and persists an EVALUATION row.
 * Returns null when nothing is attributable yet. Persistence is best-effort —
 * attribution is learning telemetry, not a safety audit; failures are logged,
 * never thrown, and never block the cycle.
 */
export async function evaluateRecentOutcomes(): Promise<AttributionResult | null> {
  try {
    const [rowsDesc, priorEvaluations] = await Promise.all([
      prisma.brainMemory.findMany({
        orderBy: { createdAt: "desc" },
        take: ATTRIBUTION_READ_LIMIT,
        select: {
          id: true,
          cycleId: true,
          kind: true,
          action: true,
          actionResult: true,
          healthScore: true,
          createdAt: true,
        },
      }),
      prisma.brainMemory.findMany({
        where: { kind: "EVALUATION" },
        orderBy: { createdAt: "desc" },
        take: EVALUATION_SCAN_LIMIT,
        select: { cycleId: true },
      }),
    ]);

    const evaluatedCycleIds = new Set(
      priorEvaluations.map((e) => e.cycleId).filter((id): id is string => Boolean(id))
    );

    const attribution = computeAttribution(
      rowsDesc as AttributionMemoryRow[],
      evaluatedCycleIds
    );
    if (!attribution) return null;

    // The bounded scan is only an optimization. This direct lookup prevents
    // duplicate evaluation after an old row falls out of the scan window.
    const alreadyEvaluated = await prisma.brainMemory.findFirst({
      where: { kind: "EVALUATION", cycleId: attribution.evaluated_cycle_id },
      select: { id: true },
    });
    if (alreadyEvaluated) return null;

    const sign = attribution.delta >= 0 ? "+" : "";
    const summary =
      `attrib ${attribution.action} ${sign}${attribution.delta} ` +
      `(${attribution.result}) conf=${attribution.confidence}` +
      (attribution.confounders.length
        ? ` confounders=${attribution.confounders.length}`
        : "");

    await prisma.brainMemory
      .create({
        data: {
          cycleId: attribution.evaluated_cycle_id,
          kind: "EVALUATION",
          summary,
          data: attribution as unknown as object,
          healthScore: attribution.post_health,
        },
      })
      .catch((err: unknown) => {
        console.warn(
          "[attribution] Evaluation write failed (best-effort):",
          err instanceof Error ? err.message : String(err)
        );
      });

    return attribution;
  } catch (err) {
    console.warn(
      "[attribution] Evaluation read failed (best-effort):",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
