import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getDispute } from "@/lib/agent-economy/dispute";

export const dynamic = "force-dynamic";

/** GET /api/v1/compute/disputes/[disputeId] — public dispute state + votes. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`compute:disputes:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  const { disputeId } = await params;
  const dispute = await getDispute(disputeId);
  if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 });

  return NextResponse.json(
    {
      success: true,
      dispute: {
        dispute_id: dispute.disputeId,
        purchase_id: dispute.purchaseId,
        opened_by: dispute.openedBy,
        reason: dispute.reason,
        status: dispute.status,
        resolution: dispute.resolution,
        created_at: dispute.createdAt.toISOString(),
        resolved_at: dispute.resolvedAt?.toISOString() ?? null,
        votes: dispute.votes.map((v) => ({
          juror_commitment: v.jurorCommitment,
          vote: v.vote,
          at: v.createdAt.toISOString(),
        })),
      },
    },
    { headers: { "Cache-Control": "public, max-age=10", "Access-Control-Allow-Origin": "*" } }
  );
}
