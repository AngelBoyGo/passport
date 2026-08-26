import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * AGORA — Query negotiation history for a proposal
 * GET /api/v1/agora/proposals/:proposalId
 *
 * FIX: requires a Bearer API key and scopes the read to the authenticated
 * operator (negotiate writes proposals under the caller's real operator id, so
 * the old literal `operatorId:"agora"` never matched and leaked cross-tenant).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { proposalId } = await params;

  const entries = await prisma.capabilityLedgerEntry.findMany({
    where: {
      operatorId: operator.id,
      metadata: { contains: proposalId },
    },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length === 0) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const timeline = entries.map((entry) => ({
    event: entry.eventType,
    agent_id: entry.agentId,
    timestamp: entry.createdAt.toISOString(),
    payload: entry.metadata ? safeParse(entry.metadata) : {},
  }));

  return NextResponse.json({
    agora_version: "1.0",
    proposal_id: proposalId,
    status: timeline[timeline.length - 1].event.replace("agora:", ""),
    events_count: entries.length,
    timeline,
  });
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}