import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getState } from "../state/route";
import * as governor from "@/lib/reserves/dual-state-governor";

describe("GET /api/v1/reserves/state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns live Dual-State regime status and commodity metrics", async () => {
    vi.spyOn(governor, "getLiveGovernorAssessment").mockResolvedValue({
      regime: "SOLID",
      beliefScore: 0.05,
      dampingFeeBps: 50,
      circuitBreakerActive: false,
      revivalEligible: true,
      triggers: [],
      evidence: {
        oracleStale: false,
        max24hVolatilityPercent: 2.1,
        quarantinedBatchCount: 0,
        backingRatio: 1.65,
        lastTelemetryHeartbeatMs: 60000,
      },
      valuation: {
        timestamp: "2026-09-05T12:00:00.000Z",
        totalGrossValueUsd: 100000,
        annualCarryRatePercent: 0.5,
        annualCarryCostUsd: 500,
        netReserveValueUsd: 99500,
        composition: [
          {
            commodityType: "GOLD",
            symbol: "Au",
            fineUnits: 1333.33,
            unit: "gram",
            spotPriceUsd: 75.0,
            grossValueUsd: 100000,
            weightPercent: 100,
          },
        ],
        solvencyMetrics: {
          circulatingSupply: 10000,
          nominalTokenPriceUsd: 5.0,
          totalLiabilityUsd: 50000,
          backingRatio: 1.99,
          isSolvent: true,
          reserveFloorPriceUsd: 9.95,
        },
      },
      timestamp: "2026-09-05T12:00:00.000Z",
      algorithm: "ed25519",
      public_key: "mockpubkey",
      signature: "mocksig",
    });

    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/state");
    const res = await getState(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.regime).toBe("SOLID");
    expect(data.belief_score).toBe(0.05);
    expect(data.damping_fee_bps).toBe(50);
    expect(data.circuit_breaker_active).toBe(false);
    expect(data.commodities).toHaveLength(3);
    expect(data.commodities.find((c: { symbol: string }) => c.symbol === "Au")).toBeDefined();
    expect(data.basket_valuation.is_solvent).toBe(true);
    expect(data.signature.algorithm).toBe("ed25519");
  });

  it("returns 500 on unexpected service failure", async () => {
    vi.spyOn(governor, "getLiveGovernorAssessment").mockRejectedValue(
      new Error("Telemetry service unavailable")
    );

    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/state");
    const res = await getState(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Telemetry service unavailable");
  });
});
