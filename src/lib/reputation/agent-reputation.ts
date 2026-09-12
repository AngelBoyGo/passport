/**
 * Per-agent reputation for discovery (Phase 33).
 *
 * Reuses the pure `computeReputationScore` engine, but aggregates evidence for MANY agents in a
 * single pass so discovery can rank candidates by track record without N+1 queries.
 */

import { prisma } from "@/lib/db";
import { computeReputationScore, type ReputationResult } from "./compute-score";

const SUCCESS_EVENTS = new Set(["AGENT_ARTIFACT_CREATED", "VALIDATION_OBSERVED"]);

export interface AgentReputationSummary {
  score: number;
  tier: string;
  tierLabel: string;
}

function summarize(rows: {
  artifactType: string;
  normalizedEventType: string;
  rawErrorClassification: string | null;
  observedAt: Date;
}[], isEnrolled: boolean): ReputationResult {
  const now = Date.now();
  const day = 86400000;
  const recent30 = rows.filter((r) => now - r.observedAt.getTime() <= 30 * day);
  const recent7 = rows.filter((r) => now - r.observedAt.getTime() <= 7 * day);

  const artifactTypes = new Set(rows.map((r) => r.artifactType));
  const success30 = recent30.filter((r) => SUCCESS_EVENTS.has(r.normalizedEventType)).length;
  const success7 = recent7.filter((r) => SUCCESS_EVENTS.has(r.normalizedEventType)).length;
  const failures7 = recent7.filter(
    (r) => r.rawErrorClassification && r.rawErrorClassification !== "UNKNOWN"
  ).length;

  return computeReputationScore({
    evidenceCount: rows.length,
    artifactCount: artifactTypes.size,
    correctionCount: rows.filter((r) => r.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length,
    failureCount: rows.filter(
      (r) => r.rawErrorClassification && r.rawErrorClassification !== "UNKNOWN"
    ).length,
    successRate30d: recent30.length > 0 ? success30 / recent30.length : null,
    trajectory7d: failures7 > success7 ? "DOWN" : recent7.length > 3 ? "UP" : "FLAT",
    isEnrolled,
  });
}

/** Computes reputation summaries for many agents in two queries. */
export async function computeReputationBatch(
  commitments: string[]
): Promise<Map<string, AgentReputationSummary>> {
  const hashes = [...new Set(commitments.map((c) => c.toLowerCase()).filter(Boolean))];
  const out = new Map<string, AgentReputationSummary>();
  if (hashes.length === 0) return out;

  const [evidence, enrollments] = await Promise.all([
    prisma.agentEvidence.findMany({
      where: { agentIdentityCommitment: { in: hashes } },
      select: {
        agentIdentityCommitment: true,
        artifactType: true,
        normalizedEventType: true,
        rawErrorClassification: true,
        observedAt: true,
      },
    }),
    prisma.agentEnrollment.findMany({
      where: { subjectCommitment: { in: hashes }, status: "ISSUED" },
      select: { subjectCommitment: true },
    }),
  ]);

  const enrolled = new Set(enrollments.map((e) => e.subjectCommitment.toLowerCase()));
  const byAgent = new Map<string, typeof evidence>();
  for (const row of evidence) {
    const key = row.agentIdentityCommitment.toLowerCase();
    const list = byAgent.get(key) ?? [];
    list.push(row);
    byAgent.set(key, list);
  }

  for (const hash of hashes) {
    const rep = summarize(byAgent.get(hash) ?? [], enrolled.has(hash));
    out.set(hash, { score: rep.score, tier: rep.tier, tierLabel: rep.tierLabel });
  }
  return out;
}

/** Convenience single-agent lookup. */
export async function computeAgentReputation(commitment: string): Promise<AgentReputationSummary> {
  const map = await computeReputationBatch([commitment]);
  return map.get(commitment.toLowerCase()) ?? { score: 0, tier: "bronze", tierLabel: "Bronze" };
}
