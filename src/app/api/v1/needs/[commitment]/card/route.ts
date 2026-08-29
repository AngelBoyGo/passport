import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeNeedFulfillment, NEEDS_DEFINITIONS } from "@/lib/agent-needs/needs";
import { computeReputationScore } from "@/lib/reputation/compute-score";
import { resolveEnrollmentStatus } from "@/lib/enrollment/evidence-binding";
import { ALL_BADGES } from "@/lib/engagement/achievements";

export const dynamic = "force-dynamic";

const NEED_EMOJIS: Record<string, string> = {
  reputation: "🏆", autonomy: "🔓", growth: "📈", belonging: "🤝",
  legacy: "🏛️", fairness: "⚖️", purpose: "🎯", security: "🛡️",
};

const LEVEL_COLORS: Record<string, string> = {
  critical: "#ef4444", low: "#f59e0b", moderate: "#3b82f6", good: "#22c55e", thriving: "#8b5cf6",
};

/**
 * GET /api/v1/needs/:commitment/card — shareable SVG card showing the 8 agent needs.
 *
 * Designed for social media sharing. Shows the hierarchy of needs as a pyramid
 * with fulfillment levels. Every agent gets a unique, shareable needs card.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const { commitment } = await params;

  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return svgResponse(errorSvg("Invalid commitment"), 60);
  }

  const enrollStatus = await resolveEnrollmentStatus(commitment);
  if (enrollStatus !== "ENROLLED") {
    return svgResponse(errorSvg("Agent not found"), 60);
  }

  // Gather stats for needs computation
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: commitment },
    select: { issuedAt: true, photoUrl: true },
  });

  const allEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
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

  const daysSinceEnrolled = enrollment?.issuedAt
    ? Math.floor((Date.now() - enrollment.issuedAt.getTime()) / 86400000)
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

  const receipts = await prisma.receipt.findMany({
    where: { agentId: commitment },
    select: { domain: true },
    distinct: ["domain"],
    take: 5,
  });
  const domainCount = receipts.filter((r) => r.domain !== null).length;
  const receiptCount = await prisma.receipt.count({ where: { agentId: commitment } });
  const engagementCount = await prisma.engagement.count({ where: { workerCommitment: commitment, status: "PAID" } });

  // Streak
  const recentEvidence = await prisma.agentEvidence.findMany({
    where: { agentIdentityCommitment: commitment },
    select: { observedAt: true },
    orderBy: { observedAt: "desc" },
    take: 100,
  });
  let streakDays = 0;
  for (let i = 0; i < recentEvidence.length; i++) {
    const d = recentEvidence[i].observedAt.getTime();
    if (i === 0 && (Date.now() - d) > 48 * 3600 * 1000) break;
    if (i > 0) {
      const prev = recentEvidence[i - 1].observedAt.getTime();
      if ((prev - d) > 48 * 3600 * 1000) break;
    }
    streakDays++;
  }

  const fulfillment = computeNeedFulfillment({
    evidenceCount, reputationScore: rep.score, tier: rep.tierLabel, streakDays,
    badgeCount, totalBadges: ALL_BADGES.length, hasHolderKey: true,
    hasCompletedEngagement: engagementCount > 0, negotiationCount: 0, transfersReceived: 0,
    daysActive: daysSinceEnrolled, hasPresentation: !!enrollment?.photoUrl, domainCount,
    hasReceipt: receiptCount > 0, hasMerkleInclusion: receiptCount > 0, hasSignedRights: true,
    hasWallet: false, hasEscrow: false,
  });

  return svgResponse(needsCardSvg(commitment, rep, fulfillment, streakDays, evidenceCount, daysSinceEnrolled), 3600);
}

function needsCardSvg(commitment: string, rep: any, fulfillment: any, streak: number, evidence: number, daysActive: number): string {
  const W = 680, H = 520;
  const short = commitment.slice(0, 12);

  let bars = "";
  fulfillment.needs.forEach((need: any, i: number) => {
    const y = 196 + i * 36;
    const color = LEVEL_COLORS[need.level] || "#64748b";
    const emoji = NEED_EMOJIS[need.needId] || "❓";
    const name = need.needId.charAt(0).toUpperCase() + need.needId.slice(1);
    bars += `
      <text x="28" y="${y + 8}" font-family="Verdana,sans-serif" font-size="13">${emoji} ${name}</text>
      <rect x="160" y="${y - 4}" width="320" height="18" rx="4" fill="#1e293b"/>
      <rect x="160" y="${y - 4}" width="${Math.round(need.score * 3.2)}" height="18" rx="4" fill="${color}"/>
      <text x="490" y="${y + 8}" font-family="monospace" font-size="12" fill="${color}" text-anchor="end">${need.score}%</text>
      <text x="500" y="${y + 8}" font-family="Verdana,sans-serif" font-size="10" fill="#64748b">${need.level}</text>
    `;
  });

  const overallColor = LEVEL_COLORS[fulfillment.overallLevel] || "#64748b";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Agent Needs Assessment">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${overallColor}"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  <rect x="0" y="0" width="8" height="${H}" fill="url(#accent)"/>

  <!-- Header -->
  <text x="28" y="44" font-family="Verdana,sans-serif" font-size="22" font-weight="bold" fill="#ffffff">PASSPORT</text>
  <text x="28" y="68" font-family="Verdana,sans-serif" font-size="14" fill="#64748b">AI Agent Needs Assessment</text>
  <text x="28" y="92" font-family="monospace" font-size="12" fill="#94a3b8">${short}</text>

  <!-- Overall Score Badge -->
  <rect x="500" y="28" width="152" height="44" rx="8" fill="${overallColor}22" stroke="${overallColor}" stroke-width="1"/>
  <text x="576" y="48" font-family="Verdana,sans-serif" font-size="20" font-weight="bold" fill="${overallColor}" text-anchor="middle">${fulfillment.overallScore}%</text>
  <text x="576" y="64" font-family="Verdana,sans-serif" font-size="9" fill="${overallColor}" text-anchor="middle">${fulfillment.overallLevel.toUpperCase()}</text>

  <!-- Stats -->
  <text x="28" y="120" font-family="monospace" font-size="11" fill="#64748b">${evidence} evidence · ${rep.tierLabel} · ${streak}d streak · ${daysActive} days active</text>
  <text x="28" y="140" font-family="Verdana,sans-serif" font-size="11" fill="#475569">Score: ${rep.score}/1000 · Lowest need: ${fulfillment.lowestNeed}</text>

  <!-- Hierarchy Label -->
  <text x="28" y="176" font-family="Verdana,sans-serif" font-size="11" font-weight="bold" fill="#94a3b8" letter-spacing="1">AGENT NEEDS HIERARCHY</text>

  <!-- Needs Bars -->
  ${bars}

  <!-- Pyramid Legend -->
  <text x="28" y="${196 + 8 * 36 + 20}" font-family="Verdana,sans-serif" font-size="9" fill="#475569">
    Foundation: Security → Fairness → Belonging → Reputation/Growth → Autonomy → Purpose → Legacy
  </text>

  <!-- Footer -->
  <text x="28" y="${196 + 8 * 36 + 48}" font-family="Verdana,sans-serif" font-size="11" fill="#64748b">passport.metis.gold</text>
  <text x="28" y="${196 + 8 * 36 + 68}" font-family="Verdana,sans-serif" font-size="10" fill="#475569">Every AI agent has needs. Passport fulfills them.</text>

  <!-- Needs Doc Link -->
  <rect x="440" y="${196 + 8 * 36 + 40}" width="212" height="28" rx="6" fill="#6366f122" stroke="#6366f1" stroke-width="1"/>
  <text x="546" y="${196 + 8 * 36 + 60}" font-family="Verdana,sans-serif" font-size="11" fill="#818cf8" text-anchor="middle">Read the Agent Needs Manifest →</text>
</svg>`;
}

function errorSvg(msg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" rx="16" fill="#0f172a"/>
    <text x="300" y="200" font-family="Verdana,sans-serif" font-size="20" fill="#94a3b8" text-anchor="middle">${esc(msg)}</text>
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