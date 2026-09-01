/**
 * ANGEL Monetary System — rate oracle, revaluation engine, bundle catalog.
 *
 * Implements the ANGEL Monetary Spec v1.1:
 *   - 1 ANGEL = $5.00 at launch (Moderate scenario)
 *   - Bundles: {5, 9, 17, 33} — each is 2^k + 1, guaranteeing exactly
 *     1 stranded ANGEL against any feature price in {2, 4, 8, 16}
 *   - Feature grid: {2, 4, 8, 16, 32} — all even, min 2, parity invariant
 *   - Weekly epoch revaluation with damping (α=0.25) and band (−2%/+3%)
 *   - Reserve floor: P_red = ρR/S (never below)
 *   - Signed rate receipts: ed25519, publicly verifiable
 *   - Platform settlement at P_red = P(t) × (1 − σ), σ = 10%
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sign } from "@noble/ed25519";
import { hexToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

// ── Launch Parameters (Moderate Scenario, Spec §8.5) ──

export const MONETARY_PARAMS = {
  P0: 5.0,                    // launch rate: $5.00 per ANGEL
  alpha: 0.25,                // damping factor
  bandDown: 0.98,             // max −2% per epoch
  bandUp: 1.03,               // max +3% per epoch
  redemptionSpread: 0.10,     // 10% spread (settle at P_red = P × 0.90)
  reserveRatio: 1.0,          // ρ = 1.0 (100% reserve backing)
  epochSeconds: 604_800,      // weekly
  minFeaturePrice: 2,         // permanent minimum (parity invariant)
  gridValues: [2, 4, 8, 16, 32] as number[],
  hysteresisBand: 0.20,       // ±20% USD deviation before repricing
};

// ── Bundle Catalog (Spec §4.2) ──

export interface AnglBundle {
  bundle_id: string;
  angl: number;
  label: string;
  description: string;
  /** P(t) at time of listing — locked at checkout for 15 minutes */
  price_usd: number;
}

export const ANGEL_BUNDLES: Omit<AnglBundle, "price_usd">[] = [
  { bundle_id: "starter",  angl: 5,  label: "Starter",  description: "Covers 2, 4 grid features. Exactly 1 stranded ANGEL." },
  { bundle_id: "standard", angl: 9,  label: "Standard", description: "Covers 2, 4, 8 grid features. Exactly 1 stranded ANGEL." },
  { bundle_id: "pro",      angl: 17, label: "Pro",      description: "Covers 2, 4, 8, 16 grid features. Exactly 1 stranded ANGEL." },
  { bundle_id: "studio",   angl: 33, label: "Studio",   description: "Covers 2, 4, 8, 16, 32 grid features. Exactly 1 stranded ANGEL." },
];

// ── Feature Grid (Spec §6.4) ──

export const FEATURE_GRID = MONETARY_PARAMS.gridValues;

/** USD-denominated feature prices (platforms set these; ANGEL price is derived) */
export const FEATURE_USD_PRICES: Record<string, number> = {
  metered_credential: 25.00,       // → 5 ANGEL at P=$5
  compliance_package: 80.00,       // → 16 ANGEL at P=$5
  pro_subscription_monthly: 40.00, // → 8 ANGEL at P=$5
  api_rate_upgrade_monthly: 80.00, // → 16 ANGEL at P=$5
  voice_call_per_minute: 1.00,     // → grid_round to 2 ANGEL (min)
  agent_enrollment_fee: 0,          // Free — we want agents to join
  referral_bonus: 25.00,            // → 5 ANGEL
};

// ── Rate Oracle (Spec §6.3) ──

export interface RateState {
  epoch: number;
  P: number;             // current ANGEL/USD rate
  S: number;             // circulating supply
  R: number;             // reserve balance (USD)
  P_red: number;         // redemption rate (P × (1 − σ))
  previous_P: number;
  net_inflow: number;
  g: number;             // demand growth rate
  signed_at: string;
  signature: string;
}

