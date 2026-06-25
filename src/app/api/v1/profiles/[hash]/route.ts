import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import {
  getAgentProfile,
  isValidAgentCommitmentHash,
} from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/profiles/:hash — masked agent profile (full 64-hex hash only).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`profile:${ip}`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      }
    );
  }

  const { hash } = await params;
  if (!isValidAgentCommitmentHash(hash)) {
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  const profile = await getAgentProfile(hash);
  if (!profile) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
