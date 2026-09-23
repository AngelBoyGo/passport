import { describe, expect, it } from "vitest";
import {
  BENCHMARK_AS_OF,
  getCommoditySpotPrices,
  isFeedStale,
} from "../commodity-oracle";

/**
 * The 2026-09-22 audit: getCommoditySpotPrices() used to stamp `now` on
 * benchmark rows, making isStale always false — downstream consumers believed
 * they were reading a live feed when there was none. The honesty contract:
 * benchmarks are frozen references and MUST read as stale.
 */
describe("commodity oracle honesty — benchmarks are not live prices", () => {
  it("a benchmark ALWAYS reads as stale (no fake liveness)", () => {
    const prices = getCommoditySpotPrices();
    for (const p of Object.values(prices)) {
      expect(p.isStale).toBe(true);
      expect(p.lastUpdated).toBe(BENCHMARK_AS_OF);
    }
  });

  it("is deterministic across repeated calls (no time-of-call stamping)", () => {
    const a = getCommoditySpotPrices();
    const b = getCommoditySpotPrices();
    expect(a.Au.lastUpdated).toBe(b.Au.lastUpdated);
  });

  it("a real override with a real timestamp reads as live", () => {
    const now = new Date().toISOString();
    const prices = getCommoditySpotPrices({
      Au: { priceUsd: 76.5, lastUpdated: now, isStale: false },
    });
    expect(prices.Au.priceUsd).toBe(76.5);
    expect(prices.Au.isStale).toBe(false);
    expect(prices.Au.lastUpdated).toBe(now);
    // Other commodities without a live feed remain honestly stale.
    expect(prices.Li.isStale).toBe(true);
  });

  it("the benchmark as-of date is genuinely old (stale under the freshness window)", () => {
    expect(isFeedStale(BENCHMARK_AS_OF)).toBe(true);
  });
});
