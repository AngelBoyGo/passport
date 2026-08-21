import { NextRequest, NextResponse } from "next/server";
import { generateAgentVerifiableCredential } from "@/lib/credentials/portable-reputation";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`agent-credential:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, 30)
    );
  }

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json({ error: "agent_commitment_hash must be 64-hex string" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const vc = await generateAgentVerifiableCredential(id, origin);

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
