import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeReputationScore } from "@/lib/reputation/compute-score";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return badgeResponse("Passport", "invalid", "#9ca3af", 300);
  }

  const [enrollment, evidenceCount, profileData] = await Promise.all([
    prisma.agentEnrollment.findUnique({
      where: { subjectCommitment: hash },
      select: { status: true },
    }),
    prisma.agentEvidence.count({
      where: { agentIdentityCommitment: hash },
    }),
    getProfileStats(hash),
  ]);

  if (!enrollment) {
    return badgeResponse("Passport", "not found", "#9ca3af", 300);
  }

  if (enrollment.status === "ISSUED" && evidenceCount > 0) {
    const rep = computeReputationScore({
      evidenceCount: profileData.evidenceCount,
      artifactCount: profileData.artifactCount,
      correctionCount: profileData.correctionCount,
      failureCount: profileData.failureCount,
      successRate30d: profileData.successRate30d,
      trajectory7d: profileData.trajectory7d,
      isEnrolled: true,
    });
    return badgeResponse(
      rep.tierLabel,
      `${evidenceCount} receipt${evidenceCount !== 1 ? "s" : ""}`,
      rep.tierColor,
      3600
    );
  }

  if (enrollment.status === "ISSUED") {
    return badgeResponse("passport", "enrolled", "#3b82f6", 3600);
  }

  return badgeResponse("Passport", enrollment.status.toLowerCase(), "#f59e0b", 300);
}

async function getProfileStats(hash: string) {
  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: hash },
    select: { normalizedEventType: true, observedAt: true, artifactType: true },
  });

  const evidenceCount = allEvidence.length;
  const artifactTypes = new Set(allEvidence.map((e) => e.artifactType));
  const artifactCount = artifactTypes.size;
  const corrections = allEvidence.filter((e) => e.normalizedEventType === "HUMAN_CORRECTION_OBSERVED").length;
  const failures = allEvidence.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const successes = allEvidence.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;

  // 30-day success rate
  const cutoff30d = Date.now() - 30 * 86400 * 1000;
  const recent = allEvidence.filter((e) => e.observedAt.getTime() > cutoff30d);
  const recentSuccesses = recent.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const successRate30d = recent.length > 0 ? recentSuccesses / recent.length : null;

  // 7-day trajectory
  const cutoff7d = Date.now() - 7 * 86400 * 1000;
  const recent7d = allEvidence.filter((e) => e.observedAt.getTime() > cutoff7d);
  const recent7dSuccesses = recent7d.filter((e) => e.normalizedEventType === "AGENT_ARTIFACT_CREATED" || e.normalizedEventType === "VALIDATION_OBSERVED").length;
  const recent7dFailures = recent7d.filter((e) => e.normalizedEventType === "EXECUTION_FAILURE_OBSERVED").length;
  const trajectory7d = recent7dFailures > recent7dSuccesses ? "DOWN" as const : recent7d.length > 3 ? "UP" as const : "FLAT" as const;

  return { evidenceCount, artifactCount, correctionCount: corrections, failureCount: failures, successRate30d, trajectory7d };
}

function badgeResponse(
  label: string,
  message: string,
  color: string,
  maxAge: number
): NextResponse {
  const labelWidth = label.length * 7 + 14;
  const msgWidth = message.length * 7 + 14;
  const totalWidth = labelWidth + msgWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#fff" fill-opacity=".9">${label}</text>
    <text x="${labelWidth + msgWidth / 2}" y="15" fill="#fff" fill-opacity=".9">${message}</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}