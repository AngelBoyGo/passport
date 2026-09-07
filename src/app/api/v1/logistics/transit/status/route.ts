import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import {
  getTransitStatus,
  listTransitAudit,
  getCorridorMetrics,
} from "@/lib/logistics/customs-clearing";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/logistics/transit/status
 * Returns the full cryptographic audit chain for convoy manifests.
 * ?shipment_id=<id> targets a single manifest; otherwise returns the recent trail + metrics.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`logistics:transit:status:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const params = request.nextUrl.searchParams;
  const shipmentId = params.get("shipment_id") ?? params.get("shipmentId") ?? "";

  try {
    if (shipmentId) {
      const shipment = await getTransitStatus(shipmentId);
      return NextResponse.json(
        {
          success: true,
          shipment: {
            shipment_id: shipment.shipmentId,
            manifest_number: shipment.manifestNumber,
            commodity_type: shipment.commodityType,
            fine_units: shipment.fineUnits,
            origin_jurisdiction: shipment.originJurisdiction,
            destination_jurisdiction: shipment.destinationJurisdiction,
            route_code: shipment.routeCode,
            container_seal_digest: shipment.containerSealDigest,
            status: shipment.status,
            checkpoints_cleared: shipment.checkpointsCleared,
            created_at: shipment.createdAt.toISOString(),
            settlements: shipment.settlements.map((s) => ({
              settlement_id: s.settlementId,
              tariff_angel: s.tariffAngel,
              host_customs_angel: s.hostCustomsAngel,
              corridor_pool_angel: s.corridorPoolAngel,
              treasury_angel: s.treasuryAngel,
              cleared_at: s.clearedAt.toISOString(),
            })),
          },
        },
        {
          headers: {
            "Cache-Control": "public, max-age=30",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const [audit, metrics] = await Promise.all([listTransitAudit(), getCorridorMetrics()]);

    return NextResponse.json(
      {
        success: true,
        metrics,
        checkpoints: audit.checkpoints.map((c) => ({
          checkpoint_code: c.checkpointCode,
          checkpoint_name: c.checkpointName,
          jurisdiction: c.jurisdiction,
          active_status: c.activeStatus,
        })),
        recent_shipments: audit.shipments.map((s) => ({
          shipment_id: s.shipmentId,
          commodity_type: s.commodityType,
          origin_jurisdiction: s.originJurisdiction,
          destination_jurisdiction: s.destinationJurisdiction,
          status: s.status,
          checkpoints_cleared: s.checkpointsCleared,
        })),
        recent_settlements: audit.recentSettlements.map((s) => ({
          settlement_id: s.settlementId,
          shipment_id: s.shipmentId,
          checkpoint_id: s.checkpointId,
          gross_value_usd: s.grossValueUsd,
          tariff_angel: s.tariffAngel,
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
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}