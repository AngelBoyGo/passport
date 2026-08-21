import { NextRequest, NextResponse } from "next/server";
import { verifyAgentVerifiableCredential, AgentVerifiableCredential } from "@/lib/credentials/portable-reputation";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/credentials/verify — independently verify any W3C AgentReputationCredential.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`vc-verify:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, 30)
    );
  }

  let body: AgentVerifiableCredential;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await verifyAgentVerifiableCredential(body);
  return NextResponse.json(result, {
    status: result.valid ? 200 : 422,
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
