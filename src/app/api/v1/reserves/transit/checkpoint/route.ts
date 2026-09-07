import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { recordIntermediateCheckpoint } from "@/lib/reserves/bonded-transit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/transit/checkpoint — Record intermediate border customs inspection waypoint.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:transit:checkpoint:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const waybillNumber = String(body.waybill_number || body.waybillNumber || "");
  const checkpointName = String(body.checkpoint_name || body.checkpointName || "");
  const inspectorSignature = String(body.inspector_signature || body.inspectorSignature || "");
  const inspectorPublicKey = String(body.inspector_public_key || body.inspectorPublicKey || "");

  if (!waybillNumber || !checkpointName || !inspectorSignature || !inspectorPublicKey) {
    return NextResponse.json(
      { error: "waybill_number, checkpoint_name, inspector_signature, inspector_public_key are required" },
      { status: 400 }
    );
  }

  try {
    const waybill = await recordIntermediateCheckpoint({
      waybillNumber,
      checkpointName,
      inspectorSignature,
      inspectorPublicKey,
    });

    return NextResponse.json(
      {
        success: true,
        waybill: {
          waybill_number: waybill.waybillNumber,
          status: waybill.status,
          checkpoints_visited: waybill.checkpointsVisited,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
