/**
 * Canonical fiat-reserve accounting.
 *
 * AUDIT FIX (C1/C2/M7): three public surfaces each computed "reserve" differently
 * — two used `Math.abs(deltaMicros)` over an INFLOW-ONLY kind list, so a
 * redemption outflow never reduced the reserve and any negative delta INCREASED
 * it. The result: coverage/backing could only be overstated. This module is the
 * single signed source of truth.
 *
 * INVARIANT: reserve = Σ signed(deltaMicros) over BOTH inflow and outflow kinds,
 * floored at 0. A redemption lowers the reserve.
 */

import { prisma } from "@/lib/db";

/** Reserve-affecting ledger kinds. Outflows (redemptions) are signed NEGATIVE. */
export const RESERVE_KINDS = [
  "stablecoin_topup",
  "angelcoin_topup",
  "angelcoin_on_behalf",
  "external_revenue",
  "rwa_redemption_queued",
  "angl_redemption",
  "sahel_onramp",
] as const;

/**
 * Computes the fiat treasury reserve in USD from signed ledger deltas.
 * Floored at 0 (a reserve cannot be negative on paper). NO Math.abs.
 */
export function fiatReserveUsdFromEntries(entries: { deltaMicros: number }[]): number {
  const micros = entries.reduce((sum, e) => sum + e.deltaMicros, 0);
  return Math.max(0, Number((micros / 10_000 / 100).toFixed(2)));
}

/** Loads the reserve-affecting entries and returns the signed USD reserve. */
export async function loadFiatReserveUsd(): Promise<number> {
  const entries = await prisma.operatorLedgerEntry.findMany({
    where: { kind: { in: [...RESERVE_KINDS] } },
    select: { deltaMicros: true },
  });
  return fiatReserveUsdFromEntries(entries);
}
