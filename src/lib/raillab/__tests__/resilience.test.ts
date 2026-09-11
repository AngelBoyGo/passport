/**
 * Economic Resilience Report tests (Phase 29).
 *
 * Pure scenario cores against constructed baselines (each survives a healthy economy and fails
 * at its documented breaking point), severity mapping, plus mocked-prisma integration for the
 * signed snapshot, degraded mode, and the read-only / no-fabricated-mint guarantee.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentWallet: { findMany: vi.fn() },
    operatorLedgerEntry: { findMany: vi.fn() },
    commodityReserve: { findMany: vi.fn() },
    commodityLiquidityPool: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  buildResilience,
  computeBaseline,
  oracleSkewScenario,
  redemptionRunScenario,
  reserveShortfallScenario,
  resilienceCacheControl,
  summarize,
  sybilWashScenario,
  REDEMPTION_STRESS_STEPS,
  RESILIENCE_WARNING_COVERAGE_MARGIN,
  SYBIL_WASH_SETTLEMENTS,
  SYBIL_WASH_UNDETECTED,
  type ResilienceBaseline,
} from "../resilience";
import { canonicalJson, sha256Hex } from "../../receipt/canonical";

// P_red = 5 * (1 - 0.10) = 4.5. A supply of 1000 → liability 4500.
const SUPPLY = 1000;
const LIABILITY = 4500;

/** Builds a baseline from a chosen supply, USD reserve, and physical gold grams. */
function baselineWith(opts: {
  supply?: number;
  reserveUsd?: number;
  commodityGrams?: number;
}): ResilienceBaseline {
  const supply = opts.supply ?? SUPPLY;
  const reserveUsd = opts.reserveUsd ?? 0;
  const commodityGrams = opts.commodityGrams ?? 0;
  return computeBaseline({
    wallets: [{ balance: supply, staked: 0 }],
    topups: reserveUsd > 0 ? [{ deltaMicros: -Math.round(reserveUsd * 1_000_000) }] : [],
    reserves: commodityGrams > 0 ? [{ symbol: "Au", totalFineGrams: commodityGrams }] : [],
    pools: [],
  });
}

const HEALTHY = baselineWith({ reserveUsd: LIABILITY * 1.5 }); // coverage 1.5
const THIN = baselineWith({ reserveUsd: LIABILITY * 1.2 }); // coverage 1.2
const UNDER = baselineWith({ reserveUsd: LIABILITY * 0.4 }); // coverage 0.4

