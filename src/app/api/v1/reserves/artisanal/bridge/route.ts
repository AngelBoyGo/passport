import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { requireIssuer } from "@/lib/auth/authorize";
import { bridgeDoréToRefinedVault } from "@/lib/reserves/artisanal-sourcing";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/artisanal/bridge - Bridge raw doré receipts into an investment-grade VaultBatch.
 * AUTHORIZATION: ISSUER key required (creates investment-grade reserve records).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:artisanal:bridge:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const auth = await requireIssuer(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }


  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const receiptNumbers = Array.isArray(body.receipt_numbers || body.receiptNumbers)
    ? (body.receipt_numbers || body.receiptNumbers) as string[]
    : [];
  const targetBatchNumber = String(body.target_batch_number || body.targetBatchNumber || "");
  const vaultId = String(body.vault_id || body.vaultId || "");
  const custodianName = String(body.custodian_name || body.custodianName || "");
  const locationCity = String(body.location_city || body.locationCity || "");
  const locationCountry = String(body.location_country || body.locationCountry || "");
  const barSerials = Array.isArray(body.bar_serials || body.barSerials)
    ? (body.bar_serials || body.barSerials) as string[]
    : [];
  const refinedGrossGrams = Number(body.refined_gross_grams ?? body.refinedGrossGrams);
  const refinedFineness = Number(body.refined_fineness ?? body.refinedFineness);

  if (
    receiptNumbers.length === 0 ||
    !targetBatchNumber ||
    !vaultId ||
    !custodianName ||
    isNaN(refinedGrossGrams) ||
    isNaN(refinedFineness)
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: receipt_numbers, target_batch_number, vault_id, custodian_name, refined_gross_grams, refined_fineness",
      },
      { status: 400 }
    );
  }

  try {
    const result = await bridgeDoréToRefinedVault({
      receiptNumbers,
      targetBatchNumber,
      vaultId,
      custodianName,
      locationCity,
      locationCountry,
      barSerials,
      refinedGrossGrams,
      refinedFineness,
    });

    return NextResponse.json(
      {
        success: true,
        batch: {
          batch_number: result.vaultBatch.batchNumber,
          vault_id: result.vaultBatch.vaultId,
          custodian_name: result.vaultBatch.custodianName,
          gross_weight_grams: result.vaultBatch.grossWeightGrams,
          fineness: result.vaultBatch.fineness,
          fine_weight_grams: result.vaultBatch.fineWeightGrams,
          status: result.vaultBatch.status,
        },
        refined_metrics: {
          receipts_refined_count: result.receiptsRefinedCount,
          total_raw_fine_grams: result.totalRawFineGrams,
          refined_fine_grams: result.refinedFineGrams,
          new_reserve_merkle_root: result.newReserveMerkleRoot,
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
