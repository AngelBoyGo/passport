import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
} from "@/lib/rateLimit";
import {
  getAgentProfile,
  isValidAgentCommitmentHash,
} from "@/lib/public-portal/portal-service";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/verify/:commitment — public Agent Trust Report.
 * Returns a machine-readable trust summary for a given agent commitment.
 * Designed for marketplace operators to call programmatically before onboarding.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`verify:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rate.retryAfterSec ? { "Retry-After": String(rate.retryAfterSec) } : undefined }
    );
  }

  const { commitment: hash } = await params;
  if (!isValidAgentCommitmentHash(hash)) {
    return NextResponse.json(
      { error: "commitment must be a 64-character hex string" },
      { status: 400 }
    );
  }

  const profile = await getAgentProfile(hash);
  if (!profile) {
    return NextResponse.json({ error: "Agent not found", verified: false }, { status: 404 });
  }

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: hash },
    select: { publicKey: true, context: true, status: true, issuedAt: true },
  });

  const enrollStatus = await resolveEnrollmentStatus(hash);
  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: hash },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
    orderBy: { observedAt: "desc" },
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
  const trajectory7d = recent7dFailures > recent7dSuccesses ? "DOWN" as const : recent7d.length > 3 ? "UP" as const : "FLAT" as const;

  const rep = computeReputationScore({
    evidenceCount,
    artifactCount: artifactTypes.size,
    correctionCount: corrections,
    failureCount: failures,
    successRate30d,
    trajectory7d,
    isEnrolled: enrollStatus === "ENROLLED",
  });

  // Last 10 receipts
  const recentReceipts = await prisma.receipt.findMany({
    where: { agentId: hash },
    orderBy: { issuedAt: "desc" },
    take: 10,
    select: {
      receiptId: true,
      status: true,
      domain: true,
      issuedAt: true,
      contentHash: true,
      signature: true,
      expiry: true,
    },
  });

  const now = Date.now();
  const receiptsWithStatus = recentReceipts.map((r) => ({
    receipt_id: r.receiptId,
    status: r.status,
    domain: r.domain,
    issued_at: r.issuedAt.toISOString(),
    has_signature: !!r.signature,
    expired: new Date(r.expiry).getTime() < now,
  }));

  const response = {
    verified: enrollStatus === "ENROLLED" && evidenceCount > 0,
    agent_commitment_hash: hash,
    enrollment_status: enrollStatus,
    public_key: enrollment?.publicKey ?? null,
    context: enrollment?.context ?? null,
    enrolled_at: enrollment?.issuedAt?.toISOString() ?? null,
    reputation: {
      score: rep.score,
      tier: rep.tierLabel,
      tier_color: rep.tierColor,
      next_tier: rep.nextTier,
      score_to_next_tier: rep.scoreToNextTier,
    },
    totals: {
      evidence_count: evidenceCount,
      artifact_count: artifactTypes.size,
      correction_count: corrections,
      failure_count: failures,
      success_count: successes,
      success_rate_30d: successRate30d,
    },
    trajectory_7d: trajectory7d,
    recent_receipts: receiptsWithStatus,
    verify_url: `https://passport.metis.gold/verify/${hash}`,
    badge_url: `https://passport.metis.gold/api/v1/badge/${hash}`,
    profile_url: `https://passport.metis.gold/profiles/${hash}`,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}