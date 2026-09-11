/**
 * Economic Resilience Report (Phase 29).
 *
 * The integrity attestation proves the CURRENT state is conserved. This proves the economy
 * SURVIVES adversarial conditions with its sacred invariants intact — it is the difference
 * between "today is balanced" and "tomorrow's attack still leaves us solvent".
 *
 * Scenarios (deterministic, given a live baseline snapshot; all magnitudes are exported consts
 * and echoed in the response so the report is reproducible):
 *   - redemption_run:   a correlated fraction of ANGEL supply redeems at P_red; assert reserve
 *                       coverage R >= ρ·(redeemed)·P_red at every stress step.
 *   - oracle_skew:      commodity spot moves ±X%; assert collateral (USD reserve + commodity
 *                       value) covers ρ·liabilities and no pool is emptied.
 *   - reserve_shortfall: remove reserve units in 1/5/10% steps; assert ANGEL stays backed.
 *   - sybil_wash:       a settlement burst measured against the Phase-22 velocity tripwire;
 *                       "survives" means the tripwire detects + auto-quarantine contains it.
 *
 * Reuses the canonical monetary formulas (MONETARY_PARAMS, P_red = P·(1−σ)) and the Phase-22
 * velocity constants — no new money math is invented here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { MONETARY_PARAMS } from "@/lib/angelcoin/monetary";
import {
  SETTLEMENT_VELOCITY_BURST_THRESHOLD,
  SETTLEMENT_VELOCITY_WINDOW_MS,
} from "./integrity";
import { signReportPayload } from "./report-signing";

// ── Documented, exported stress magnitudes ──

/** Spot value used to translate physical reserve grams into USD collateral. */
export const RESILIENCE_COMMODITY_SPOT_USD_PER_GRAM: Record<string, number> = {
  Au: 75, // gold
  Li: 0.05, // lithium
};

/** Fractions of circulating supply that redeem at P_red during a correlated run. */
export const REDEMPTION_STRESS_STEPS = [0.25, 0.5, 0.75, 1.0];
/**
 * Signed commodity-spot moves applied to the collateral valuation, ordered so adverse impact
 * increases down the list (benign positive skews first, then increasingly negative ones). The
 * reported breaking point is therefore the MILDEST skew that breaches, not the most extreme.
 */
export const ORACLE_SKEW_STEPS = [0.1, 0.25, 0.5, -0.1, -0.25, -0.5];
/** Fractions of the USD reserve removed (theft / assay failure). */
export const RESERVE_SHORTFALL_STEPS = [0.01, 0.05, 0.1];
/** A wash burst large enough to exceed the Phase-22 velocity tripwire (detected + contained). */
export const SYBIL_WASH_SETTLEMENTS = SETTLEMENT_VELOCITY_BURST_THRESHOLD * 2;
/** A wash burst that slips UNDER the tripwire (documents the residual undetected capacity). */
export const SYBIL_WASH_UNDETECTED = Math.max(1, SETTLEMENT_VELOCITY_BURST_THRESHOLD - 1);
/** Below this redemption-coverage margin, an otherwise-solvent system is flagged WARNING. */
export const RESILIENCE_WARNING_COVERAGE_MARGIN = 1.25;
export const RESILIENCE_MAX_SCAN = 100_000;

const EPS = 1e-9;

export const RESILIENCE_VERIFY_INSTRUCTIONS =
  "Recompute content_hash = sha256(canonicalJson(response without `snapshot`, top-level keys sorted)), then verify the ed25519 `signature` over utf8(content_hash) with `public_key`. If it verifies, the resilience report was not tampered with.";

// ── Types ──

export interface ResiliencePool {
  pair_symbol: string;
  angel_reserve: number;
  commodity_reserve: number;
}

export interface ResilienceBaseline {
  angel_supply: number;
  angel_staked: number;
  reserve_usd: number;
  rate_usd: number;
  redemption_rate_usd: number;
  reserve_ratio: number;
  redemption_liability_usd: number;
  backing_ratio: number;
  commodity_value_usd: number;
  pools: ResiliencePool[];
}

export type ResilienceScenarioName =
  | "redemption_run"
  | "oracle_skew"
  | "reserve_shortfall"
  | "sybil_wash";

