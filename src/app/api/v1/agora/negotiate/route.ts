import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * AGORA — Negotiation and decentralized interaction protocol adapter.
 * POST /api/v1/agora/negotiate — propose a cooperation agreement.
 *
 * AGORA agents negotiate terms, then Passport records the outcome
 * as an engagement with escrow lock.
 */
export async function POST(request: NextRequest) {
  let body: {
    proposal_id?: string;
    from_commitment?: string;
    to_commitment?: string;
    action?: string;
    terms?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.proposal_id || !body.from_commitment || !body.action) {
    return NextResponse.json({ error: "proposal_id, from_commitment, action are required" }, { status: 400 });
  }

  // Log the negotiation proposal (immutable audit trail)
  await prisma.capabilityLedgerEntry.create({
    data: {
      operatorId: "agora",
      agentId: body.from_commitment,
      eventType: `agora:${body.action}`,
      metadata: JSON.stringify({ proposal_id: body.proposal_id, terms: body.terms }),
    },
  });

  return NextResponse.json({
    agora_version: "1.0",
    proposal_id: body.proposal_id,
    status: "proposed",
    message: "Proposal recorded. Use /api/v1/passport/engagements to formalize as an engagement.",
  }, { status: 201 });
}