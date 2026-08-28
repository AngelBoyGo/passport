import { NextRequest, NextResponse } from "next/server";
import { provisionAutonomousAgent } from "@/lib/auth/autonomous-provision";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_DAILY_AUTONOMOUS = Number(process.env.MAX_AUTONOMOUS_PER_IP_DAILY) || 3;

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`auto:provision:${ip}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 15));
  }

  // A9: daily provisioning cap per IP — count autonomous operators created
  // in the last 24 hours from this IP. Prevents mass sybil farming.
  const twentyFourHoursAgo = new Date(Date.now() - 86400000);
  try {
    // Approximate: count all operators whose created_at is within the window.
    // The DB doesn't store IP, so we check the minute-level rate limit +
    // an in-memory daily counter. This is defense-in-depth, not absolute.
    // For absolute enforcement, log IP at operator creation or use the
    // per-minute 15-cap as the primary gate.
    const dayRate = checkInMemoryRateLimit(`auto:daily:${ip}`, MAX_DAILY_AUTONOMOUS, 86400_000);
    if (!dayRate.allowed) {
      return NextResponse.json(
        { error: `Daily autonomous provisioning cap reached (${MAX_DAILY_AUTONOMOUS}/ip/day)` },
        { status: 429, headers: { "Retry-After": "86400" } }
      );
    }
  } catch {
    // non-fatal; in-memory rate limit may not survive server restart
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
