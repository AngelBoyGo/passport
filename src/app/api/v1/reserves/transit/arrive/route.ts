import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { recordPortArrival } from "@/lib/reserves/bonded-transit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/transit/arrive — Confirm verified arrival at destination coastal port enclave.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:transit:arrive:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const waybillNumber = String(body.waybill_number || body.waybillNumber || "");
  const portCode = String(body.port_code || body.portCode || "");
  const enclaveSignature = String(body.enclave_signature || body.enclaveSignature || "");
  const enclavePublicKey = body.enclave_public_key ? String(body.enclave_public_key) : undefined;

  if (!waybillNumber || !portCode || !enclaveSignature) {
    return NextResponse.json(
      { error: "waybill_number, port_code, and enclave_signature are required" },
      { status: 400 }
    );
  }

  try {
    const waybill = await recordPortArrival({
      waybillNumber,
      portCode,
      enclaveSignature,
      enclavePublicKey,
    });

    return NextResponse.json(
      {
        success: true,
        waybill: {
          waybill_number: waybill.waybillNumber,
          status: waybill.status,
          arrived_at: waybill.arrivedAt ? waybill.arrivedAt.toISOString() : null,
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
