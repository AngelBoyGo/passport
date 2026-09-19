/**
 * Brain outcome history (Phase 40) — reads real OUTCOME memory for the Think
 * Tank's lesson extraction. Previously the scheduler fed synthetic hardcoded
 * history into extractLessons on every tick, so reported "insights" were fake.
 *
 * Mapping is honest about data quality: we currently have binary success per
 * decision (actionResult), not expected-vs-actual value, so expectedValue and
 * actualValue are 1/0 and lessons derive from real accuracy over real rows.
 */

import { prisma } from "@/lib/db";
import type { DecisionOutcome } from "@/lib/think-tank/kernel";

export function isOutcomeSuccessful(actionResult: string | null | undefined): boolean {
  if (!actionResult) return false;
  return actionResult === "ok" || actionResult.startsWith("ok:");
}

export async function getRecentBrainOutcomeHistory(limit = 20): Promise<DecisionOutcome[]> {
  const rows = await prisma.brainMemory.findMany({
    where: { kind: "OUTCOME" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, cycleId: true, action: true, actionResult: true },
  });

  return rows.map((r) => {
    const success = isOutcomeSuccessful(r.actionResult);
    return {
      decisionId: r.cycleId ?? r.id,
      expectedValue: 1,
      actualValue: success ? 1 : 0,
      success,
      lessonsLearned: "",
    };
  });
}
