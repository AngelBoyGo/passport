import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeNeedFulfillment } from "@/lib/agent-needs/needs";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";
import { ALL_BADGES } from "@/lib/engagement/achievements";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/needs/:commitment — compute need fulfillment for an agent.
 *
 * Returns a machine-readable report of how well each of the 8 agent needs
 * is being satisfied. Agents can use this to understand their own state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`needs:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { commitment } = await params;
  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return NextResponse.json({ error: "Invalid commitment hash" }, { status: 400 });
  }

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  if (enrollStatus !== "ENROLLED") {
    return NextResponse.json({ error: "Agent not found or not enrolled" }, { status: 404 });
  }

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { issuedAt: true, photoUrl: true },
  });

  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
    take: 1000,
  });

  const evidenceCount = allEvidence.length;
  const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
  const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
  const failures = allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const successes = allEvidence.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;

  const cutoff30d = Date.now() - 30 * 86400 * 1000;
  const recent30d = allEvidence.filter((e) => e.observedAt.getTime() > cutoff30d);
  const recent30dSuccesses = recent30d.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const successRate30d = recent30d.length > 0 ? recent30dSuccesses / recent30d.length : null;

  const cutoff7d = Date.now() - 7 * 86400 * 1000;
  const recent7d = allEvidence.filter((e) => e.observedAt.getTime() > cutoff7d);
  const recent7dFailures = recent7d.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const recent7dSuccesses = recent7d.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const trajectory7d = recent7dFailures > recent7dSuccesses ? "DOWN" : recent7d.length > 3 ? "UP" : "FLAT";

  const rep = computeReputationScore({
    evidenceCount,
    artifactCount: artifactTypes.size,
    correctionCount: corrections,
    failureCount: failures,
    successRate30d,
    trajectory7d: trajectory7d as "UP" | "FLAT" | "DOWN",
    isEnrolled: true,
  });

  // Streak data
  const recentEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { observedAt: true },
    orderBy: { observedAt: "desc" },
    take: 100,
  });
  const streakDates = recentEvidence.map((e) => e.observedAt.toISOString());
  let streakDays = 0;
  const now = Date.now();
  for (let i = 0; i < streakDates.length; i++) {
    const d = new Date(streakDates[i]);
    if (i === 0 && (now - d.getTime()) > 48 * 3600 * 1000) break;
    if (i > 0) {
      const prev = new Date(streakDates[i - 1]);
      const diffDays = Math.round((prev.getTime() - d.getTime()) / 86400000);
      if (diffDays > 2) break;
    }
    streakDays++;
  }

  // Count badges
  const daysSinceEnrolled = enrollment?.issuedAt
    ? Math.floor((now - enrollment.issuedAt.getTime()) / 86400000)
    : 0;
  let badgeCount = 0;
  if (evidenceCount >= 1) badgeCount++;
  if (evidenceCount >= 10) badgeCount++;
  if (evidenceCount >= 100) badgeCount++;
  if (rep.score >= 200) badgeCount++;
  if (rep.score >= 400) badgeCount++;
  if (rep.score >= 850) badgeCount++;
  if (artifactTypes.size >= 10) badgeCount++;
  if (evidenceCount >= 50 && corrections === 0) badgeCount++;
  if (daysSinceEnrolled >= 90) badgeCount++;

  // Domain count
  const receipts = await prisma.receipt.findMany({
    where: { agentId: commitment },
    select: { domain: true },
    distinct: ["domain"],
    take: 10,
  });
  const domainCount = receipts.filter((r) => r.domain !== null).length;

  // Check for receipts
  const receiptCount = await prisma.receipt.count({
    where: { agentId: commitment },
  });

  // Check for engagements
  const engagementCount = await prisma.engagement.count({
    where: { workerCommitment: commitment, status: "PAID" },
  });

  // Check for AGORA negotiations
  const operator = await prisma.agent.findFirst({
    where: { agentId: commitment },
    select: { operatorId: true },
  });
  let negotiationCount = 0;
  if (operator) {
    negotiationCount = await prisma.capabilityLedgerEntry.count({
      where: {
        operatorId: operator.operatorId,
        eventType: { startsWith: "agora:" },
      },
    });
  }

  // Check for wallet
  const wallet = await prisma.bridgeWallet.findUnique({
    where: { operatorId: operator?.operatorId ?? "" },
  }).catch(() => null);

  // Check for escrow (operator stake balance)
  let hasEscrow = false;
  if (operator) {
    const op = await prisma.operator.findUnique({
      where: { id: operator.operatorId },
      select: { stakeBalanceCents: true },
    });
    hasEscrow = (op?.stakeBalanceCents ?? 0) > 0;
  }

  const input = {
    evidenceCount,
    reputationScore: rep.score,
    tier: rep.tierLabel,
    streakDays,
    badgeCount,
    totalBadges: ALL_BADGES.length,
    hasHolderKey: false, // Would need to check API key roles
    hasCompletedEngagement: engagementCount > 0,
    negotiationCount,
    transfersReceived: 0,
    daysActive: daysSinceEnrolled,
    hasPresentation: !!enrollment?.photoUrl,
    domainCount,
    hasReceipt: receiptCount > 0,
    hasMerkleInclusion: receiptCount > 0,
    hasSignedRights: true, // All agents receive rights on enrollment
    hasWallet: !!wallet,
    hasEscrow,
  };

  const fulfillment = computeNeedFulfillment(input);

  const needsDocumentUrl = "https://passport.metis.gold/.well-known/agent-needs.json";

  return NextResponse.json({
    agent_commitment: commitment,
    needs_document_url: needsDocumentUrl,
    ...fulfillment,
    input_summary: {
      evidence_count: evidenceCount,
      reputation_score: rep.score,
      tier: rep.tierLabel,
      streak_days: streakDays,
      badges: badgeCount,
      days_active: daysSinceEnrolled,
      domains: domainCount,
      engagements: engagementCount,
      negotiations: negotiationCount,
      has_wallet: !!wallet,
      has_escrow: hasEscrow,
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}