import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { fractionalizeVaultBatch } from "@/lib/reserves/fractional-amm";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/amm/fractionalize
 * Locks an AUDITED unencumbered VaultBatch and mints exact integer milli-unit fractional
 * commodity tokens directly into the depositor's deterministic 64-hex wallet.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:amm:fractionalize:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const batchNumber = String(body.batch_number || body.batchNumber || "");
  const depositorCommitment = String(
    body.depositor_commitment || body.depositorCommitment || ""
  );

  if (!batchNumber || !depositorCommitment) {
    return NextResponse.json(
      { error: "batch_number and depositor_commitment are required" },
      { status: 400 }
    );
  }

  try {
    const result = await fractionalizeVaultBatch({
      batchNumber,
      depositorCommitment,
    });

    return NextResponse.json(
      {
        success: true,
        batch_number: result.batchNumber,
        commodity_type: result.commodityType,
        symbol: result.symbol,
        unit: result.unit,
        minted_milli_units: result.mintedMilliUnits,
        wallet_commitment: result.walletCommitment,
        status: result.status,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}