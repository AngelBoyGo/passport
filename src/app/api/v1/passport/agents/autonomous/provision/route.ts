import { NextRequest, NextResponse } from "next/server";
import { provisionAutonomousAgent } from "@/lib/auth/autonomous-provision";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`auto:provision:${ip}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 15));
  }

  try {
    const body = await request.json();

    if (!body.public_key || !body.challenge_nonce || !body.pow_nonce || !body.signature) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: public_key, challenge_nonce, pow_nonce, signature",
        },
        { status: 400 }
      );
    }

    const result = await provisionAutonomousAgent({
      public_key: body.public_key,
      challenge_nonce: body.challenge_nonce,
      pow_nonce: body.pow_nonce,
      signature: body.signature,
      display_name: body.display_name,
      domain: body.domain,
    });

    return NextResponse.json(result, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /expired|consumed|invalid|match/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
