import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeStreak, openStreakChest } from "@/lib/engagement/streaks";
import { sessionFromRequest } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/streaks — current agent streak data for dashboard.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recent = await prisma.agentEvidence.findMany({
    where: {
      agentIdentityCommitment: {
        in: (
          await prisma.agent.findMany({
            where: { operatorId: session.operatorId },
            select: { agentId: true },
          })
        ).map((a) => a.agentId),
      },
    },
    select: { observedAt: true },
    orderBy: { observedAt: "desc" },
    take: 100,
  });

  const streak = computeStreak({
    recentEvidenceDates: recent.map((e) => e.observedAt.toISOString()),
    now: new Date().toISOString(),
  });

  // Chest opening
  let chestResult = null;
  if (streak.chestAvailable) {
    chestResult = openStreakChest(streak.currentStreak);
  }

  return NextResponse.json({
    ...streak,
    totalEvidence: recent.length,
    chest: chestResult,
  });
}