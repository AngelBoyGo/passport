import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * AGORA — Negotiation and decentralized interaction protocol adapter.
 * POST /api/v1/agora/negotiate — propose or record a cooperation agreement.
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
    return NextResponse.json(
      { error: "proposal_id, from_commitment, action are required" },
      { status: 400 }
    );
  }

  // Resolve operator ID for capability ledger foreign key
  const authenticatedOperator = await authenticateApiKey(request.headers.get("authorization"));
  const operator = authenticatedOperator ?? (await prisma.operator.findFirst({ select: { id: true } }));

  if (operator) {
    await prisma.capabilityLedgerEntry.create({
      data: {
        operatorId: operator.id,
        agentId: body.from_commitment,
        eventType: `agora:${body.action}`,
        metadata: JSON.stringify({ proposal_id: body.proposal_id, terms: body.terms }),
      },
    });
  }

  return NextResponse.json(
    {
      agora_version: "1.0",
      proposal_id: body.proposal_id,
      status: "proposed",
      action: body.action,
      from_commitment: body.from_commitment,
      to_commitment: body.to_commitment ?? null,
      message: "Proposal recorded on Passport capability ledger.",
    },
    { status: 201 }
  );
}