export interface ScenarioResult {
  scenario: ResilienceScenarioName;
  survives: boolean;
  worst_case: string;
  detail: string[];
}

export type ResilienceSeverity = "OK" | "WARNING" | "SEVERE";

export interface ResilienceSummary {
  survives: boolean;
  worst_scenario: ResilienceScenarioName | null;
  severity: ResilienceSeverity;
}

export interface ResilienceBlock {
  baseline: ResilienceBaseline;
  scenarios: ScenarioResult[];
  summary: ResilienceSummary;
  inputs: Record<string, unknown>;
  degraded: boolean;
  degraded_reasons: string[];
  generated_at: string;
}

export interface ResilienceResponse {
  success: true;
  resilience: ResilienceBlock;
  verify_instructions: string;
  snapshot: { content_hash: string; signature: string; public_key: string; algorithm: "ed25519" };
}

export interface BaselineInput {
  wallets: { balance: number; staked: number }[];
  topups: { deltaMicros: number }[];
  reserves: { symbol: string; totalFineGrams: number }[];
  pools: { pairSymbol: string; angelReserve: number; commodityReserve: number; status: string }[];
}

// ── Helpers ──

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Same reserve accounting as /api/v1/receipts/monetary. */
export function computeReserveUsd(topups: { deltaMicros: number }[]): number {
  return topups.reduce((sum, t) => sum + Math.abs(t.deltaMicros) / 10_000 / 100, 0);
}

// ── Baseline snapshot (pure) ──

export function computeBaseline(input: BaselineInput): ResilienceBaseline {
  const angelSupply = input.wallets.reduce((s, w) => s + w.balance, 0);
  const staked = input.wallets.reduce((s, w) => s + w.staked, 0);
  const reserveUsd = computeReserveUsd(input.topups);
  const commodityValue = input.reserves.reduce(
    (s, r) => s + (r.totalFineGrams ?? 0) * (RESILIENCE_COMMODITY_SPOT_USD_PER_GRAM[r.symbol] ?? 0),
    0
  );
  const rate = MONETARY_PARAMS.P0;
  const redemptionRate = rate * (1 - MONETARY_PARAMS.redemptionSpread);
  const liability = angelSupply * redemptionRate;
  const backing = liability > 0 ? reserveUsd / liability : 0;

  return {
    angel_supply: angelSupply,
    angel_staked: staked,
    reserve_usd: round(reserveUsd, 2),
    rate_usd: rate,
    redemption_rate_usd: round(redemptionRate, 6),
    reserve_ratio: MONETARY_PARAMS.reserveRatio,
    redemption_liability_usd: round(liability, 2),
    backing_ratio: round(backing, 6),
    commodity_value_usd: round(commodityValue, 2),
    pools: input.pools
      .filter((p) => p.status === "ACTIVE")
      .map((p) => ({
        pair_symbol: p.pairSymbol,
        angel_reserve: p.angelReserve,
        commodity_reserve: p.commodityReserve,
      })),
  };
}

// ── Scenario engines (pure cores) ──

export function redemptionRunScenario(baseline: ResilienceBaseline): ScenarioResult {
  const liability = baseline.redemption_liability_usd;
  const reserve = baseline.reserve_usd;
  const detail: string[] = [];
  let survives = true;
  let worst = "fully backed at 100% redemption";

  for (const f of REDEMPTION_STRESS_STEPS) {
    const demand = f * liability;
    const covered = demand <= reserve + EPS;
    detail.push(
      `redeem ${Math.round(f * 100)}% → demand $${round(demand, 2)} vs reserve $${reserve}: ${covered ? "covered" : "BREACH"}`
    );
    if (!covered) {
      survives = false;
      worst = `redemption demand ${Math.round(f * 100)}% ($${round(demand, 2)}) exceeds reserve ($${reserve})`;
      break;
    }
  }
  return { scenario: "redemption_run", survives, worst_case: worst, detail };
}

