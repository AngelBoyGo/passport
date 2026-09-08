import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listSettlements } from "@/lib/raillab/settlement";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/settlements — settlement audit tail.
 * Query: ?rail_key=&status=&limit=
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:settlements:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const railKey = searchParams.get("rail_key") ?? searchParams.get("railKey");
  const status = searchParams.get("status");
  const limit = Number(searchParams.get("limit") ?? 50);

  const rows = await listSettlements({
    railKey: railKey || undefined,
    status: status ? String(status).toUpperCase() : undefined,
    limit: Number.isFinite(limit) ? Math.round(limit) : 50,
  });

  return NextResponse.json(
    {
      success: true,
      settlements: rows.map((s) => ({
        settlement_id: s.settlementId,
        rail_key: s.railKey,
        reference: s.reference,
        signer_commitment: s.signerCommitment,
        fx_rate_usd: s.fxRateUsd,
        credited_angel: s.creditedAngel,
        status: s.status,
        error_tranche: s.errorTranche,
        created_at: s.createdAt.toISOString(),
        settled_at: s.settledAt ? s.settledAt.toISOString() : null,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}