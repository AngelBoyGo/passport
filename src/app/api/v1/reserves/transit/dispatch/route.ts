import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { dispatchDiplomaticTransit } from "@/lib/reserves/bonded-transit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/transit/dispatch — Dispatch bullion convoy under diplomatic bonded seal.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:transit:dispatch:${ip}`, 30, 60_000);
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
  const batchNumber = String(body.batch_number || body.batchNumber || "");
  const destinationPortCode = String(body.destination_port_code || body.destinationPortCode || "");
  const originVaultId = String(body.origin_vault_id || body.originVaultId || "");
  const carrierCommitment = String(body.carrier_commitment || body.carrierCommitment || "");
  const diplomaticSealDigest = String(body.diplomatic_seal_digest || body.diplomaticSealDigest || "");
  const carrierBondAngel = body.carrier_bond_angel ? Number(body.carrier_bond_angel) : undefined;

  if (
    !waybillNumber ||
    !batchNumber ||
    !destinationPortCode ||
    !originVaultId ||
    !carrierCommitment ||
    !diplomaticSealDigest
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: waybill_number, batch_number, destination_port_code, origin_vault_id, carrier_commitment, diplomatic_seal_digest",
      },
      { status: 400 }
    );
  }

  try {
    const waybill = await dispatchDiplomaticTransit({
      waybillNumber,
      batchNumber,
      destinationPortCode,
      originVaultId,
      carrierCommitment,
      carrierBondAngel,
      diplomaticSealDigest,
    });

    return NextResponse.json(
      {
        success: true,
        waybill: {
          waybill_number: waybill.waybillNumber,
          batch_number: waybill.batchNumber,
          destination_port_code: waybill.destinationPortCode,
          carrier_commitment: waybill.carrierCommitment,
          carrier_bond_angel: waybill.carrierBondAngel,
          fine_gold_grams: waybill.fineGoldGrams,
          status: waybill.status,
          dispatched_at: waybill.dispatchedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