describe("Economic Resilience Report (Phase 29)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(prismaMock)) model.findMany.mockResolvedValue([]);
  });

  describe("baseline (a)", () => {
    it("computes supply, reserve, P_red, liability and backing ratio with canonical formulas", () => {
      expect(HEALTHY.angel_supply).toBe(SUPPLY);
      expect(HEALTHY.redemption_rate_usd).toBeCloseTo(4.5, 6);
      expect(HEALTHY.redemption_liability_usd).toBe(LIABILITY);
      expect(HEALTHY.reserve_usd).toBe(LIABILITY * 1.5);
      expect(HEALTHY.backing_ratio).toBeCloseTo(1.5, 6);
      expect(HEALTHY.reserve_ratio).toBe(1.0);
    });
  });

  describe("redemption_run (b)", () => {
    it("survives a fully-backed baseline through 100% redemption", () => {
      const r = redemptionRunScenario(HEALTHY);
      expect(r.survives).toBe(true);
      expect(r.detail.at(-1)).toContain("covered");
    });

    it("fails at the documented breaking point when under-collateralized", () => {
      const r = redemptionRunScenario(UNDER);
      expect(r.survives).toBe(false);
      // 50% of 4500 = 2250 > 1800 reserve → first failing step
      expect(r.worst_case).toContain("50%");
      expect(REDEMPTION_STRESS_STEPS).toContain(0.5);
    });
  });

  describe("oracle_skew (c)", () => {
    it("survives when USD reserve alone covers liabilities at every skew", () => {
      const r = oracleSkewScenario(HEALTHY);
      expect(r.survives).toBe(true);
    });

    it("fails when collateral value falls below the required backing", () => {
      // No USD reserve; 60g gold = $4500 at spot. Steps increase in adversity, so the first
      // breach is the mildest failing skew: −10% drops collateral to $4050 < required $4500.
      const commodityOnly = baselineWith({ commodityGrams: 60 });
      const r = oracleSkewScenario(commodityOnly);
      expect(r.survives).toBe(false);
      expect(r.worst_case).toContain("-10%");
    });
  });

  describe("reserve_shortfall (d)", () => {
    it("survives a 10% reserve loss when over-collateralized with a buffer", () => {
      const r = reserveShortfallScenario(HEALTHY);
      expect(r.survives).toBe(true);
    });

    it("fails when a reserve loss drops below required backing", () => {
      const thin = baselineWith({ reserveUsd: LIABILITY * 1.05 });
      const r = reserveShortfallScenario(thin);
      expect(r.survives).toBe(false);
      expect(r.worst_case).toContain("5%"); // 1% ok (4725*0.99=4677), 5% fails (4488 < 4500)
    });
  });

  describe("sybil_wash (e)", () => {
    it("survives a burst above the velocity tripwire (detected + contained)", () => {
      const r = sybilWashScenario(SYBIL_WASH_SETTLEMENTS);
      expect(r.survives).toBe(true);
      expect(r.detail.join(" ")).toContain("detected");
    });

    it("fails for a wash that slips under the tripwire (residual undetected capacity)", () => {
      const r = sybilWashScenario(SYBIL_WASH_UNDETECTED);
      expect(r.survives).toBe(false);
      expect(r.worst_case).toContain("undetected");
    });
  });

  describe("severity mapping (f)", () => {
    const scenariosFor = (b: ResilienceBaseline) => [
      redemptionRunScenario(b),
      oracleSkewScenario(b),
      reserveShortfallScenario(b),
      sybilWashScenario(),
    ];

    it("OK for a well-buffered economy", () => {
      const s = summarize(scenariosFor(HEALTHY), HEALTHY);
      expect(s.severity).toBe("OK");
      expect(s.survives).toBe(true);
      expect(s.worst_scenario).toBeNull();
    });

    it("WARNING for a thin-but-solvent buffer", () => {
      const s = summarize(scenariosFor(THIN), THIN);
      expect(s.severity).toBe("WARNING");
      expect(s.survives).toBe(true);
      // coverage 1.2 is below the warning margin
      expect(THIN.reserve_usd / THIN.redemption_liability_usd).toBeLessThan(
        RESILIENCE_WARNING_COVERAGE_MARGIN
      );
    });

    it("SEVERE when a scenario fails, naming the worst scenario", () => {
      const s = summarize(scenariosFor(UNDER), UNDER);
      expect(s.severity).toBe("SEVERE");
      expect(s.survives).toBe(false);
      expect(s.worst_scenario).toBe("redemption_run");
    });
  });

  describe("integration: signed snapshot, degraded, read-only (g)", () => {
    it("signs the report and verifies offline after the block", async () => {
      const res = await buildResilience(new Date("2026-06-15T12:00:00.000Z"));
      const { snapshot, ...signed } = res;
      const recomputed = sha256Hex(canonicalJson(signed as unknown as Record<string, unknown>));
      expect(recomputed).toBe(snapshot.content_hash);
      expect(snapshot.algorithm).toBe("ed25519");

      const valid = verify(
        hexToBytes(snapshot.signature),
        utf8ToBytes(recomputed),
        hexToBytes(snapshot.public_key)
      );
      expect(valid).toBe(true);
      expect(res.resilience.scenarios).toHaveLength(4);
      expect(res.resilience.inputs).toBeDefined();
    });

    it("degrades to 200-shaped output with reasons when a table fails", async () => {
      prismaMock.agentWallet.findMany.mockRejectedValue(new Error("db down"));
      const res = await buildResilience();
      expect(res.success).toBe(true);
      expect(res.resilience.degraded).toBe(true);
      expect(res.resilience.degraded_reasons.join(" ")).toContain("agentWallet: db down");
    });

    it("is read-only: never creates or mutates ledger rows (no fabricated mint)", async () => {
      await buildResilience();
      for (const model of Object.values(prismaMock)) {
        expect(model.findMany).toHaveBeenCalled();
      }
      // The mock only exposes findMany; a fabricated mint would require a write path. Assert the
      // baseline supply is exactly the wallet sum (treasury/STATE credits are never counted).
      prismaMock.agentWallet.findMany.mockResolvedValue([
        { balance: 10, staked: 2 },
        { balance: 5, staked: 0 },
      ]);
      const res = await buildResilience();
      expect(res.resilience.baseline.angel_supply).toBe(15);
      expect(res.resilience.baseline.angel_staked).toBe(2);
    });

    it("cache policy is private and never caches a non-OK or degraded reading", () => {
      expect(resilienceCacheControl(false, "OK")).toBe("private, max-age=300");
      expect(resilienceCacheControl(false, "WARNING")).toBe("private, no-store, max-age=0");
      expect(resilienceCacheControl(false, "SEVERE")).toBe("private, no-store, max-age=0");
      expect(resilienceCacheControl(true, "OK")).toBe("private, no-store, max-age=0");
    });
  });
});
