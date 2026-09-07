import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listTransitCorridors, getTransitMetrics } from "@/lib/reserves/bonded-transit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/transit/corridors — Lists coastal port enclaves, active waybills & logistics metrics.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:transit:corridors:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const [corridors, metrics] = await Promise.all([
      listTransitCorridors(),
      getTransitMetrics(),
    ]);

    return NextResponse.json(
      {
        success: true,
        metrics,
        enclaves: corridors.enclaves.map((e) => ({
          port_code: e.portCode,
          port_name: e.portName,
          country_code: e.countryCode,
          customs_authority_name: e.customsAuthorityName,
          clearing_fee_share_bps: e.clearingFeeShareBps,
          total_transit_grams: e.totalTransitGrams,
          total_fees_earned_angel: e.totalFeesEarnedAngel,
          active_status: e.activeStatus,
        })),
        recent_waybills: corridors.recentWaybills.map((w) => ({
          waybill_number: w.waybillNumber,
          batch_number: w.batchNumber,
          destination_port_code: w.destinationPortCode,
          carrier_commitment: w.carrierCommitment,
          carrier_bond_angel: w.carrierBondAngel,
          fine_gold_grams: w.fineGoldGrams,
          status: w.status,
          checkpoints_visited: w.checkpointsVisited,
          dispatched_at: w.dispatchedAt.toISOString(),
          arrived_at: w.arrivedAt ? w.arrivedAt.toISOString() : null,
        })),
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
