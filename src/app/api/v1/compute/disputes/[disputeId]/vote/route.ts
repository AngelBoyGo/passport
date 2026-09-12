import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeResource } from "@/lib/auth/authorize";
import { castDisputeVote, type DisputeVote } from "@/lib/agent-economy/dispute";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const STATUS_BY_CODE: Record<string, number> = {
  dispute_not_found: 404,
  dispute_closed: 409,
  not_independent: 403,
  not_staked: 403,
  not_enrolled: 403,
  invalid_signature: 403,
  invalid_vote: 400,
  invalid_state: 409,
  purchase_not_found: 404,
  internal_error: 500,
};

/**
 * POST /api/v1/compute/disputes/[disputeId]/vote — a staked, independent juror casts a signed vote.
 * Body: { juror_commitment, vote: "RELEASE" | "REFUND", signature }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:disputes:vote:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const jurorCommitment = String(body.juror_commitment ?? body.jurorCommitment ?? "");
  const auth = await authorizeResource(request, { kind: "agent", id: jurorCommitment });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const { disputeId } = await params;
  const result = await castDisputeVote({
    disputeId,
    jurorCommitment,
    vote: String(body.vote ?? "").toUpperCase() as DisputeVote,
    signature: String(body.signature ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_code: result.code },
      { status: STATUS_BY_CODE[result.code] ?? 400, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { success: true, dispute_id: result.disputeId, status: result.status, votes: result.votes, resolution: result.resolution ?? null },
    { headers: NO_STORE }
  );
}
