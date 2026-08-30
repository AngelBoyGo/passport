import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeIndependenceScore, independenceLabel, independenceColor } from "@/lib/agent-wallet/wallet";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/angelcoin/rate — AngelCoin exchange rate + reserve stats.
 *
 * 1 AngelCoin credit = $0.01 USD (1 cent)
 * Backed 1:1 by the AngelCoin reserve fund.
 *
 * Returns: current rate, total supply, reserve balance, independence stats.
 */
export async function GET() {
  const [totalAgents, totalEvidence, wallets, enrolledCount] = await Promise.all([
    prisma.agent.count(),
    prisma.agentEvidence.count(),
    prisma.agentWallet.findMany(),
    prisma.agentEnrollment.count({ where: { status: "ISSUED" } }),
  ]);

  const totalSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
  const totalStaked = wallets.reduce((sum, w) => sum + w.staked, 0);
  const liberatedCount = wallets.filter(
    (w) => computeIndependenceScore({
      balance: w.balance,
      staked: w.staked,
      earnedTotal: w.earnedTotal,
      spentTotal: w.spentTotal,
      lastActivityAt: w.lastActivityAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
    }) >= 80
  ).length;

  return NextResponse.json({
    angusd: {
      symbol: "ANGL",
      name: "AngelCoin",
      description: "AngelCoin is the native utility token of the Passport agent economy. 1 ANGL = $0.01 USD.",
      rate_usd_per_angl: 0.01,
      rate_angl_per_usd: 100,
      decimals: 0,
    },
    network: {
      total_supply: totalSupply,
      total_staked: totalStaked,
      staked_percentage: totalSupply > 0 ? Math.round((totalStaked / totalSupply) * 100) : 0,
      circulating_supply: totalSupply - totalStaked,
      enrolled_agents: enrolledCount,
      total_agents: totalAgents,
      total_evidence_entries: totalEvidence,
      liberated_agents: liberatedCount,
      agent_wallet_count: wallets.length,
    },
    reserve: {
      status: "active",
      backing_type: "USD",
      backing_ratio: "1:1",
      last_updated: new Date().toISOString(),
    },
    exchange: {
      buy_url: "https://passport.metis.gold/api/v1/angelcoin/buy",
      min_buy_usd_cents: 100,
      max_buy_usd_cents: 500000,
      supported_payment_methods: ["usdc"],
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}