import { NextRequest, NextResponse } from "next/server";
import { getAccessTierEvaluation } from "@/lib/angelcoin/access-tiers";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/passport/agents/:id/access-tier — current tier and reason.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`angelcoin-tier:${ip}`);
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

  const { id } = await params;
  if (!isValidAgentCommitmentHash(id)) {
    return NextResponse.json(
      { error: "agent_commitment_hash must be a full 64-character hex string" },
      { status: 400 }
    );
  }

  try {
    const { account, balances, evaluation } = await getAccessTierEvaluation(id);

    return NextResponse.json({
      subject_commitment: account.subjectCommitment,
      tier: evaluation.tier,
      reason: evaluation.reason,
      admin_override_tier: account.adminOverrideTier,
      stored_access_tier: account.accessTier,
      available_balance: balances.availableBalance,
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
