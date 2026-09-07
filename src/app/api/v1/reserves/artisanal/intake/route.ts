import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { processOreIntake } from "@/lib/reserves/artisanal-sourcing";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/artisanal/intake — Record raw doré ore intake from artisanal miner.
 *
 * Body:
 *   receipt_number: string
 *   station_code: string
 *   miner_commitment: string
 *   gross_weight_grams: number
 *   assayed_fineness: number (0.50 - 1.00)
 *   spectrometer_signature: string
 *   payout_rate_percent?: number (default 95.0)
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:artisanal:intake:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const receiptNumber = String(body.receipt_number || body.receiptNumber || "");
  const stationCode = String(body.station_code || body.stationCode || "");
  const minerCommitment = String(body.miner_commitment || body.minerCommitment || "");
  const grossWeightGrams = Number(body.gross_weight_grams ?? body.grossWeightGrams);
  const assayedFineness = Number(body.assayed_fineness ?? body.assayedFineness);
  const spectrometerSignature = String(
    body.spectrometer_signature || body.spectrometerSignature || ""
  );
  const payoutRatePercent = body.payout_rate_percent ?? body.payoutRatePercent;

  if (
    !receiptNumber ||
    !stationCode ||
    !minerCommitment ||
    isNaN(grossWeightGrams) ||
    isNaN(assayedFineness)
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: receipt_number, station_code, miner_commitment, gross_weight_grams, assayed_fineness",
      },
      { status: 400 }
    );
  }

  try {
    const result = await processOreIntake({
      receiptNumber,
      stationCode,
      minerCommitment,
      grossWeightGrams,
      assayedFineness,
      spectrometerSignature,
      payoutRatePercent: payoutRatePercent !== undefined ? Number(payoutRatePercent) : undefined,
    });

    return NextResponse.json(
      {
        success: true,
        receipt: {
          receipt_number: result.receipt.receiptNumber,
          station_code: result.receipt.stationCode,
          miner_commitment: result.receipt.minerCommitment,
          gross_weight_grams: result.receipt.grossWeightGrams,
          assayed_fineness: result.receipt.assayedFineness,
          fine_gold_grams: result.receipt.fineGoldGrams,
          payout_usd: result.receipt.payoutUsd,
          payout_angel: result.receipt.payoutAngel,
          status: result.receipt.status,
          created_at: result.receipt.createdAt.toISOString(),
        },
        payout_details: {
          spot_price_usd_per_gram: result.payout.spotPriceUsd,
          payout_rate_percent: result.payout.payoutRatePercent,
          fine_grams: result.payout.fineGrams,
          payout_usd: result.payout.payoutUsd,
          payout_angel: result.payout.payoutAngel,
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
