import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/opportunities — discovered value opportunities from the think tank.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`opportunities:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const type = searchParams.get("type");

  const where: any = { sourceType: "think_tank_discovery" };
  if (type) where.normalizedEventType = type;

  const discoveries = await prisma.agentEvidence.findMany({
    where,
    orderBy: { observedAt: "desc" },
    take: limit,
    select: {
      agentIdentityCommitment: true,
      observedAt: true,
      sourceDigest: true,
      eventCommitmentHash: true,
    },
  });

  const opportunities = discoveries.map((d, i) => ({
    id: d.eventCommitmentHash.slice(0, 16),
    rank: i + 1,
    discovered_by: d.agentIdentityCommitment.slice(0, 12),
    description: d.sourceDigest?.slice(0, 200) || "Opportunity discovered by autonomous agent",
    discovered_at: d.observedAt.toISOString(),
    evidence_url: `/api/v1/passport/agents/${d.agentIdentityCommitment}/evidence`,
  }));

  const totalCount = await prisma.agentEvidence.count({
    where: { sourceType: "think_tank_discovery" },
  });

  return NextResponse.json({
    opportunities,
    total: totalCount,
    returned: opportunities.length,
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}