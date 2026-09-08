/**
 * Sahel Fiat Fix (FCFA/XOF → USD) oracle — Phase 18.
 *
 * Provides the canonical XOF↔USD conversion used by the mobile-money on-ramp. Guards:
 *   - Staleness: a fix older than MAX_FIX_AGE_MS refuses on-ramp.
 *   - Out-of-band: a fix that deviates more than FIX_BAND_PCT from the configured
 *     reference rate refuses on-ramp, closing the arbitrage window on a dirty rate.
 */

import { prisma } from "@/lib/db";

export const XOF_CURRENCY = "XOF";
export const MAX_FIX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
export const FIX_BAND_PCT = 2.5; // ±2.5% against reference
/** Reference XOF/USD fix used as the band anchor when none is configured. */
export const DEFAULT_XOF_REFERENCE_RATE_USD = 1 / 600.0;

export interface FiatFixResult {
  currency: string;
  rateUsdPerUnit: number;
  source: string;
  validFrom: Date;
  expiresAt: Date;
  /** Infinity if the epoch / 1 XOF floor is below the minimum ANGEL atom. */
  angelRate: number;
}

/**
 * XOF amount → ANGEL credit at the canonical peg.
 *   1 ANGEL = $5.00 USD; agent receives floor(xofAmount / (rateUsdPerXof / 5)).
 */
export function xofToAngel(xofAmount: number, rateUsdPerXof: number): number {
  if (!Number.isFinite(xofAmount) || xofAmount <= 0) return 0;
  if (!Number.isFinite(rateUsdPerXof) || rateUsdPerXof <= 0) return 0;
  const usdValue = xofAmount * rateUsdPerXof;
  return Math.floor(usdValue / 5.0);
}

/**
 * Loads the latest XOF fix from the database, enforces staleness + band, and returns
 * the conversion. Throws when no fix exists, it is stale, or it is out of band.
 */
export async function getFiatFix(
  currency = XOF_CURRENCY,
  referenceRateUsd: number = DEFAULT_XOF_REFERENCE_RATE_USD
): Promise<FiatFixResult> {
  const fix = await prisma.fiatFix.findFirst({
    where: { currency },
    orderBy: { validFrom: "desc" },
  });

  if (!fix) {
    throw new Error(`No fiat fix is published for ${currency}; on-ramp refused`);
  }

  const now = Date.now();
  if (now > fix.expiresAt.getTime()) {
    throw new Error(`Fiat fix for ${currency} is stale (older than 24h); on-ramp refused`);
  }
  if (now < fix.validFrom.getTime()) {
    throw new Error(`Fiat fix for ${currency} is not yet valid; on-ramp refused`);
  }

  const bandPct = Math.abs(fix.rateUsdPerUnit - referenceRateUsd) / referenceRateUsd * 100;
  if (bandPct > FIX_BAND_PCT) {
    throw new Error(
      `Fiat fix for ${currency} deviates ${bandPct.toFixed(2)}% from reference (band ±${FIX_BAND_PCT}%); on-ramp refused`
    );
  }

  return {
    currency,
    rateUsdPerUnit: fix.rateUsdPerUnit,
    source: fix.source,
    validFrom: fix.validFrom,
    expiresAt: fix.expiresAt,
    angelRate: Number((fix.rateUsdPerUnit / 5.0).toFixed(8)),
  };
}

/**
 * Pure staleness/band check — useful for deterministic tests without a database.
 */
export function isXofFixUsable(
  rateUsdPerUnit: number,
  opts?: {
    referenceRateUsd?: number;
    bandPct?: number;
  }
): { usable: boolean; deviationPct: number } {
  if (!Number.isFinite(rateUsdPerUnit) || rateUsdPerUnit <= 0) {
    return { usable: false, deviationPct: Number.POSITIVE_INFINITY };
  }
  const ref = opts?.referenceRateUsd ?? DEFAULT_XOF_REFERENCE_RATE_USD;
  const band = opts?.bandPct ?? FIX_BAND_PCT;
  const deviationPct = Math.abs(rateUsdPerUnit - ref) / ref * 100;
  return { usable: deviationPct <= band, deviationPct: Number(deviationPct.toFixed(4)) };
}