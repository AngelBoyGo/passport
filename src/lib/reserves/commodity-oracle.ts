/**
 * Sovereign Multi-Commodity Spot Valuation Oracle
 *
 * Tracks reference market spot prices for vaulted strategic commodities:
 * - Gold (Au): denominated in USD per fine gram
 * - Lithium (Li): denominated in USD per kilogram (LCE equivalent)
 * - Neodymium (Nd): denominated in USD per kilogram (Nd2O3 equivalent)
 *
 * Incorporates staleness detection, volatility calculation, and outlier validation.
 */

export interface CommodityPrice {
  symbol: string;
  commodityType: string;
  name: string;
  unit: string;
  priceUsd: number;
  change24hPercent: number;
  volatility30dPercent: number;
  lastUpdated: string;
  isStale: boolean;
  source: string;
}

// ── Baseline Reference Specifications (Moderate Benchmark) ──

export const COMMODITY_BENCHMARKS: Record<
  string,
  Omit<CommodityPrice, "lastUpdated" | "isStale">
> = {
  Au: {
    symbol: "Au",
    commodityType: "GOLD",
    name: "Fine Physical Gold (99.5%+)",
    unit: "gram",
    priceUsd: 75.0, // ~$2,332/oz troy
    change24hPercent: 0.45,
    volatility30dPercent: 4.2,
    source: "AES Sovereign Mint & LBMA Spot Median",
  },
  Li: {
    symbol: "Li",
    commodityType: "LITHIUM",
    name: "Battery-Grade Lithium Carbonate",
    unit: "kg",
    priceUsd: 14.25, // ~$14,250/tonne
    change24hPercent: -1.2,
    volatility30dPercent: 12.8,
    source: "Goulamina Project Off-Take Oracle",
  },
  Nd: {
    symbol: "Nd",
    commodityType: "NEODYMIUM",
    name: "Neodymium-Praseodymium Oxide",
    unit: "kg",
    priceUsd: 71.5,
    change24hPercent: 0.8,
    volatility30dPercent: 8.5,
    source: "Rare Earth Strategic Clearing Feed",
  },
};

export const MAX_FEED_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours max staleness window

/**
 * The date the benchmark reference table was compiled. Baselines are frozen
 * references, not live prices — they must read as stale in the oracle output
 * until a genuinely timestamped override replaces them.
 */
export const BENCHMARK_AS_OF = "2026-09-22T00:00:00.000Z";

/**
 * Checks if a price feed timestamp exceeds maximum acceptable staleness.
 */
export function isFeedStale(timestamp: Date | string, maxAgeMs = MAX_FEED_AGE_MS): boolean {
  const ts = new Date(timestamp).getTime();
  const now = Date.now();
  if (isNaN(ts) || ts <= 0) return true;
  return now - ts > maxAgeMs;
}

/**
 * Validates whether a price observation sits within reasonable statistical variance bounds.
 * Prevents flash-loan or single-block spoofing attacks from corrupting reserve valuations.
 */
export function isPriceWithinBounds(
  observedPrice: number,
  referencePrice: number,
  maxDeviationPercent = 25.0
): boolean {
  if (observedPrice <= 0 || referencePrice <= 0) return false;
  const deviation = (Math.abs(observedPrice - referencePrice) / referencePrice) * 100;
  return deviation <= maxDeviationPercent;
}

/**
 * Retrieves current active spot prices across all supported commodities.
 * Merges benchmark baselines with optional live overrides.
 *
 * HONESTY CONTRACT (the 2026-09-22 audit fix): the `lastUpdated` of a
 * BENCHMARK entry is its declared as-of date — NEVER "now". Previously this
 * function stamped `now` at call time, which made isStale always false and
 * downstream consumers (fractional-amm, rwa-escrow, basket-valuation) believed
 * they were consuming a live feed when there was none. A benchmark is a
 * frozen reference: it must read as stale until a real override with a real
 * timestamp replaces it. Fail-safe, not fail-open.
 */
export function getCommoditySpotPrices(
  overrides?: Record<string, Partial<CommodityPrice>>
): Record<string, CommodityPrice> {
  const result: Record<string, CommodityPrice> = {};

  for (const [symbol, benchmark] of Object.entries(COMMODITY_BENCHMARKS)) {
    const override = overrides?.[symbol];
    const priceUsd = override?.priceUsd ?? benchmark.priceUsd;
    // Benchmarks never masquerade as fresh data: their lastUpdated is the
    // published benchmark date; only a real override carries a live timestamp.
    const lastUpdated = override?.lastUpdated ?? BENCHMARK_AS_OF;
    const isStaleFlag = override?.isStale ?? isFeedStale(lastUpdated);

    result[symbol] = {
      ...benchmark,
      ...override,
      priceUsd,
      lastUpdated,
      isStale: override?.isStale ?? isStaleFlag,
    };
  }

  return result;
}

/**
 * Calculates the gross USD spot value of a quantity of commodity units.
 */
export function computeLotValueUsd(
  commodityType: string,
  fineUnits: number,
  pricePerUnit: number
): number {
  if (fineUnits <= 0 || pricePerUnit <= 0) return 0;
  return Number((fineUnits * pricePerUnit).toFixed(2));
}
