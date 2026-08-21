import { NextRequest, NextResponse } from "next/server";
import { generateAgentVerifiableCredential } from "@/lib/credentials/portable-reputation";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/credentials/:commitment — issue signed W3C Verifiable Credential for an agent.
 * Portable reputation object that can travel with the agent to any gateway or marketplace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`credential:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, 30)
    );
  }

  const { commitment } = await params;
  if (!isValidAgentCommitmentHash(commitment)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const vc = await generateAgentVerifiableCredential(commitment, origin);

  if (!vc) {
    return NextResponse.json({ error: "Agent not enrolled or no profile found" }, { status: 404 });
  }

  return NextResponse.json(vc, {
    headers: {
      "Content-Type": "application/vc+ld+json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
