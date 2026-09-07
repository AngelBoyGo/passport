import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { createQuorumProposal } from "@/lib/reserves/threshold-quorum";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/reserves/quorum/propose — Propose a Trilateral Sovereign Governance Action (AES 2-of-3).
 *
 * Body:
 *   proposal_id?: string
 *   action_type: string ("ADD_VAULT", "QUARANTINE_VAULT", "EMERGENCY_FREEZE", "GOVERNOR_REVIVAL", "REBALANCE_BASKET")
 *   payload: object
 *   proposer_state: "ML" | "BF" | "NE"
 *   required_threshold?: number (default 2)
 *   ttl_hours?: number (default 48)
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:quorum:propose:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actionType = String(body.action_type || body.actionType || "");
  const payload = (body.payload && typeof body.payload === "object") ? body.payload as Record<string, unknown> : null;
  const proposerState = String(body.proposer_state || body.proposerState || "");
  const proposalId = body.proposal_id ? String(body.proposal_id) : undefined;
  const requiredThreshold = body.required_threshold ? Number(body.required_threshold) : undefined;
  const ttlHours = body.ttl_hours ? Number(body.ttl_hours) : undefined;

  if (!actionType || !payload || !proposerState) {
    return NextResponse.json(
      { error: "action_type, payload, and proposer_state are required" },
      { status: 400 }
    );
  }

  try {
    const proposal = await createQuorumProposal({
      proposalId,
      actionType,
      payload,
      proposerState,
      requiredThreshold,
      ttlHours,
    });

    return NextResponse.json(
      {
        success: true,
        proposal: {
          proposal_id: proposal.proposalId,
          action_type: proposal.actionType,
          payload_digest: proposal.payloadDigest,
          proposer_state: proposal.proposerState,
          required_threshold: proposal.requiredThreshold,
          status: proposal.status,
          expires_at: proposal.expiresAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
