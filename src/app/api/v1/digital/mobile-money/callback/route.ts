import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { settleMobileMoneyOnramp } from "@/lib/digital-gateway/mobile-money";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/digital/mobile-money/callback
 * Provider webhook endpoint. Parses + HMAC-verifies the callback and settles the
 * on-ramp exactly once (deduped on (provider, external_ref)).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`digital:mobile-money:callback:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const provider = String(obj.provider ?? obj.provider_name ?? "").toLowerCase();
  if (!provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  try {
    const result = await settleMobileMoneyOnramp({ provider, payload: body });
    return NextResponse.json(
      {
        success: true,
        deduped: result.deduped,
        settlement_id: result.settlementId,
        provider: result.provider,
        external_ref: result.externalRef,
        xof_amount: result.xofAmount,
        credited_angel: result.creditedAngel,
        status: result.status,
      },
      { status: result.deduped ? 200 : 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("refused")
      ? 400
      : 422;
    return NextResponse.json({ error: message }, { status });
  }
}