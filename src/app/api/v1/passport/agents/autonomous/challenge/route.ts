import { NextRequest, NextResponse } from "next/server";
import { generateAutonomousChallenge } from "@/lib/auth/autonomous-provision";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`auto:challenge:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const body = await request.json();
    const pubKey = body.public_key?.trim();

    if (!pubKey || !/^[0-9a-f]{64}$/i.test(pubKey)) {
      return NextResponse.json(
        { error: "Invalid public_key. Expected a 32-byte (64 hex) Ed25519 public key." },
        { status: 400 }
      );
    }

    const challenge = generateAutonomousChallenge(pubKey);

    return NextResponse.json(challenge, {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
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
