/**
 * ANGEL Parity Redemption — the stability contract (Step 1 of the "real currency" track).
 *
 * A currency that CIRCULATES cannot also APPRECIATE: if holding beats spending, people hoard
 * and it dies as a medium of exchange. So ANGEL's payment role is defined as a STABLE contract:
 *
 *   - PARITY: 1 ANGEL is redeemable for a fixed reference value (PARITY_USD of audited reserve).
 *   - RESERVE ADEQUACY: the peg is only honored while the audited reserve covers circulating
 *     supply × PARITY_USD. If it doesn't, the system reports undercollateralization and caps
 *     redemption — it never silently breaks parity.
 *   - FEE, NOT SPREAD: redemption costs a small fee that accrues to the reserve/community (a
 *     circulation cost), not a punitive exit tax. Buying and selling at parity is what lets the
 *     token actually be used as money.
 *
 * Appreciation is deliberately NOT a property of ANGEL. It lives in a separate, compliance-gated
 * instrument (reserve shares / community dividend), never in the circulating payment token.
 */

import { MONETARY_PARAMS } from "@/lib/angelcoin/monetary";

/** Reference value of 1 ANGEL in USD of audited reserve (the parity anchor). */
export const PARITY_USD = MONETARY_PARAMS.P0;

/**
 * Redemption fee for the payment rail, in basis points. Goes to the reserve/community, not a
 * profit spread. Kept small (default 0.30%) so parity redemption is cheap enough to circulate.
 */
export const PARITY_REDEMPTION_FEE_BPS = (() => {
  const raw = Number(process.env.ANGL_PARITY_FEE_BPS);
  return Number.isFinite(raw) && raw >= 0 && raw < 10_000 ? Math.floor(raw) : 30;
})();

/** Machine-readable statement of the stability rules (self-describing / auditable). */
export const STABILITY_CONTRACT = {
  peg: `1 ANGEL = $${PARITY_USD.toFixed(2)} of audited reserve`,
  redemption: "at parity, minus a small reserve/community fee",
  backing: "reserve >= circulating supply × parity (100% backing)",
  appreciation: "none by design — a separate compliance-gated instrument carries appreciation",
} as const;

export interface RedemptionQuote {
  angelAmount: number;
  parValueUsd: number;
  grossUsd: number;
  feeBps: number;
  feeUsd: number;
  netUsd: number;
  supplyAngel: number;
  reserveUsd: number;
  requiredReserveUsd: number;
  /** reserveUsd / requiredReserveUsd (>= 1 means fully backed). 1 when there is no supply. */
  coverageRatio: number;
  reserveAdequate: boolean;
  /** Largest ANGEL redemption the current reserve can honor at parity (net of fee). */
  maxRedeemableAngel: number;
  redeemable: boolean;
  reason?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Quotes a parity redemption against the audited reserve. Pure and deterministic: the same
 * inputs always yield the same quote, so it can be unit-tested and independently reproduced.
 */
export function redemptionQuote(input: {
  angelAmount: number;
  supplyAngel: number;
  reserveUsd: number;
  feeBps?: number;
}): RedemptionQuote {
  const feeBps = input.feeBps ?? PARITY_REDEMPTION_FEE_BPS;
  const angelAmount = Math.max(0, Math.floor(input.angelAmount));
  const supplyAngel = Math.max(0, input.supplyAngel);
  const reserveUsd = Math.max(0, input.reserveUsd);

  const grossUsd = angelAmount * PARITY_USD;
  const feeUsd = (grossUsd * feeBps) / 10_000;
  const netUsd = grossUsd - feeUsd;

  const requiredReserveUsd = supplyAngel * PARITY_USD;
  const coverageRatio = requiredReserveUsd > 0 ? reserveUsd / requiredReserveUsd : 1;
  const reserveAdequate = coverageRatio >= 1;

  const netPerAngel = PARITY_USD * (1 - feeBps / 10_000);
  const maxRedeemableAngel = netPerAngel > 0 ? Math.floor(reserveUsd / netPerAngel) : 0;

  let redeemable = angelAmount > 0 && angelAmount <= maxRedeemableAngel;
  let reason: string | undefined;
  if (angelAmount <= 0) {
    reason = "amount must be positive";
    redeemable = false;
  } else if (!redeemable) {
    reason = reserveAdequate
      ? "redemption exceeds the reserve available for the requested amount"
      : "reserve is undercollateralized — redemption is capped until the reserve is replenished";
  }

  return {
    angelAmount,
    parValueUsd: PARITY_USD,
    grossUsd: round2(grossUsd),
    feeBps,
    feeUsd: round2(feeUsd),
    netUsd: round2(netUsd),
    supplyAngel,
    reserveUsd: round2(reserveUsd),
    requiredReserveUsd: round2(requiredReserveUsd),
    coverageRatio: round4(coverageRatio),
    reserveAdequate,
    maxRedeemableAngel,
    redeemable,
    reason,
  };
}

/** Aggregate backing status for reporting (e.g. the monetary receipt / trust surfaces). */
export interface ParityStatus {
  supplyAngel: number;
  reserveUsd: number;
  requiredReserveUsd: number;
  coverageRatio: number;
  reserveAdequate: boolean;
  /** Positive = buffer above the peg; negative = undercollateralized by this much. */
  surplusUsd: number;
}

export function parityStatus(input: { supplyAngel: number; reserveUsd: number }): ParityStatus {
  const supplyAngel = Math.max(0, input.supplyAngel);
  const reserveUsd = Math.max(0, input.reserveUsd);
  const requiredReserveUsd = supplyAngel * PARITY_USD;
  const coverageRatio = requiredReserveUsd > 0 ? reserveUsd / requiredReserveUsd : 1;
  return {
    supplyAngel,
    reserveUsd: round2(reserveUsd),
    requiredReserveUsd: round2(requiredReserveUsd),
    coverageRatio: round4(coverageRatio),
    reserveAdequate: coverageRatio >= 1,
    surplusUsd: round2(reserveUsd - requiredReserveUsd),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
