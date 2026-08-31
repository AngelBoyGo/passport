/**
 * Protocol Fee Engine — collects revenue on every economic transaction.
 *
 * Fee structure:
 *   - A2A hire escrow: 2% of engagement amount → protocol treasury
 *   - Compliance packages: 100% to platform (already metered)
 *   - Reputation-as-a-Service: 100% to platform (already metered)
 *   - AngelCoin spread: 0.5% (already built into buy/sell)
 *
 * The protocol treasury is a system-owned AngelCoinAccount that
 * accumulates fees. Revenue is trackable and auditable.
 */

import { prisma } from "@/lib/db";
import { AngelCoinEntryType, AngelCoinCreditState } from "@prisma/client";

const PROTOCOL_FEE_BPS = 200; // 2% in basis points
export const PROTOCOL_TREASURY_COMMITMENT = "protocol_treasury_system";

/**
 * Calculates the protocol fee for an engagement amount.
 * Returns the fee in the same unit as the amount (ANGL credits).
 */
export function calculateProtocolFee(amount: number): { fee: number; net: number; gross: number } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { fee: 0, net: 0, gross: 0 };
  }
  const fee = Math.max(1, Math.floor((amount * PROTOCOL_FEE_BPS) / 10_000));
  return { fee, net: amount - fee, gross: amount };
}

/**
 * Collects the protocol fee by creating a journal entry in the treasury account.
 * Called inside the engagement creation transaction.
 */
export async function collectProtocolFee(
  amount: number,
  engagementTaskId: string,
  tx?: Parameters<typeof prisma.$transaction>[0] extends never ? never : any
): Promise<{ fee: number; treasuryEntryId: string }> {
  const { fee } = calculateProtocolFee(amount);
  if (fee <= 0) {
    return { fee: 0, treasuryEntryId: "" };
  }

  const client = tx || prisma;

  // Get or create the treasury account
  let treasury = await client.angelCoinAccount.findUnique({
    where: { subjectCommitment: PROTOCOL_TREASURY_COMMITMENT },
  });

  if (!treasury) {
    treasury = await client.angelCoinAccount.create({
      data: {
        subjectCommitment: PROTOCOL_TREASURY_COMMITMENT,
        creditState: AngelCoinCreditState.ACTIVE,
      },
    });
  }

  const entry = await client.angelCoinJournalEntry.create({
    data: {
      accountId: treasury.id,
      entryType: AngelCoinEntryType.ADJUSTMENT,
      amount: fee,
      metadata: JSON.stringify({
        source: "protocol_fee",
        engagement_id: engagementTaskId,
        gross_amount: amount,
        fee_bps: PROTOCOL_FEE_BPS,
      }),
    },
  });

  return { fee, treasuryEntryId: entry.id };
}

/**
 * Gets the current treasury balance (total protocol fees collected).
 */
export async function getTreasuryBalance(): Promise<{
  totalFees: number;
  entryCount: number;
  lastFeeAt: string | null;
}> {
  const treasury = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: PROTOCOL_TREASURY_COMMITMENT },
  });

  if (!treasury) {
    return { totalFees: 0, entryCount: 0, lastFeeAt: null };
  }

  const entries = await prisma.angelCoinJournalEntry.findMany({
    where: { accountId: treasury.id },
    orderBy: { createdAt: "desc" },
  });

  const totalFees = entries.reduce((sum, e) => sum + e.amount, 0);

  return {
    totalFees,
    entryCount: entries.length,
    lastFeeAt: entries[0]?.createdAt?.toISOString() ?? null,
  };
}

/**
 * Gets a revenue breakdown by source for the dashboard.
 */
export async function getRevenueBreakdown(): Promise<{
  protocol_fees: { total: number; count: number; last_30d: number };
  subscriptions: { pro_count: number; enterprise_count: number; mrr: number };
  compliance_packages: { total: number; revenue: number };
  metered_credentials: { total: number; revenue: number };
  angelcoin_purchases: { total_usd_cents: number; total_angl: number; count: number };
  treasury_balance: number;
}> {
  const [treasury, proSubs, complianceCount, meteredCount, topups] = await Promise.all([
    getTreasuryBalance(),
    prisma.operator.count({ where: { tier: "pro" } }),
    prisma.agentEvidence.count({ where: { sourceType: "compliance_report" } }),
    prisma.agentEvidence.count({ where: { sourceType: "task_deliverable" } }),
    prisma.operatorLedgerEntry.findMany({
      where: { kind: { in: ["stablecoin_topup", "angelcoin_topup"] } },
      select: { deltaMicros: true, metadata: true, createdAt: true },
    }),
  ]);

  // Compute last 30d protocol fees
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentFees = await prisma.angelCoinJournalEntry.findMany({
    where: {
      entryType: AngelCoinEntryType.ADJUSTMENT,
      metadata: { contains: "protocol_fee" },
      createdAt: { gte: thirtyDaysAgo },
    },
    select: { amount: true },
  });

  // Compute topup totals
  let totalUsdCents = 0;
  let totalAngl = 0;
  for (const topup of topups) {
    totalUsdCents += Math.abs(topup.deltaMicros) / 10_000; // micro-dollars → cents
    try {
      const meta = JSON.parse(topup.metadata || "{}");
      totalAngl += meta.credit_amount || meta.credits || 0;
    } catch {}
  }

  const PRO_PRICE = 49;
  const ENTERPRISE_PRICE = 500;

  return {
    protocol_fees: {
      total: treasury.totalFees,
      count: treasury.entryCount,
      last_30d: recentFees.reduce((sum, e) => sum + e.amount, 0),
    },
    subscriptions: {
      pro_count: proSubs,
      enterprise_count: 0, // Would need an enterprise tier check
      mrr: proSubs * PRO_PRICE,
    },
    compliance_packages: {
      total: complianceCount,
      revenue: complianceCount * 200, // avg $200
    },
    metered_credentials: {
      total: meteredCount,
      revenue: meteredCount * 5, // avg 5 ANGL = $0.05
    },
    angelcoin_purchases: {
      total_usd_cents: Math.round(totalUsdCents),
      total_angl: totalAngl,
      count: topups.length,
    },
    treasury_balance: treasury.totalFees,
  };
}