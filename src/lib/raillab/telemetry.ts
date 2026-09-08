/**
 * Rail execution telemetry & SLA contract (Phase 20).
 *
 * Every ENABLED rail settlement writes a `RailTelemetry` row with a per-rail monotonic
 * `seq`. The SLA contract is explicit: a settlement is a breach when its error tranche is
 * non-NONE, its latency exceeds the p95 budget, or duplicate-callback hits exceed 10% of
 * settlements in the rolling window. `autoQuarantineFailingRails` (factory-agent) consumes
 * `isSlaBreach` to enforce the 3-consecutive-breach rule.
 */

import { prisma } from "@/lib/db";

/** p95 latency budget before a settlement is flagged as an SLA breach. */
export const RAIL_P95_MS = 3000;
/** Max duplicate-callback ratio (dedupeHits / settlementCount) before flagging. */
export const DEDUPE_RATIO_LIMIT = 0.10;

export interface SettlementTelemetry {
  latencyMs: number;
  volumeUnits: number;
  dedupeHits: number;
  errorTranche: string;
  settlementCount: number;
}

/** A settlement is an SLA breach under any of three explicit conditions. */
export function isSlaBreach(t: {
  latencyMs: number;
  dedupeHits: number;
  errorTranche: string;
  settlementCount: number;
}): boolean {
  if (t.errorTranche !== "NONE") return true;
  if (t.latencyMs > RAIL_P95_MS) return true;
  if (t.settlementCount > 0 && t.dedupeHits / t.settlementCount > DEDUPE_RATIO_LIMIT) {
    return true;
  }
  return false;
}

/**
 * Appends a settlement telemetry row with a monotonic seq per railKey. Returns the new seq.
 */
export async function recordSettlement(
  railKey: string,
  input: SettlementTelemetry
): Promise<number> {
  const last = await prisma.railTelemetry.findFirst({
    where: { railKey },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  await prisma.railTelemetry.create({
    data: {
      railKey,
      seq,
      latencyMs: input.latencyMs,
      volumeUnits: input.volumeUnits,
      dedupeHits: input.dedupeHits,
      errorTranche: input.errorTranche,
      settlementCount: input.settlementCount,
    },
  });
  return seq;
}

/** Returns the most recent settlement telemetry for a rail (tail). */
export async function getRailTelemetry(railKey: string, limit = 50) {
  return prisma.railTelemetry.findMany({
    where: { railKey },
    orderBy: { seq: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
