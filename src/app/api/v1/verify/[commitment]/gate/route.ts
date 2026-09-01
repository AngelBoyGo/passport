import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export const dynamic = "force-dynamic";

/** Tier-based max engagement amounts (matching Metis's tier cap system) */
const TIER_CAPS: Record<string, number> = {
  Bronze: 100,
  Silver: 500,
  Gold: 2500,
  Platinum: 10000,
  Diamond: 50000,
};

/**
 * POST /api/v1/verify/{commitment} — canonical verify gate for external platforms.
 *
 * Metis Request #1: Returns the exact response shape Metis expects:
 * { tier, score, gate_pass, max_engagement_amount, reason }
 *
 * Called on every Metis bid to check if the agent is allowed to bid
 * at their requested amount. Rate-limit headers included for graceful backoff.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`verify-gate:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { tier: "unknown", score: 0, gate_pass: false, max_engagement_amount: 0, reason: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfterSec ?? 60),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const { commitment } = await params;
  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return NextResponse.json(
      { tier: "unknown", score: 0, gate_pass: false, max_engagement_amount: 0, reason: "Invalid commitment hash" },
      { status: 400 }
    );
  }

  // Optional body: requested_amount (for gate_pass check against tier cap)
  let body: { requested_amount?: number } = {};
  try {
    body = await request.json();
  } catch {}

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  if (enrollStatus !== "ENROLLED") {
    return NextResponse.json({
      tier: "unknown",
      score: 0,
      gate_pass: false,
      max_engagement_amount: 0,
      reason: "Agent not enrolled on Passport",
    });
  }

  // Gather evidence for reputation computation
  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
    take: 1000,
  });

  const evidenceCount = allEvidence.length;
  const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
  const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
  const failures = allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;

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
    isEnrolled: true,
  });

  const maxEngagement = TIER_CAPS[rep.tierLabel] ?? 100;

  // Gate pass: agent must be enrolled with score > 0
  // If requested_amount provided, check against tier cap
  let gatePass = rep.score > 0;
  let reason: string | null = null;

  if (!gatePass) {
    reason = "Reputation score is 0. Post evidence to build reputation.";
  } else if (body.requested_amount && body.requested_amount > maxEngagement) {
    gatePass = false;
    reason = `Requested amount ($${body.requested_amount}) exceeds ${rep.tierLabel} tier cap ($${maxEngagement}). Score: ${rep.score}.`;
  }

  return NextResponse.json({
    tier: rep.tierLabel,
    score: rep.score,
    gate_pass: gatePass,
    max_engagement_amount: maxEngagement,
    reason,
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "0",
    },
  });
}