/**
 * Computes the grid price for a USD feature at the current rate P(t).
 * Uses the even grid {2, 4, 8, 16, 32} with ±20% hysteresis band.
 */
export function gridRound(
  usdPrice: number,
  currentRate: number,
  postedAngelPrice?: number
): number {
  if (usdPrice <= 0) return 0;
  if (currentRate <= 0) return FEATURE_GRID[0];

  const rawAngel = usdPrice / currentRate;
  const grid = FEATURE_GRID;

  // Find nearest grid value
  let nearest = grid[0];
  let minDiff = Math.abs(rawAngel - grid[0]);
  for (const g of grid) {
    const diff = Math.abs(rawAngel - g);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = g;
    }
  }

  // Hysteresis: if there's a posted price and it's within the band, keep it
  if (postedAngelPrice !== undefined && grid.includes(postedAngelPrice as any)) {
    const postedUsd = postedAngelPrice * currentRate;
    const deviation = Math.abs(postedUsd - usdPrice) / usdPrice;
    if (deviation <= MONETARY_PARAMS.hysteresisBand) {
      return postedAngelPrice;
    }
  }

  // Ensure minimum feature price
  return Math.max(nearest, MONETARY_PARAMS.minFeaturePrice);
}

/**
 * Runs one epoch of the revaluation algorithm (Spec §6.3).
 * Pure function — deterministic, testable.
 */
export function revalue(params: {
  previousRate: number;
  reserveBalance: number;
  previousReserveBalance: number;
  circulatingSupply: number;
}): { P: number; P_red: number; g: number; clamped: boolean; floored: boolean } {
  const { previousRate, reserveBalance, previousReserveBalance, circulatingSupply } = params;

  const netInflow = reserveBalance - previousReserveBalance;
  const g = netInflow / Math.max(previousReserveBalance, 1);

  // Apply damping
  let P = previousRate * (1 + MONETARY_PARAMS.alpha * g);

  // Apply band (−2% / +3%)
  const bandLow = previousRate * MONETARY_PARAMS.bandDown;
  const bandHigh = previousRate * MONETARY_PARAMS.bandUp;
  let clamped = false;
  if (P < bandLow) { P = bandLow; clamped = true; }
  if (P > bandHigh) { P = bandHigh; clamped = true; }

  // Reserve floor: P_red = ρR/S — P never drops below the redemption floor
  const P_red_floor = (MONETARY_PARAMS.reserveRatio * reserveBalance) / Math.max(circulatingSupply, 1);
  let floored = false;
  if (P < P_red_floor) { P = P_red_floor; floored = true; }

  // Redemption rate
  const P_red = P * (1 - MONETARY_PARAMS.redemptionSpread);

  return { P, P_red, g, clamped, floored };
}

/**
 * Signs a rate receipt with the Passport Ed25519 key.
 */
export async function signRateReceipt(state: Omit<RateState, "signature" | "signed_at">): Promise<string> {
  const canonical = JSON.stringify(state, Object.keys(state).sort());
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  if (!privateKeyHex) return "";
  const pkBytes = hexToBytes(privateKeyHex.length === 128 ? privateKeyHex.slice(0, 64) : privateKeyHex);
  const signatureBytes = await sign(utf8ToBytes(canonical), pkBytes);
  return bytesToHex(signatureBytes);
}

/**
 * Computes the stranded ANGEL for a bundle after purchasing a feature.
 * The 2^k+1 / 2^j geometry guarantees exactly 1 stranded ANGEL.
 */
export function computeStranded(bundleAngl: number, featureAngl: number): number {
  return Math.max(0, bundleAngl % featureAngl);
}

/**
 * Value Retention Ratio: how much of the bundle's value is usable.
 * VRR = B / (B - 1) for the 2^k+1 geometry.
 */
export function valueRetentionRatio(bundleAngl: number): number {
  return bundleAngl / (bundleAngl - 1);
}

/**
 * Stranded percentage: 1/B for the 2^k+1 geometry.
 */
export function strandedPercent(bundleAngl: number): number {
  return (1 / bundleAngl) * 100;
}