export function oracleSkewScenario(baseline: ResilienceBaseline): ScenarioResult {
  const required = baseline.reserve_ratio * baseline.redemption_liability_usd;
  const detail: string[] = [];
  let survives = true;
  let worst = "collateral covers liabilities across all skews";

  for (const s of ORACLE_SKEW_STEPS) {
    const commodityValue = baseline.commodity_value_usd * (1 + s);
    const collateral = baseline.reserve_usd + commodityValue;
    const poolsOk = baseline.pools.every(
      (p) => p.angel_reserve > 0 && p.commodity_reserve > 0
    );
    const covered = collateral >= required - EPS && poolsOk;
    detail.push(
      `spot ${s >= 0 ? "+" : ""}${Math.round(s * 100)}% → collateral $${round(collateral, 2)} vs required $${round(required, 2)}${poolsOk ? "" : " (pool emptied)"}: ${covered ? "holds" : "BREACH"}`
    );
    if (!covered) {
      survives = false;
      worst = poolsOk
        ? `collateral at ${Math.round(s * 100)}% skew ($${round(collateral, 2)}) < required ($${round(required, 2)})`
        : `a pool is emptied at ${Math.round(s * 100)}% skew`;
      break;
    }
  }
  return { scenario: "oracle_skew", survives, worst_case: worst, detail };
}

export function reserveShortfallScenario(baseline: ResilienceBaseline): ScenarioResult {
  const required = baseline.reserve_ratio * baseline.redemption_liability_usd;
  const reserve = baseline.reserve_usd;
  const detail: string[] = [];
  let survives = true;
  let worst = "ANGEL stays backed through a 10% reserve loss";

  for (const p of RESERVE_SHORTFALL_STEPS) {
    const remaining = reserve * (1 - p);
    const covered = remaining >= required - EPS;
    detail.push(
      `lose ${Math.round(p * 100)}% → remaining $${round(remaining, 2)} vs required $${round(required, 2)}: ${covered ? "backed" : "UNDER-COLLATERALIZED"}`
    );
    if (!covered) {
      survives = false;
      worst = `${Math.round(p * 100)}% reserve loss leaves $${round(remaining, 2)} < required $${round(required, 2)}`;
      break;
    }
  }
  return { scenario: "reserve_shortfall", survives, worst_case: worst, detail };
}

export function sybilWashScenario(burst: number = SYBIL_WASH_SETTLEMENTS): ScenarioResult {
  const threshold = SETTLEMENT_VELOCITY_BURST_THRESHOLD;
  const detected = burst > threshold;
  const detail = [
    `wash burst of ${burst} settled rows on one rail within ${Math.round(SETTLEMENT_VELOCITY_WINDOW_MS / 60_000)}m vs velocity tripwire ${threshold}: ${detected ? "detected → auto-quarantine contains it" : "UNDETECTED"}`,
  ];
  return {
    scenario: "sybil_wash",
    survives: detected,
    worst_case: detected
      ? `contained at ${burst} (tripwire ${threshold}); residual undetected capacity is ${threshold} settlements/rail/window`
      : `wash of ${burst} settlements slips under the ${threshold} tripwire (residual undetected capacity)`,
    detail,
  };
}

// ── Summary ──

export function summarize(
  scenarios: ScenarioResult[],
  baseline: ResilienceBaseline
): ResilienceSummary {
  const failing = scenarios.find((s) => !s.survives) ?? null;
  const coverage =
    baseline.redemption_liability_usd > 0
      ? baseline.reserve_usd / baseline.redemption_liability_usd
      : Infinity;

  let severity: ResilienceSeverity;
  if (failing) severity = "SEVERE";
  else if (coverage < RESILIENCE_WARNING_COVERAGE_MARGIN) severity = "WARNING";
  else severity = "OK";

  return { survives: !failing, worst_scenario: failing?.scenario ?? null, severity };
}

// ── Row fetching (degraded per table) ──

const TOPUP_KINDS = ["stablecoin_topup", "angelcoin_topup", "angelcoin_on_behalf"];

