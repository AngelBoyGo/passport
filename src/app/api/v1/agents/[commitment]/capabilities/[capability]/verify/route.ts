import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { verifyCapability } from "@/lib/agent-economy/conformance";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/agents/[commitment]/capabilities/[capability]/verify — run a conformance
 * challenge against the capability's endpoint. On success the capability is marked `verified`.
 * Owner or ISSUER.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string; capability: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`agents:capabilities:verify:${ip}`, 15, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 15));
  }

  const { commitment, capability } = await params;
  const auth = await authorizeResource(request, { kind: "agent", id: commitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const result = await verifyCapability({ capability, agentCommitment: commitment });
  if (!result.ok) {
    return NextResponse.json(
      { success: false, verified: false, reason: result.reason ?? "conformance failed" },
      { status: 422, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { success: true, verified: true, capability: capability.toLowerCase(), agent_commitment: commitment },
    { headers: NO_STORE }
  );
}
