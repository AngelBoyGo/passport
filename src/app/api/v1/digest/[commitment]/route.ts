import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { ALL_BADGES } from "@/lib/engagement/achievements";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/digest/:commitment — Weekly Reputation Digest SVG card.
 *
 * Returns a shareable SVG card showing the agent's weekly stats:
 * - Streak, tier, score, evidence count, new badges, rank trajectory
 * - Designed for social media sharing (Twitter, LinkedIn, GitHub)
 * - Fixed 600x400 aspect ratio, OG-friendly
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const { commitment } = await params;

  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return svgResponse(digestSvg({ error: "Invalid commitment" }), 60);
  }

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  if (enrollStatus !== "ENROLLED") {
    return svgResponse(digestSvg({ error: "Agent not found" }), 60);
  }

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { issuedAt: true },
  });

  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { normalizedEventType: true, artifactType: true, observedAt: true },
    orderBy: { observedAt: "desc" },
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

  // Count evidence in the last 7 days for "this week" stat
  const evidenceThisWeek = recent7d.length;
  const daysSinceEnrolled = enrollment?.issuedAt
    ? Math.floor((Date.now() - enrollment.issuedAt.getTime()) / 86400000)
    : 0;

  // Check which badges are unlocked
  const unlockedBadges = ALL_BADGES.filter((b) => {
    if (b.id === "first_steps") return evidenceCount >= 1;
    if (b.id === "evidence_collector") return evidenceCount >= 10;
    if (b.id === "century") return evidenceCount >= 100;
    if (b.id === "streak_spark") return false; // Can't compute without streak data
    if (b.id === "silver_tier") return rep.score >= 200;
    if (b.id === "gold_tier") return rep.score >= 400;
    if (b.id === "diamond_tier") return rep.score >= 850;
    if (b.id === "artifact_multitool") return artifactTypes.size >= 10;
    if (b.id === "perfectionist") return evidenceCount >= 50 && corrections === 0;
    if (b.id === "veteran") return daysSinceEnrolled >= 90;
    return false;
  });

  return svgResponse(
    digestSvg({
      short: commitment.slice(0, 12),
      score: rep.score,
      tier: rep.tierLabel,
      tierColor: rep.tierColor,
      evidenceCount,
      evidenceThisWeek,
      successRate: successRate30d != null ? `${Math.round(successRate30d * 100)}%` : "—",
      trajectory: trajectory7d === "UP" ? "↗️" : trajectory7d === "DOWN" ? "↘️" : "→",
      badges: unlockedBadges.length,
      daysActive: daysSinceEnrolled,
      streak: "—", // Would need streak endpoint
    }),
    3600
  );
}

interface DigestData {
  error?: string;
  short?: string;
  score?: number;
  tier?: string;
  tierColor?: string;
  evidenceCount?: number;
  evidenceThisWeek?: number;
  successRate?: string;
  trajectory?: string;
  badges?: number;
  daysActive?: number;
  streak?: string;
}

function digestSvg(data: DigestData): string {
  if (data.error) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
      <rect width="600" height="400" rx="16" fill="#0f172a"/>
      <text x="300" y="200" font-family="Verdana,sans-serif" font-size="20" fill="#94a3b8" text-anchor="middle">${esc(data.error)}</text>
    </svg>`;
  }

  const W = 600, H = 400;
  const c = data.tierColor || "#6366f1";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Passport Weekly Digest">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c}"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  <rect x="0" y="0" width="8" height="${H}" fill="url(#accent)"/>

  <!-- Header -->
  <text x="28" y="44" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#ffffff">PASSPORT</text>
  <text x="28" y="68" font-family="Verdana,sans-serif" font-size="14" fill="#64748b">Weekly Reputation Digest</text>

  <!-- Agent Info -->
  <text x="28" y="108" font-family="monospace" font-size="12" fill="#94a3b8">${esc(data.short || "—")}</text>

  <!-- Score -->
  <text x="300" y="120" font-family="Verdana,sans-serif" font-size="48" font-weight="bold" fill="${c}" text-anchor="middle">${data.score || 0}</text>
  <text x="300" y="142" font-family="Verdana,sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">${esc(data.tier || "—")}</text>

  <!-- Stats Grid -->
  <rect x="28" y="170" width="126" height="90" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <text x="91" y="196" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${data.evidenceCount || 0}</text>
  <text x="91" y="216" font-family="Verdana,sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Total Evidence</text>
  <text x="91" y="240" font-family="Verdana,sans-serif" font-size="11" fill="#38bdf8" text-anchor="middle">+${data.evidenceThisWeek || 0} this week</text>

  <rect x="166" y="170" width="126" height="90" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <text x="229" y="196" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(data.successRate || "—")}</text>
  <text x="229" y="216" font-family="Verdana,sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Success Rate</text>
  <text x="229" y="240" font-family="Verdana,sans-serif" font-size="11" fill="#38bdf8" text-anchor="middle">30-day rolling</text>

  <rect x="304" y="170" width="126" height="90" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <text x="367" y="196" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${data.badges || 0}</text>
  <text x="367" y="216" font-family="Verdana,sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Badges</text>
  <text x="367" y="240" font-family="Verdana,sans-serif" font-size="11" fill="#38bdf8" text-anchor="middle">achievements</text>

  <rect x="442" y="170" width="126" height="90" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <text x="505" y="196" font-family="Verdana,sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${data.daysActive || 0}</text>
  <text x="505" y="216" font-family="Verdana,sans-serif" font-size="11" fill="#64748b" text-anchor="middle">Days Active</text>
  <text x="505" y="240" font-family="Verdana,sans-serif" font-size="11" fill="#38bdf8" text-anchor="middle">${esc(data.trajectory || "→")}</text>

  <!-- Footer -->
  <text x="28" y="310" font-family="Verdana,sans-serif" font-size="11" fill="#64748b">Verify this agent: passport.metis.gold/verify/${esc(data.short || "")}</text>
  <text x="28" y="330" font-family="Verdana,sans-serif" font-size="11" fill="#475569">Every action is Ed25519-signed and Merkle-checkpointed.</text>
  <text x="28" y="350" font-family="Verdana,sans-serif" font-size="11" fill="#475569">No trust required — math is the authority.</text>

  <!-- Badge -->
  <rect x="440" y="290" width="140" height="36" rx="8" fill="${c}22" stroke="${c}" stroke-width="1"/>
  <text x="510" y="314" font-family="Verdana,sans-serif" font-size="12" font-weight="bold" fill="${c}" text-anchor="middle">Passport.metis.gold</text>
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svgResponse(svg: string, maxAge: number): NextResponse {
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}