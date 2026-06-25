import { NextRequest, NextResponse } from "next/server";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { getAccountBalances } from "@/lib/angelcoin/ledger-service";
import { angelcoinErrorResponse } from "@/lib/angelcoin/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/passport/agents/:id/credits — public AngelCoin balances.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`angelcoin-credits:${ip}`);
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
    const { balances, account } = await getAccountBalances(id);
    return NextResponse.json({
      subject_commitment: account.subjectCommitment,
      credit_state: account.creditState,
      access_tier: account.accessTier,
      balances,
    });
  } catch (err) {
    const mapped = angelcoinErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
