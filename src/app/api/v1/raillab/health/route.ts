import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { runIntegrityCheck } from "@/lib/raillab/integrity";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/raillab/health — money-ledger integrity & conservation health check.
 * Public: this is a trust signal, not a secret. `ok=false` means a conservation invariant
 * was violated (supply mismatch, fractional leak, stuck settlement) and needs attention.
 *
 * Optional query param `expected_supply` overrides the expected ANGEL circulating supply
 * (otherwise the check only reports the observed supply without asserting a canonical S,
 * because the signed /api/v1/rate S is computed at request time).
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:health:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { searchParams } = new URL(request.url);
  const rawExpected = searchParams.get("expected_supply") ?? searchParams.get("expectedSupply");
  const expectedAngelSupply = rawExpected && Number.isFinite(Number(rawExpected))
    ? Number(rawExpected)
    : null;

  const status = await runIntegrityCheck({ expectedAngelSupply });
  return NextResponse.json(
    { success: true, healthy: status.ok, status },
    {
      headers: {
        "Cache-Control": "public, max-age=30",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}