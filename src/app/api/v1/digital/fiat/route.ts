import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getFiatFix } from "@/lib/digital-gateway/fiat-fix";
import { FX_FIX_REFERENCE_RATE_USD } from "@/lib/digital-gateway/mobile-money";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/digital/fiat
 * Public, cached XOF fix for on-ramp pricing display.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`digital:fiat:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const fix = await getFiatFix("XOF", FX_FIX_REFERENCE_RATE_USD);
    return NextResponse.json(
      {
        success: true,
        currency: fix.currency,
        rate_usd_per_unit: fix.rateUsdPerUnit,
        angel_per_xof: fix.angelRate,
        source: fix.source,
        valid_from: fix.validFrom.toISOString(),
        expires_at: fix.expiresAt.toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}