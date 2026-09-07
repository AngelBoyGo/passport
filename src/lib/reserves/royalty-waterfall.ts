/**
 * Statutory Sovereign Dividend Waterfall & Anti-Extraction Royalty Engine
 *
 * Implements the on-chain statutory revenue-sharing pallet from Black Paper Q141:
 *   Fee_total = Fee_state (40%) + Fee_treasury (30%) + Fee_validators (20%) + Fee_agent (10%)
 *
 * Sub-divided state dividend:
 *   Fee_state = Dividend_national (50%) + Dividend_local_community (30%) + Dividend_workers (20%)
 *
 * Guaranteed mathematical invariant:
 *   TotalFee === stateNational + stateCommunity + stateWorkers + treasury + validators + agentRebate
 *   (Zero fractional leakage: all floor remainders are absorbed by the National Treasury dividend).
 */

import { prisma } from "@/lib/db";

export interface LocationContext {
  country: string;
  district?: string;
}

export interface StatutoryWaterfallResult {
  totalFeeAngel: number;
  stateNationalAngel: number;
  stateCommunityAngel: number;
  stateWorkersAngel: number;
  treasuryStabilizationAngel: number;
  validatorPoolAngel: number;
  agentRebateAngel: number;
  districtName: string;
  countryCode: string;
}

/**
 * Pure calculation of the statutory fee distribution with zero fractional leakage.
 */
export function calculateStatutoryWaterfall(
  totalFeeAngel: number,
  location: LocationContext
): StatutoryWaterfallResult {
  const fee = Math.max(0, Math.floor(totalFeeAngel));
  const countryCode = (location.country || "ML").toUpperCase();
  const districtName = location.district || "Central Mining District";

  if (fee === 0) {
    return {
      totalFeeAngel: 0,
      stateNationalAngel: 0,
      stateCommunityAngel: 0,
      stateWorkersAngel: 0,
      treasuryStabilizationAngel: 0,
      validatorPoolAngel: 0,
      agentRebateAngel: 0,
      districtName,
      countryCode,
    };
  }

  // 1. Primary allocation tranches
  const stateShare = Math.floor(fee * 0.40);
  const treasury = Math.floor(fee * 0.30);
  const validators = Math.floor(fee * 0.20);
  const agentRebate = Math.floor(fee * 0.10);

  // 2. State dividend sub-split
  const community = Math.floor(stateShare * 0.30);
  const workers = Math.floor(stateShare * 0.20);
  // National Treasury absorbs the state-tier remainder
  let national = stateShare - (community + workers);

  // 3. Remainder absorption: allocate any global unallocated fee dust to the National Treasury
  const allocatedSum = national + community + workers + treasury + validators + agentRebate;
  const dustRemainder = fee - allocatedSum;
  if (dustRemainder > 0) {
    national += dustRemainder;
  }

  // Invariant verification
  const totalVerified = national + community + workers + treasury + validators + agentRebate;
  if (totalVerified !== fee) {
    throw new Error(
      `Waterfall invariant violation: total ${fee} != sum ${totalVerified}`
    );
  }

  return {
    totalFeeAngel: fee,
    stateNationalAngel: national,
    stateCommunityAngel: community,
    stateWorkersAngel: workers,
    treasuryStabilizationAngel: treasury,
    validatorPoolAngel: validators,
    agentRebateAngel: agentRebate,
    districtName,
    countryCode,
  };
}

/**
 * Persists a sovereign disbursement record inside an existing Prisma transaction.
 * If totalFeeAngel is 0, execution is a no-op and returns null.
 */
export async function executeDisbursementInTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  params: {
    escrowId: string;
    batchNumber: string;
    totalFeeAngel: number;
    location: LocationContext;
  }
) {
  if (params.totalFeeAngel <= 0) {
    return null;
  }

  const waterfall = calculateStatutoryWaterfall(params.totalFeeAngel, params.location);
  const disbursementId = `disb_${params.escrowId.replace(/^esc_/, "")}_${Date.now()}`;

  return tx.sovereignDisbursement.create({
    data: {
      disbursementId,
      escrowId: params.escrowId,
      batchNumber: params.batchNumber,
      totalFeeAngel: waterfall.totalFeeAngel,
      stateNationalAngel: waterfall.stateNationalAngel,
      stateCommunityAngel: waterfall.stateCommunityAngel,
      stateWorkersAngel: waterfall.stateWorkersAngel,
      treasuryStabilizationAngel: waterfall.treasuryStabilizationAngel,
      validatorPoolAngel: waterfall.validatorPoolAngel,
      agentRebateAngel: waterfall.agentRebateAngel,
      districtName: waterfall.districtName,
      countryCode: waterfall.countryCode,
    },
  });
}

/**
 * Retrieves aggregate macroeconomic metrics and recent disbursements for public auditing.
 */
export async function getAggregatedDividends(limit = 10) {
  const disbursements = await prisma.sovereignDisbursement.findMany({
    take: limit,
    orderBy: { disbursedAt: "desc" },
  });

  const allDisbursements = await prisma.sovereignDisbursement.findMany({
    select: {
      totalFeeAngel: true,
      stateNationalAngel: true,
      stateCommunityAngel: true,
      stateWorkersAngel: true,
      treasuryStabilizationAngel: true,
      validatorPoolAngel: true,
      agentRebateAngel: true,
    },
  });

  const totals = allDisbursements.reduce(
    (acc, d) => ({
      totalFeesCapturedAngel: acc.totalFeesCapturedAngel + d.totalFeeAngel,
      nationalTreasuryAngel: acc.nationalTreasuryAngel + d.stateNationalAngel,
      communityTrustAngel: acc.communityTrustAngel + d.stateCommunityAngel,
      workersBonusAngel: acc.workersBonusAngel + d.stateWorkersAngel,
      treasuryStabilizationAngel: acc.treasuryStabilizationAngel + d.treasuryStabilizationAngel,
      validatorPoolAngel: acc.validatorPoolAngel + d.validatorPoolAngel,
      agentRebatesAngel: acc.agentRebatesAngel + d.agentRebateAngel,
      count: acc.count + 1,
    }),
    {
      totalFeesCapturedAngel: 0,
      nationalTreasuryAngel: 0,
      communityTrustAngel: 0,
      workersBonusAngel: 0,
      treasuryStabilizationAngel: 0,
      validatorPoolAngel: 0,
      agentRebatesAngel: 0,
      count: 0,
    }
  );

  return {
    totals,
    recentDisbursements: disbursements.map((d) => ({
      disbursement_id: d.disbursementId,
      escrow_id: d.escrowId,
      batch_number: d.batchNumber,
      total_fee_angel: d.totalFeeAngel,
      state_national_angel: d.stateNationalAngel,
      state_community_angel: d.stateCommunityAngel,
      state_workers_angel: d.stateWorkersAngel,
      treasury_stabilization_angel: d.treasuryStabilizationAngel,
      validator_pool_angel: d.validatorPoolAngel,
      agent_rebate_angel: d.agentRebateAngel,
      district_name: d.districtName,
      country_code: d.countryCode,
      disbursed_at: d.disbursedAt.toISOString(),
    })),
  };
}
