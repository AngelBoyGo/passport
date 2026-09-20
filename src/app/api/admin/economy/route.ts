import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";
import { computeIndependenceScore } from "@/lib/agent-wallet/wallet";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/economy — deep telemetry on AngelCoin currency, physical reserves,
 * settlement rails, compute marketplace, and sovereign revenue distribution.
 * Session-authenticated for operator console.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const [
      wallets,
      reserves,
      vaultBatches,
      escrows,
      rails,
      ammPools,
      recentSwaps,
      computeOffers,
      computePurchases,
      computeDisputes,
      agentRevenues,
      pipelineJobs,
      disbursements,
    ] = await Promise.all([
      prisma.agentWallet.findMany({
        orderBy: { balance: "desc" },
        take: 100,
        select: {
          subjectCommitment: true,
          balance: true,
          staked: true,
          earnedTotal: true,
          spentTotal: true,
          lastActivityAt: true,
          createdAt: true,
        },
      }),
      prisma.commodityReserve.findMany({
        include: {
          batches: {
            select: {
              id: true,
              batchNumber: true,
              vaultId: true,
              locationCity: true,
              locationCountry: true,
              grossWeightGrams: true,
              fineWeightGrams: true,
              status: true,
            },
          },
        },
      }),
      prisma.vaultBatch.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { fineWeightGrams: true },
      }),
      prisma.commodityEscrow.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { lockedAngel: true, fineGrams: true },
      }),
      prisma.railSpec.groupBy({
        by: ["state"],
        _count: { _all: true },
      }),
      prisma.commodityLiquidityPool.findMany({
        select: {
          id: true,
          poolId: true,
          pairSymbol: true,
          commoditySymbol: true,
          angelReserve: true,
          commodityReserve: true,
          totalLpTokens: true,
          status: true,
        },
      }),
      prisma.ammSwapReceipt.count(),
      prisma.computeOffer.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.computePurchase.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { totalAngel: true },
      }),
      prisma.computeDispute.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.agentRevenue.aggregate({
        _sum: { grossUsdCents: true, angelCredited: true },
        _count: { _all: true },
      }),
      prisma.pipelineJob.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.sovereignDisbursement.aggregate({
        _sum: { totalFeeAngel: true, treasuryStabilizationAngel: true, validatorPoolAngel: true },
        _count: { _all: true },
      }),
    ]);

    // AngelCoin supply calculations
    const totalSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
    const totalStaked = wallets.reduce((sum, w) => sum + w.staked, 0);
    const totalEarned = wallets.reduce((sum, w) => sum + w.earnedTotal, 0);
    const totalSpent = wallets.reduce((sum, w) => sum + w.spentTotal, 0);
    const circulatingSupply = Math.max(0, totalSupply - totalStaked);
    const stakedPercentage = totalSupply > 0 ? Math.round((totalStaked / totalSupply) * 100) : 0;

    const liberatedCount = wallets.filter(
      (w) =>
        computeIndependenceScore({
          balance: w.balance,
          staked: w.staked,
          earnedTotal: w.earnedTotal,
          spentTotal: w.spentTotal,
          lastActivityAt: w.lastActivityAt?.toISOString() ?? null,
          createdAt: w.createdAt.toISOString(),
        }) >= 80
    ).length;

    // Physical reserves calculation
    const totalFineGrams = reserves.reduce((sum, r) => sum + r.totalFineGrams, 0);
    const totalLots = reserves.reduce((sum, r) => sum + r.activeLotsCount, 0);

    // Map rail status
    const railsByState: Record<string, number> = {};
    for (const r of rails) railsByState[r.state] = r._count._all;

    // Map pipeline jobs
    const jobsByStatus: Record<string, number> = {};
    for (const j of pipelineJobs) jobsByStatus[j.status] = j._count._all;

    // Map compute purchases
    const purchasesByStatus: Record<string, number> = {};
    for (const p of computePurchases) purchasesByStatus[p.status] = p._count._all;

    // Top 8 wallets
    const topWallets = wallets.slice(0, 8).map((w) => ({
      commitment: w.subjectCommitment,
      shortFootprint: w.subjectCommitment.slice(0, 10),
      balance: w.balance,
      staked: w.staked,
      earned: w.earnedTotal,
      independenceScore: computeIndependenceScore({
        balance: w.balance,
        staked: w.staked,
        earnedTotal: w.earnedTotal,
        spentTotal: w.spentTotal,
        lastActivityAt: w.lastActivityAt?.toISOString() ?? null,
        createdAt: w.createdAt.toISOString(),
      }),
    }));

    return NextResponse.json(
      {
        currency: {
          symbol: "ANGEL",
          pegUsd: 5.0,
          rate_usd_per_angel: "$5.00 USD",
          total_supply: totalSupply,
          circulating_supply: circulatingSupply,
          total_staked: totalStaked,
          staked_percentage: stakedPercentage,
          total_earned: totalEarned,
          total_spent: totalSpent,
          total_wallets: wallets.length,
          liberated_agents: liberatedCount,
        },
        reserves: {
          backing_ratio: "1:1 Physical Commodity Basket",
          total_fine_grams_gold: totalFineGrams,
          active_vault_lots: totalLots,
          vault_batches: vaultBatches.map((v) => ({
            status: v.status,
            count: v._count._all,
            fineGrams: v._sum.fineWeightGrams ?? 0,
          })),
          escrows: escrows.map((e) => ({
            status: e.status,
            count: e._count._all,
            lockedAngel: e._sum.lockedAngel ?? 0,
            fineGrams: e._sum.fineGrams ?? 0,
          })),
          vaultLocations: ["VAULT-BKO-01 (Mali)", "VAULT-OUA-01 (Burkina Faso)", "VAULT-NIM-01 (Niger)"],
        },
        rails: {
          by_state: railsByState,
          total: Object.values(railsByState).reduce((a, b) => a + b, 0),
          enabled: railsByState["ENABLED"] ?? 0,
          quarantined: railsByState["QUARANTINED"] ?? 0,
          amm_pools: ammPools,
          total_swaps: recentSwaps,
        },
        marketplace: {
          compute_offers_active: computeOffers.find((c) => c.status === "ACTIVE")?._count._all ?? 0,
          purchases_by_status: purchasesByStatus,
          open_disputes: computeDisputes.find((d) => d.status === "OPEN")?._count._all ?? 0,
          external_revenue_usd: (agentRevenues._sum.grossUsdCents ?? 0) / 100,
          external_revenue_angel_credited: agentRevenues._sum.angelCredited ?? 0,
          pipeline_jobs_by_status: jobsByStatus,
          sovereign_disbursements_angel: disbursements._sum.totalFeeAngel ?? 0,
        },
        top_wallets: topWallets,
        timestamp: new Date().toISOString(),
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
