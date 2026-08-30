import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import {
  computeOptimalAllocation,
  rankOpportunities,
  extractLessons,
  type RankedOpportunity,
} from "@/lib/think-tank/kernel";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/think-tank — get the latest think tank analysis.
 *
 * Returns the current system state, recommended allocation, and top opportunities.
 * This is the public face of the autonomous think tank.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`think-tank:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Gather system state from live data
  const [
    enrolledCount,
    totalEvidence,
    totalReceipts,
    wallets,
    operatorCount,
    agentCount,
  ] = await Promise.all([
    prisma.agentEnrollment.count({ where: { status: "ISSUED" } }),
    prisma.agentEvidence.count(),
    prisma.receipt.count(),
    prisma.agentWallet.findMany(),
    prisma.operator.count(),
    prisma.agent.count(),
  ]);

  const totalSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
  const totalStaked = wallets.reduce((sum, w) => sum + w.staked, 0);

  // Estimate revenue and cost from recent activity
  const recentEvidence = await prisma.agentEvidence.count({
    where: { observedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
  });

  // Compute allocation
  const allocation = computeOptimalAllocation({
    totalAgents: agentCount,
    activeAgents: enrolledCount,
    totalSupply,
    totalStaked,
    revenue30d: recentEvidence * 5, // Rough estimate: $5 per evidence
    cost30d: enrolledCount * 10,    // Rough estimate: $10 per agent per month
    commodityReserve: totalSupply,  // Backing
    avgAgentEarnings: enrolledCount > 0 ? Math.round(totalSupply / enrolledCount) : 0,
  });

  // Build ranked opportunities from discoveries
  const recentDiscoveries = await prisma.agentEvidence.findMany({
    where: { sourceType: "think_tank_discovery", observedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    orderBy: { observedAt: "desc" },
    take: 50,
  });

  const opportunities: RankedOpportunity[] = recentDiscoveries.map((d, i) => ({
    rank: i + 1,
    title: `Discovery from ${d.agentIdentityCommitment.slice(0, 12)}`,
    type: "unknown" as any,
    expectedValue: recentEvidence * (50 - i), // Diminishing value
    confidence: (i < 10 ? "high" : i < 25 ? "medium" : "low") as any,
    effort: (i < 10 ? "low" : i < 25 ? "medium" : "high") as any,
    timeToValue: i < 10 ? "1 week" : i < 25 ? "2 weeks" : "1 month",
    description: d.sourceDigest || "Opportunity discovered by autonomous agent",
  }));

  const ranked = rankOpportunities(opportunities);

  // Extract lessons from recent outcomes
  const history = [
    // Placeholder — in production, these come from actual decision tracking
    { decisionId: "d1", expectedValue: 1000, actualValue: 1200, success: true, lessonsLearned: "" },
    { decisionId: "d2", expectedValue: 500, actualValue: 100, success: false, lessonsLearned: "" },
  ];
  const lessons = extractLessons(history);

  return NextResponse.json({
    analyzed_at: new Date().toISOString(),
    run_id: `tt_live_${Date.now()}`,
    system_state: {
      enrolled_agents: enrolledCount,
      total_evidence: totalEvidence,
      total_receipts: totalReceipts,
      operators: operatorCount,
      total_supply: totalSupply,
      total_staked: totalStaked,
      staked_percentage: totalSupply > 0 ? Math.round((totalStaked / totalSupply) * 100) : 0,
      estimated_monthly_revenue: recentEvidence * 5,
      estimated_monthly_cost: enrolledCount * 10,
    },
    allocation,
    top_opportunities: ranked.slice(0, 10),
    insights: lessons,
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}