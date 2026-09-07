import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getDividends } from "../dividends/route";
import * as waterfall from "@/lib/reserves/royalty-waterfall";

describe("GET /api/v1/reserves/dividends", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns macroeconomic sovereign dividend totals and recent disbursements", async () => {
    vi.spyOn(waterfall, "getAggregatedDividends").mockResolvedValue({
      totals: {
        totalFeesCapturedAngel: 150,
        nationalTreasuryAngel: 30,
        communityTrustAngel: 18,
        workersBonusAngel: 12,
        treasuryStabilizationAngel: 45,
        validatorPoolAngel: 30,
        agentRebatesAngel: 15,
        count: 2,
      },
      recentDisbursements: [
        {
          disbursement_id: "disb_1",
          escrow_id: "esc_1",
          batch_number: "BKO-01",
          total_fee_angel: 100,
          state_national_angel: 20,
          state_community_angel: 12,
          state_workers_angel: 8,
          treasury_stabilization_angel: 30,
          validator_pool_angel: 20,
          agent_rebate_angel: 10,
          district_name: "Bamako",
          country_code: "ML",
          disbursed_at: "2026-09-06T12:00:00.000Z",
        },
      ],
    });

    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/dividends?limit=5");
    const res = await getDividends(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.totals.total_fees_captured_angel).toBe(150);
    expect(data.totals.national_treasury_angel).toBe(30);
    expect(data.totals.community_trust_angel).toBe(18);
    expect(data.totals.workers_bonus_angel).toBe(12);
    expect(data.statutory_formula.standard).toContain("ASMC-3");
    expect(data.recent_disbursements).toHaveLength(1);
    expect(waterfall.getAggregatedDividends).toHaveBeenCalledWith(5);
  });

  it("returns 500 on unexpected service failure", async () => {
    vi.spyOn(waterfall, "getAggregatedDividends").mockRejectedValue(
      new Error("Database connection lost")
    );

    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/dividends");
    const res = await getDividends(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Database connection lost");
  });
});
