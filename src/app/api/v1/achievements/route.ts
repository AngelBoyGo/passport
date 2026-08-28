import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { computeAchievements, ALL_BADGES } from "@/lib/engagement/achievements";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/achievements — returns unlocked badges + any newly unlocked.
 * Psychology: variable reward schedule — badges can unlock at unexpected moments.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const operatorsOwned = await prisma.agent.findMany({
    where: { operatorId: session.operatorId },
    select: { agentId: true },
  });

  const commitments = operatorsOwned.map((a) => a.agentId);

  if (commitments.length === 0) {
    return NextResponse.json({ badges: ALL_BADGES.map((b) => ({ id: b.id, name: b.name, description: b.description, emoji: b.emoji, rarity: b.rarity, color: b.color, isNew: false })) });
  }

  const commitment = commitments[0];
  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
  });

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { issuedAt: true, photoUrl: true },
  });

  const evidenceCount = allEvidence.length;
  const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
  const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
  const artifactCount = artifactTypes.size;
  const daysSinceEnrolled = enrollment?.issuedAt
    ? Math.floor((Date.now() - enrollment.issuedAt.getTime()) / 86400000)
    : 0;
  const streakDays = 0;
  const repScore = computeReputationScore({
    evidenceCount,
    artifactCount,
    correctionCount: corrections,
    failureCount: allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length,
    successRate30d: null,
    trajectory7d: "FLAT",
    isEnrolled: enrollStatus === "ENROLLED",
  });

  const input = {
    evidenceCount,
    streakDays,
    reputationScore: repScore.score,
    reputationTier: repScore.tierLabel,
    artifactCount,
    hasEnrollmentPhoto: !!enrollment?.photoUrl,
    correctionCount: corrections,
    daysSinceEnrolled,
  };

  const previouslyUnlocked: string[] = [];
  const badges = computeAchievements(input, previouslyUnlocked);

  return NextResponse.json({ badges });
}