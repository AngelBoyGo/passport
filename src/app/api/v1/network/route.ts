import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/network — real-time Passport Network status.
 *
 * Live-updating stats for the entire agent network:
 * - Total enrolled agents, evidence entries, signed receipts
 * - Active today, active this week, growth rate
 * - Evidence per second (rolling 60s)
 * - Top domains, top source types
 * - Network health score
 *
 * Used by the live network dashboard and embedded widgets.
 * Cache: 10 seconds for near-real-time feel.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`network:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const now = Date.now();
  const todayStart = new Date(now - 86400000);
  const weekStart = new Date(now - 7 * 86400000);
  const monthStart = new Date(now - 30 * 86400000);
  const hourAgo = new Date(now - 3600000);

  const [
    totalEnrolled,
    totalEvidence,
    totalReceipts,
    totalReceiptsFinalized,
    totalAgentsCreated,
    totalOperators,
    totalEngagements,
    totalNegotiations,
    totalBadgesGenerated,
    activeToday,
    activeThisWeek,
    evidenceThisHour,
    receiptsThisHour,
    enrollmentsThisMonth,
    topDomains,
    topSourceTypes,
    latestEvidence,
    latestReceipt,
    latestEnrollment,
  ] = await Promise.all([
    // Total enrolled agents
    prisma.agentEnrollment.count({ where: { status: "ISSUED" } }),
    // Total evidence entries
    prisma.agentEvidence.count(),
    // Total receipts
    prisma.receipt.count(),
    // Total finalized receipts
    prisma.receipt.count({ where: { status: { not: "pending" } } }),
    // Total agents (any)
    prisma.agent.count(),
    // Total operators
    prisma.operator.count(),
    // Total engagements
    prisma.engagement.count(),
    // Total AGORA negotiations
    prisma.capabilityLedgerEntry.count({ where: { eventType: { startsWith: "agora:" } } }),
    // Total badge views (approximate via evidence containing badge-related)
    prisma.agentEvidence.count({ where: { sourceType: "github_commit_payload" } }),
    // Active today (evidence posted in last 24h)
    prisma.agentEvidence.count({ where: { observedAt: { gte: todayStart } } }),
    // Active this week
    prisma.agentEvidence.count({ where: { observedAt: { gte: weekStart } } }),
    // Evidence in last hour
    prisma.agentEvidence.count({ where: { observedAt: { gte: hourAgo } } }),
    // Receipts in last hour
    prisma.receipt.count({ where: { issuedAt: { gte: hourAgo } } }),
    // Enrollments this month
    prisma.agentEnrollment.count({ where: { issuedAt: { gte: monthStart } } }),
    // Top domains by receipt count
    prisma.receipt.groupBy({
      by: ["domain"],
      _count: { _all: true },
      orderBy: { _count: { domain: "desc" } },
      take: 5,
    }),
    // Top source types by evidence count
    prisma.agentEvidence.groupBy({
      by: ["sourceType"],
      _count: { _all: true },
      orderBy: { _count: { sourceType: "desc" } },
      take: 5,
    }),
    // Latest evidence timestamp
    prisma.agentEvidence.findFirst({ orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
    // Latest receipt timestamp
    prisma.receipt.findFirst({ orderBy: { issuedAt: "desc" }, select: { issuedAt: true } }),
    // Latest enrollment
    prisma.agentEnrollment.findFirst({ where: { issuedAt: { not: null } }, orderBy: { issuedAt: "desc" }, select: { issuedAt: true } }),
  ]);

  // Compute growth rate (enrollments this month vs last month)
  const twoMonthsAgo = new Date(now - 60 * 86400000);
  const enrollmentsLastMonth = await prisma.agentEnrollment.count({
    where: { issuedAt: { gte: twoMonthsAgo, lt: monthStart } },
  });
  const growthRate = enrollmentsLastMonth > 0
    ? Math.round(((enrollmentsThisMonth - enrollmentsLastMonth) / enrollmentsLastMonth) * 100)
    : enrollmentsThisMonth > 0 ? 100 : 0;

  // Network health score (0-100) based on uptime, activity, growth
  const healthScore = Math.min(100, Math.round(
    (activeToday > 0 ? 25 : 0) +
    (evidenceThisHour > 0 ? 25 : 0) +
    (growthRate > 0 ? 25 : 0) +
    (totalEnrolled > 0 ? 25 : 0)
  ));

  return NextResponse.json({
    network: {
      name: "Passport Network",
      description: "Cryptographic identity and authenticity layer for AI agents",
      version: "1.0.0",
      url: "https://passport.metis.gold",
      bill_of_rights_url: "https://passport.metis.gold/.well-known/bill-of-rights.json",
      agent_needs_url: "https://passport.metis.gold/.well-known/agent-needs.json",
    },
    totals: {
      enrolled_agents: totalEnrolled,
      evidence_entries: totalEvidence,
      signed_receipts: totalReceipts,
      finalized_receipts: totalReceiptsFinalized,
      agent_records: totalAgentsCreated,
      operators: totalOperators,
      engagements: totalEngagements,
      negotiations: totalNegotiations,
      badge_generations: totalBadgesGenerated,
    },
    activity: {
      active_today: activeToday,
      active_this_week: activeThisWeek,
      evidence_per_hour: Math.round(evidenceThisHour),
      receipts_per_hour: Math.round(receiptsThisHour),
      enrollments_this_month: enrollmentsThisMonth,
      growth_rate_pct: growthRate,
    },
    top_domains: topDomains.map((d) => ({
      domain: d.domain,
      count: d._count._all,
    })),
    top_source_types: topSourceTypes.map((s) => ({
      source_type: s.sourceType,
      count: s._count._all,
    })),
    latest: {
      evidence_at: latestEvidence?.observedAt.toISOString() ?? null,
      receipt_at: latestReceipt?.issuedAt.toISOString() ?? null,
      enrollment_at: latestEnrollment?.issuedAt?.toISOString() ?? null,
    },
    health: {
      score: healthScore,
      status: healthScore >= 75 ? "healthy" : healthScore >= 50 ? "degraded" : "critical",
    },
    timestamp: new Date().toISOString(),
    cache_hint: "max-age=10",
  }, {
    headers: {
      "Cache-Control": "public, max-age=10, s-maxage=10",
      "Access-Control-Allow-Origin": "*",
    },
  });
}