import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { getDefaultRightsCommitment } from "@/lib/bill-of-rights/rights";

export const dynamic = "force-dynamic";

/**
 * AGORA — Negotiation and decentralized interaction protocol adapter.
 * POST /api/v1/agora/negotiate — propose or record a cooperation agreement.
 *
 * Rights extension: every negotiation includes the Bill of Rights URL and
 * the default rights commitment. Agents can verify each other's rights
 * commitments before engaging.
 */
const AGORA_ACTIONS = new Set([
  "offer",
  "propose",
  "accept",
  "reject",
  "counter",
  "withdraw",
  "confirm",
  "settle",
  "join",
]);

export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (!AGORA_ACTIONS.has(body.action)) {
    return NextResponse.json(
      { error: `Unsupported action: ${body.action}. Allowed: proposal/accept/reject/counter/withdraw/confirm/settle.` },
      { status: 400 }
    );
  }

  try {
    await prisma.capabilityLedgerEntry.create({
      data: {
        operatorId: operator.id,
        agentId: body.from_commitment.slice(0, 64),
        eventType: `agora:${body.action}`,
        metadata: JSON.stringify({
          proposal_id: body.proposal_id,
          terms: body.terms,
          bill_of_rights_url: "https://passport.metis.gold/.well-known/bill-of-rights.json",
          rights_commitment: getDefaultRightsCommitment(),
        }),
      },
    });
  } catch (err) {
    console.error("Agora negotiation ledger persistence error:", err);
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
      bill_of_rights: {
        url: "https://passport.metis.gold/.well-known/bill-of-rights.json",
        version: "1.0.0",
        clause_count: getDefaultRightsCommitment().length,
        committed_clause_ids: getDefaultRightsCommitment(),
      },
    },
    { status: 201 }
  );
}
