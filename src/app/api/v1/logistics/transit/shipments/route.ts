import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { registerTransitShipment } from "@/lib/logistics/customs-clearing";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/logistics/transit/shipments — Register a sealed diplomatic transit shipment.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`logistics:transit:shipments:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shipmentId = String(body.shipment_id || body.shipmentId || "");
  const manifestNumber = String(body.manifest_number || body.manifestNumber || "");
  const commodityType = String(body.commodity_type || body.commodityType || "");
  const fineUnits = Number(body.fine_units ?? body.fineUnits);
  const originJurisdiction = String(body.origin_jurisdiction || body.originJurisdiction || "");
  const destinationJurisdiction = String(
    body.destination_jurisdiction || body.destinationJurisdiction || ""
  );
  const routeCode = String(body.route_code || body.routeCode || "");
  const escortPublicKey = String(body.escort_public_key || body.escortPublicKey || "");
  const containerSealDigest = String(
    body.container_seal_digest || body.containerSealDigest || ""
  );

  if (
    !shipmentId ||
    !manifestNumber ||
    !commodityType ||
    isNaN(fineUnits) ||
    !originJurisdiction ||
    !destinationJurisdiction ||
    !routeCode ||
    !escortPublicKey ||
    !containerSealDigest
  ) {
    return NextResponse.json(
      {
        error:
          "shipment_id, manifest_number, commodity_type, fine_units, origin_jurisdiction, destination_jurisdiction, route_code, escort_public_key, container_seal_digest are required",
      },
      { status: 400 }
    );
  }

  try {
    const shipment = await registerTransitShipment({
      shipmentId,
      manifestNumber,
      commodityType,
      fineUnits,
      originJurisdiction,
      destinationJurisdiction,
      routeCode,
      escortPublicKey,
      containerSealDigest,
    });

    return NextResponse.json(
      {
        success: true,
        shipment: {
          shipment_id: shipment.shipmentId,
          manifest_number: shipment.manifestNumber,
          commodity_type: shipment.commodityType,
          status: shipment.status,
          route_code: shipment.routeCode,
          container_seal_digest: shipment.containerSealDigest,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}