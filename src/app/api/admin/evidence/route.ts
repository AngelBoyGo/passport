import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/evidence — list all observed agent evidence records.
 * Session-authenticated for operator console.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const sourceType = searchParams.get("sourceType")?.trim();
  const eventType = searchParams.get("eventType")?.trim();
  const agent = searchParams.get("agent")?.trim();
  const search = searchParams.get("search")?.trim().toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  const whereClause: Record<string, unknown> = {};
  if (sourceType) {
    whereClause.sourceType = sourceType;
  }
  if (eventType) {
    whereClause.normalizedEventType = eventType;
  }
  if (agent) {
    whereClause.agentIdentityCommitment = agent;
  }
  if (search) {
    whereClause.OR = [
      { eventCommitmentHash: { contains: search, mode: "insensitive" } },
      { agentIdentityCommitment: { contains: search, mode: "insensitive" } },
      { sourceDigest: { contains: search, mode: "insensitive" } },
      { externalTaskId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, events, sourceTypesGroup, eventTypesGroup] = await Promise.all([
    prisma.agentEvidence.count(),
    prisma.agentEvidence.findMany({
      where: whereClause,
      orderBy: { observedAt: "desc" },
      take: limit,
      select: {
        id: true,
        sourceType: true,
        artifactType: true,
        normalizedEventType: true,
        rawErrorClassification: true,
        observedAt: true,
        agentIdentityCommitment: true,
        eventCommitmentHash: true,
        validationSignalPresent: true,
        tokenUsageInput: true,
        tokenUsageOutput: true,
        toolCallCount: true,
        externalTaskId: true,
        commitSha: true,
      },
    }),
    prisma.agentEvidence.groupBy({
      by: ["sourceType"],
      _count: { _all: true },
    }),
    prisma.agentEvidence.groupBy({
      by: ["normalizedEventType"],
      _count: { _all: true },
    }),
  ]);

  return NextResponse.json(
    {
      total,
      sources: sourceTypesGroup.map((s) => ({ type: s.sourceType, count: s._count._all })),
      eventTypes: eventTypesGroup.map((e) => ({ type: e.normalizedEventType, count: e._count._all })),
      evidence: events,
    },
    { headers: NO_STORE }
  );
}
