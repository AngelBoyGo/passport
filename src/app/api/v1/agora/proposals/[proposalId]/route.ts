import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * AGORA — Query negotiation history for a proposal
 * GET /api/v1/agora/proposals/:proposalId
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params;

  const entries = await prisma.capabilityLedgerEntry.findMany({
    where: {
      operatorId: "agora",
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
    payload: entry.metadata ? JSON.parse(entry.metadata) : {},
  }));

  return NextResponse.json({
    agora_version: "1.0",
    proposal_id: proposalId,
    status: timeline[timeline.length - 1].event.replace("agora:", ""),
    events_count: entries.length,
    timeline,
  });
}