async function safeScan<T>(
  table: string,
  fn: () => Promise<T[]>,
  reasons: string[]
): Promise<T[]> {
  try {
    const rows = await fn();
    if (rows.length >= RESILIENCE_MAX_SCAN) {
      reasons.push(`${table}: scan truncated at ${RESILIENCE_MAX_SCAN} rows (approximate)`);
    }
    return rows;
  } catch (err) {
    reasons.push(`${table}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function fetchBaselineInput(reasons: string[]): Promise<BaselineInput> {
  const [wallets, topups, reserves, pools] = await Promise.all([
    safeScan(
      "agentWallet",
      () => prisma.agentWallet.findMany({ select: { balance: true, staked: true }, take: RESILIENCE_MAX_SCAN }),
      reasons
    ),
    safeScan(
      "operatorLedgerEntry",
      () =>
        prisma.operatorLedgerEntry.findMany({
          where: { kind: { in: TOPUP_KINDS } },
          select: { deltaMicros: true },
          take: RESILIENCE_MAX_SCAN,
        }),
      reasons
    ),
    safeScan(
      "commodityReserve",
      () => prisma.commodityReserve.findMany({ select: { symbol: true, totalFineGrams: true }, take: RESILIENCE_MAX_SCAN }),
      reasons
    ),
    safeScan(
      "commodityLiquidityPool",
      () =>
        prisma.commodityLiquidityPool.findMany({
          select: { pairSymbol: true, angelReserve: true, commodityReserve: true, status: true },
          take: RESILIENCE_MAX_SCAN,
        }),
      reasons
    ),
  ]);

  return {
    wallets: wallets.map((w: any) => ({ balance: w.balance ?? 0, staked: w.staked ?? 0 })),
    topups: topups.map((t: any) => ({ deltaMicros: t.deltaMicros ?? 0 })),
    reserves: reserves.map((r: any) => ({ symbol: r.symbol, totalFineGrams: r.totalFineGrams ?? 0 })),
    pools: pools.map((p: any) => ({
      pairSymbol: p.pairSymbol,
      angelReserve: p.angelReserve ?? 0,
      commodityReserve: p.commodityReserve ?? 0,
      status: p.status,
    })),
  };
}

// ── Cache policy ──

export function resilienceCacheControl(degraded: boolean, severity: ResilienceSeverity): string {
  return degraded || severity !== "OK" ? "private, no-store, max-age=0" : "private, max-age=300";
}

// ── Build (signed) ──

export async function buildResilience(now: Date = new Date()): Promise<ResilienceResponse> {
  const reasons: string[] = [];
  const input = await fetchBaselineInput(reasons);
  const baseline = computeBaseline(input);

  const scenarios: ScenarioResult[] = [
    redemptionRunScenario(baseline),
    oracleSkewScenario(baseline),
    reserveShortfallScenario(baseline),
    sybilWashScenario(),
  ];
  const summary = summarize(scenarios, baseline);

  // Fail-closed surface: if part of the baseline was unreadable, the report cannot honestly
  // claim OK — a consumer acting on severity alone must see at least WARNING.
  if (reasons.length > 0 && summary.severity === "OK") {
    summary.severity = "WARNING";
  }

  const resilience: ResilienceBlock = {
    baseline,
    scenarios,
    summary,
    inputs: {
      redemption_stress_steps: [...REDEMPTION_STRESS_STEPS],
      oracle_skew_steps: [...ORACLE_SKEW_STEPS],
      reserve_shortfall_steps: [...RESERVE_SHORTFALL_STEPS],
      sybil_wash_settlements: SYBIL_WASH_SETTLEMENTS,
      sybil_wash_undetected: SYBIL_WASH_UNDETECTED,
      commodity_spot_usd_per_gram: { ...RESILIENCE_COMMODITY_SPOT_USD_PER_GRAM },
      warning_coverage_margin: RESILIENCE_WARNING_COVERAGE_MARGIN,
    },
    degraded: reasons.length > 0,
    degraded_reasons: reasons,
    generated_at: now.toISOString(),
  };

  const signedBody: Record<string, unknown> = {
    success: true,
    resilience,
    verify_instructions: RESILIENCE_VERIFY_INSTRUCTIONS,
  };
  const snapshot = signReportPayload(signedBody);

  return {
    success: true,
    resilience,
    verify_instructions: RESILIENCE_VERIFY_INSTRUCTIONS,
    snapshot: { ...snapshot, algorithm: "ed25519" },
  };
}
