import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { recordSmeltingRun } from "@/lib/reserves/industrial-mining";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/industrial/smelt — Ingests signed furnace pour telemetry from an industrial mine.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:industrial:smelt:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runNumber = String(body.run_number || body.runNumber || "");
  const concessionCode = String(body.concession_code || body.concessionCode || "");
  const grossPouredGrams = Number(body.gross_poured_grams ?? body.grossPouredGrams);
  const densityGramsPerCc = Number(body.density_grams_per_cc ?? body.densityGramsPerCc);
  const estimatedAuFineness = Number(body.estimated_au_fineness ?? body.estimatedAuFineness);
  const estimatedAgFineness = body.estimated_ag_fineness !== undefined ? Number(body.estimated_ag_fineness) : undefined;
  const hsmSignature = String(body.hsm_signature || body.hsmSignature || "");
  const hsmPublicKey = body.hsm_public_key ? String(body.hsm_public_key) : undefined;

  if (
    !runNumber ||
    !concessionCode ||
    isNaN(grossPouredGrams) ||
    isNaN(densityGramsPerCc) ||
    isNaN(estimatedAuFineness) ||
    !hsmSignature
  ) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: run_number, concession_code, gross_poured_grams, density_grams_per_cc, estimated_au_fineness, hsm_signature",
      },
      { status: 400 }
    );
  }

  try {
    const result = await recordSmeltingRun({
      runNumber,
      concessionCode,
      grossPouredGrams,
      densityGramsPerCc,
      estimatedAuFineness,
      estimatedAgFineness,
      hsmSignature,
      hsmPublicKey,
    });

    return NextResponse.json(
      {
        success: true,
        smelting_run: {
          run_number: result.run.runNumber,
          concession_code: result.run.concessionCode,
          gross_poured_grams: result.run.grossPouredGrams,
          fine_gold_grams: result.run.fineGoldGrams,
          fine_silver_grams: result.run.fineSilverGrams,
          gross_market_value_usd: result.run.grossMarketValueUsd,
          royalty_due_angel: result.run.royaltyDueAngel,
          state_share_due_angel: result.run.stateShareDueAngel,
          status: result.run.status,
          poured_at: result.run.pouredAt.toISOString(),
        },
        royalty_calculation: result.calculation,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
