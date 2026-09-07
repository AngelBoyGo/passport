import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { verifyCheckpointPassage } from "@/lib/logistics/customs-clearing";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/logistics/transit/verify-checkpoint
 * Verifies dual Ed25519 checkpoint telemetry and settles the 70/20/10 corridor tariff.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`logistics:transit:verify-checkpoint:${ip}`, 30, 60_000);
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
  const checkpointCode = String(body.checkpoint_code || body.checkpointCode || "");
  const containerSealDigest = String(
    body.container_seal_digest || body.containerSealDigest || ""
  );
  const timestampIso = String(body.timestamp_iso || body.timestampIso || "");
  const escortSignature = String(body.escort_signature || body.escortSignature || "");
  const inspectorSignature = String(body.inspector_signature || body.inspectorSignature || "");

  if (
    !shipmentId ||
    !checkpointCode ||
    !containerSealDigest ||
    !timestampIso ||
    !escortSignature ||
    !inspectorSignature
  ) {
    return NextResponse.json(
      {
        error:
          "shipment_id, checkpoint_code, container_seal_digest, timestamp_iso, escort_signature, inspector_signature are required",
      },
      { status: 400 }
    );
  }

  try {
    const result = await verifyCheckpointPassage({
      shipmentId,
      checkpointCode,
      containerSealDigest,
      timestampIso,
      escortSignature,
      inspectorSignature,
    });

    return NextResponse.json(
      {
        success: true,
        shipment: {
          shipment_id: result.shipment.shipmentId,
          status: result.shipment.status,
          checkpoints_cleared: result.shipment.checkpointsCleared,
        },
        waterfall: result.waterfall,
        signatures_verified: result.signaturesVerified,
        settlement: {
          settlement_id: result.settlement.settlementId,
          tariff_angel: result.settlement.tariffAngel,
          host_customs_angel: result.settlement.hostCustomsAngel,
          corridor_pool_angel: result.settlement.corridorPoolAngel,
          treasury_angel: result.settlement.treasuryAngel,
          cleared_at: result.settlement.clearedAt.toISOString(),
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}