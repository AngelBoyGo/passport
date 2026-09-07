import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import {
  generateLivePoR,
  getBatchInclusionProof,
  POR_DISCLAIMER,
} from "@/lib/reserves/por-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/por — Physical Proof-of-Reserves (PoR) Attestation & Merkle Proofs.
 *
 * Query Params:
 *   - commodity: "GOLD" (default), "LITHIUM", "NEODYMIUM"
 *   - batch: Optional batchNumber to query specific Merkle inclusion proof
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:por:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const commodity = searchParams.get("commodity")?.toUpperCase() || "GOLD";
  const batchNumber = searchParams.get("batch") || searchParams.get("batch_number");

  try {
    if (batchNumber) {
      const proof = await getBatchInclusionProof(batchNumber, commodity);
      if (!proof) {
        return NextResponse.json(
          { error: `Batch '${batchNumber}' not found in ${commodity} reserve registry.` },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          success: true,
          batch_number: proof.batchNumber,
          leaf_hash: proof.leafHash,
          merkle_root: proof.merkleRoot,
          verified: proof.verified,
          proof: proof.proof,
          disclaimer: POR_DISCLAIMER,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=30",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const { reserve, attestation, batches } = await generateLivePoR(commodity);

    return NextResponse.json(
      {
        success: true,
        reserve: {
          commodity_type: reserve.commodityType,
          symbol: reserve.symbol,
          total_fine_grams: reserve.totalFineGrams,
          total_gross_grams: reserve.totalGrams,
          active_lots_count: reserve.activeLotsCount,
          merkle_root: reserve.merkleRoot,
          last_audited_at: reserve.lastAuditedAt.toISOString(),
        },
        attestation,
        batches: batches.map((b) => ({
          batch_number: b.batchNumber,
          vault_id: b.vaultId,
          custodian_name: b.custodianName,
          location_city: b.locationCity,
          location_country: b.locationCountry,
          fine_weight_grams: b.fineWeightGrams,
          gross_weight_grams: b.grossWeightGrams,
          fineness: b.fineness,
          bar_serials_count: b.barSerials.length,
          status: b.status,
          assay_ref: b.assayRef,
        })),
        disclaimer: POR_DISCLAIMER,
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
