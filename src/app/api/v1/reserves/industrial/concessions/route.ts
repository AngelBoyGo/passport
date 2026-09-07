import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listConcessions, getIndustrialMiningMetrics } from "@/lib/reserves/industrial-mining";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/industrial/concessions — Lists registered industrial concessions & extraction metrics.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:industrial:concessions:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const [concessions, metrics] = await Promise.all([
      listConcessions(),
      getIndustrialMiningMetrics(),
    ]);

    return NextResponse.json(
      {
        success: true,
        metrics,
        concessions: concessions.map((c) => ({
          concession_code: c.concessionCode,
          concession_name: c.concessionName,
          country_code: c.countryCode,
          district_name: c.districtName,
          operator_company: c.operatorCompany,
          statutory_royalty_percent: c.statutoryRoyaltyPercent,
          state_participation_percent: c.stateParticipationPercent,
          smelter_hsm_public_key: c.smelterHsmPublicKey,
          active_status: c.activeStatus,
          total_poured_grams: c.totalPouredGrams,
          total_royalties_angel: c.totalRoyaltiesAngel,
        })),
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
