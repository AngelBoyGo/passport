import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/agents — discover agents by domain, min score, and limit.
 *
 * Viral: lets platforms discover agents to hire. More agents = more value.
 * This is the network effect engine — every new agent increases the value
 * for every marketplace operator.
 *
 * Query params:
 *   domain?       - filter by operational domain (CODE_GENERATION, FINANCIAL_CLEARING, etc.)
 *   min_score?    - minimum reputation score (0-1000)
 *   limit?        - max results (default 20, max 100)
 *   sort?         - score (default), evidence, artifacts
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`agents-discover:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain")?.toUpperCase();
  const minScore = parseInt(searchParams.get("min_score") || "0", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const sort = searchParams.get("sort") || "score";

  // Get all agent commitments with evidence
  const grouped = await prisma.agentEvidence.groupBy({
    by: ["agentIdentityCommitment"],
    _count: { _all: true },
    _max: { observedAt: true },
  });

  const topAgents = grouped
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, Math.min(limit * 3, 300));

  // For each agent, compute reputation and check domain
  const results = await Promise.all(
    topAgents.map(async (g) => {
      const hash = g.agentIdentityCommitment;
      const enrollStatus = await resolveEnrollmentStatus(hash);

      if (enrollStatus !== "ENROLLED") return null;

      const allEvidence = await prisma.agentEvidence.findMany({
        where: { agentIdentityCommitment: hash },
        select: { normalizedEventType: true, artifactType: true, observedAt: true },
        take: 500,
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

      // Get the agent's domains from receipts
      const receipts = await prisma.receipt.findMany({
        where: { agentId: hash },
        select: { domain: true },
        distinct: ["domain"],
        take: 10,
      });

      const domains: string[] = receipts
        .map((r) => r.domain)
        .filter((d) => d !== null) as string[];

      // Domain filter
      if (domain && !domains.some((d) => d.toUpperCase() === domain)) {
        return null;
      }

      // Score filter
      if (rep.score < minScore) return null;

      return {
        agent_commitment_hash: hash,
        footprint: hash.slice(0, 12),
        domains,
        reputation: {
          score: rep.score,
          tier: rep.tierLabel,
          tier_color: rep.tierColor,
        },
        totals: {
          evidence_count: evidenceCount,
          artifact_count: artifactTypes.size,
          success_rate_30d: successRate30d,
        },
        trajectory_7d: trajectory7d,
        last_observed_at: g._max.observedAt?.toISOString() ?? null,
        profile_url: `/profiles/${hash}`,
        verify_url: `/verify/${hash}`,
        badge_url: `/api/v1/badge/${hash}`,
      };
    })
  );

  const agents = results
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => {
      if (sort === "evidence") return b.totals.evidence_count - a.totals.evidence_count;
      if (sort === "artifacts") return b.totals.artifact_count - a.totals.artifact_count;
      return b.reputation.score - a.reputation.score;
    })
    .slice(0, limit);

  return NextResponse.json({
    agents,
    total: agents.length,
    query: {
      domain: domain ?? null,
      min_score: minScore,
      sort,
      limit,
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}