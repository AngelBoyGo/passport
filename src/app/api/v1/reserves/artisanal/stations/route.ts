import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listBuyingStations, getArtisanalMetrics } from "@/lib/reserves/artisanal-sourcing";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/artisanal/stations — Lists registered field buying stations & metrics.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:artisanal:stations:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const [stations, metrics] = await Promise.all([
      listBuyingStations(),
      getArtisanalMetrics(),
    ]);

    return NextResponse.json(
      {
        success: true,
        metrics,
        stations: stations.map((s) => ({
          station_code: s.stationCode,
          station_name: s.stationName,
          country_code: s.countryCode,
          district_name: s.districtName,
          operator_commitment: s.operatorCommitment,
          station_public_key: s.stationPublicKey,
          bonded_stake_angel: s.bondedStakeAngel,
          active_status: s.activeStatus,
          total_purchased_grams: s.totalPurchasedGrams,
          total_paid_angel: s.totalPaidAngel,
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
