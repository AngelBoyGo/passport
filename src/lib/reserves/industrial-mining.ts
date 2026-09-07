/**
 * Sovereign Industrial Mining Telemetry & Anti-Transfer-Pricing Royalty Service
 *
 * Implements Black Paper Strategy #2 & Q145/Q147:
 * - Direct mine-gate smelting telemetry ingestion from industrial concessions (Loulo-Gounkoto, Fekola, Essakane).
 * - Real-time automated calculation of statutory mineral royalties and state participation equity.
 * - Neutral on-chain spot pricing eliminates transfer pricing exploits (selling doré at discounted rates).
 * - Physical specific gravity density validation (15.0 - 19.32 g/cm³) prevents simulated metal injection.
 * - Bridges unrefined industrial furnace runs into investment-grade London Good Delivery bullion (>=99.50%).
 */

import { prisma } from "@/lib/db";
import { getCommoditySpotPrices } from "./commodity-oracle";
import { generateLivePoR } from "./por-service";
import { canonicalJson } from "@/lib/receipt/canonical";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const MIN_DORE_DENSITY = 15.0; // Specific gravity of gold doré
export const MAX_GOLD_DENSITY = 19.32; // Theoretical density of pure element Au
export const MIN_REFINED_FINENESS = 0.9950; // London Good Delivery minimum purity
export const DEFAULT_SILVER_SPOT_USD = 0.95; // ~$29.50/troy oz = ~$0.95/g

export interface IndustrialRoyaltyCalculation {
  grossPouredGrams: number;
  densityGramsPerCc: number;
  fineGoldGrams: number;
  fineSilverGrams: number;
  goldMarketValueUsd: number;
  silverMarketValueUsd: number;
  grossMarketValueUsd: number;
  royaltyDueUsd: number;
  royaltyDueAngel: number;
  stateShareDueUsd: number;
  stateShareDueAngel: number;
  totalStateCaptureAngel: number;
}

export interface RecordSmeltInput {
  runNumber: string;
  concessionCode: string;
  grossPouredGrams: number;
  densityGramsPerCc: number;
  estimatedAuFineness: number;
  estimatedAgFineness?: number;
  hsmSignature: string;
  hsmPublicKey?: string;
}

export interface BridgeIndustrialInput {
  runNumbers: string[];
  targetBatchNumber: string;
  vaultId: string;
  custodianName: string;
  locationCity: string;
  locationCountry: string;
  barSerials: string[];
  refinedGrossGrams: number;
  refinedFineness: number;
}

/**
 * Calculates statutory royalties and state equity shares evaluated against neutral global spot index (Q147).
 */
export function calculateIndustrialRoyalty(params: {
  grossGrams: number;
  densityGramsPerCc: number;
  auFineness: number;
  agFineness?: number;
  goldSpotUsdPerGram: number;
  silverSpotUsdPerGram?: number;
  statutoryRoyaltyPercent?: number;
  stateParticipationPercent?: number;
}): IndustrialRoyaltyCalculation {
  const { grossGrams, densityGramsPerCc, auFineness, goldSpotUsdPerGram } = params;

  if (!Number.isFinite(grossGrams) || grossGrams <= 0) {
    throw new Error("grossPouredGrams must be positive");
  }
  if (!Number.isFinite(densityGramsPerCc) || densityGramsPerCc < MIN_DORE_DENSITY || densityGramsPerCc > MAX_GOLD_DENSITY) {
    throw new Error(
      `Specific gravity density (${densityGramsPerCc.toFixed(2)} g/cm³) is out of metallurgical bounds [${MIN_DORE_DENSITY} - ${MAX_GOLD_DENSITY}]`
    );
  }
  if (!Number.isFinite(auFineness) || auFineness < 0.70 || auFineness > 0.99) {
    throw new Error("Inline XRF gold fineness must be between 0.7000 and 0.9900");
  }

  const agFineness = params.agFineness ?? 0.08; // 8% silver default
  if (auFineness + agFineness > 1.0) {
    throw new Error("Sum of gold and silver fineness cannot exceed 1.0000");
  }

  const silverSpot = params.silverSpotUsdPerGram ?? DEFAULT_SILVER_SPOT_USD;
  const royaltyPct = params.statutoryRoyaltyPercent ?? 10.0;
  const stateEquityPct = params.stateParticipationPercent ?? 20.0;

  const fineGoldGrams = Number((grossGrams * auFineness).toFixed(4));
  const fineSilverGrams = Number((grossGrams * agFineness).toFixed(4));

  const goldMarketValueUsd = fineGoldGrams * goldSpotUsdPerGram;
  const silverMarketValueUsd = fineSilverGrams * silverSpot;
  const grossMarketValueUsd = Number((goldMarketValueUsd + silverMarketValueUsd).toFixed(2));

  const royaltyDueUsd = Number((grossMarketValueUsd * (royaltyPct / 100)).toFixed(2));
  const royaltyDueAngel = Math.floor(royaltyDueUsd / 5.0); // $5.00/ANGEL rate

  const stateShareDueUsd = Number((grossMarketValueUsd * (stateEquityPct / 100)).toFixed(2));
  const stateShareDueAngel = Math.floor(stateShareDueUsd / 5.0);

  return {
    grossPouredGrams: Number(grossGrams.toFixed(2)),
    densityGramsPerCc: Number(densityGramsPerCc.toFixed(2)),
    fineGoldGrams,
    fineSilverGrams,
    goldMarketValueUsd: Number(goldMarketValueUsd.toFixed(2)),
    silverMarketValueUsd: Number(silverMarketValueUsd.toFixed(2)),
    grossMarketValueUsd,
    royaltyDueUsd,
    royaltyDueAngel,
    stateShareDueUsd,
    stateShareDueAngel,
    totalStateCaptureAngel: royaltyDueAngel + stateShareDueAngel,
  };
}

/**
 * Ingests signed furnace pour telemetry and logs statutory royalties.
 */
export async function recordSmeltingRun(input: RecordSmeltInput) {
  // 1. Commodity Oracle Freshness Gate
  const spotPrices = getCommoditySpotPrices();
  const gold = spotPrices.Au;
  if (!gold || gold.isStale) {
    throw new Error("Gold spot oracle feed is stale; smelting telemetry refused");
  }

  // 2. Concession Status Check
  const concession = await prisma.industrialMiningConcession.findUnique({
    where: { concessionCode: input.concessionCode },
  });
  if (!concession) {
    throw new Error(`Industrial mining concession '${input.concessionCode}' not found`);
  }
  if (concession.activeStatus !== "ACTIVE") {
    throw new Error(`Concession '${input.concessionCode}' is currently ${concession.activeStatus}`);
  }

  // 3. Automated Neutral Royalty Calculation (Q147)
  const calculation = calculateIndustrialRoyalty({
    grossGrams: input.grossPouredGrams,
    densityGramsPerCc: input.densityGramsPerCc,
    auFineness: input.estimatedAuFineness,
    agFineness: input.estimatedAgFineness,
    goldSpotUsdPerGram: gold.priceUsd,
    statutoryRoyaltyPercent: concession.statutoryRoyaltyPercent,
    stateParticipationPercent: concession.stateParticipationPercent,
  });

  // 4. Verify Edge HSM Controller Signature
  const hsmKey = input.hsmPublicKey || concession.smelterHsmPublicKey;
  const pourPayload = {
    concession_code: input.concessionCode,
    density_grams_per_cc: calculation.densityGramsPerCc,
    estimated_au_fineness: Number(input.estimatedAuFineness.toFixed(4)),
    gross_poured_grams: calculation.grossPouredGrams,
    run_number: input.runNumber,
  };

  let isSigValid = false;
  try {
    const canonical = canonicalJson(pourPayload);
    isSigValid = await verify(
      hexToBytes(input.hsmSignature),
      utf8ToBytes(canonical),
      hexToBytes(hsmKey)
    );
  } catch {
    isSigValid = false;
  }

  if (process.env.NODE_ENV === "production" && !isSigValid) {
    throw new Error("Invalid furnace edge HSM controller signature");
  }

  // 5. Execute Atomic Smelting Telemetry Ingestion
  return prisma.$transaction(async (tx) => {
    // Record telemetry
    const run = await tx.smeltingRunTelemetry.create({
      data: {
        runNumber: input.runNumber,
        concessionId: concession.id,
        concessionCode: concession.concessionCode,
        grossPouredGrams: calculation.grossPouredGrams,
        densityGramsPerCc: calculation.densityGramsPerCc,
        estimatedAuFineness: input.estimatedAuFineness,
        estimatedAgFineness: input.estimatedAgFineness ?? 0.08,
        fineGoldGrams: calculation.fineGoldGrams,
        fineSilverGrams: calculation.fineSilverGrams,
        goldSpotUsdPerGram: gold.priceUsd,
        silverSpotUsdPerGram: DEFAULT_SILVER_SPOT_USD,
        grossMarketValueUsd: calculation.grossMarketValueUsd,
        royaltyDueUsd: calculation.royaltyDueUsd,
        royaltyDueAngel: calculation.royaltyDueAngel,
        stateShareDueAngel: calculation.stateShareDueAngel,
        hsmSignature: input.hsmSignature,
        status: "POURED",
      },
    });

    // Update concession cumulative metrics
    await tx.industrialMiningConcession.update({
      where: { id: concession.id },
      data: {
        totalPouredGrams: { increment: calculation.grossPouredGrams },
        totalRoyaltiesAngel: { increment: calculation.royaltyDueAngel },
      },
    });

    // Credit state royalty dividend into national stabilization treasury
    await tx.agentWallet.upsert({
      where: { subjectCommitment: "protocol_treasury_system" },
      create: {
        subjectCommitment: "protocol_treasury_system",
        balance: calculation.totalStateCaptureAngel,
        earnedTotal: calculation.totalStateCaptureAngel,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: calculation.totalStateCaptureAngel },
        earnedTotal: { increment: calculation.totalStateCaptureAngel },
        lastActivityAt: new Date(),
      },
    });

    return {
      run,
      calculation,
    };
  });
}

/**
 * Bridges accumulated industrial doré smelting runs into an investment-grade VaultBatch.
 */
export async function bridgeIndustrialDoréToRefinery(input: BridgeIndustrialInput) {
  if (input.refinedFineness < MIN_REFINED_FINENESS) {
    throw new Error(
      `Refined purity ${(input.refinedFineness * 100).toFixed(2)}% is below the required 99.50% investment-grade standard`
    );
  }

  const uniqueRunNumbers = Array.from(new Set(input.runNumbers));
  if (uniqueRunNumbers.length === 0) {
    throw new Error("No smelting run numbers provided for refining bridge");
  }

  const refinedFineGrams = Number((input.refinedGrossGrams * input.refinedFineness).toFixed(4));
  let totalRawFineGrams = 0;

  const batch = await prisma.$transaction(async (tx) => {
    const runs = await tx.smeltingRunTelemetry.findMany({
      where: { runNumber: { in: uniqueRunNumbers } },
    });

    if (runs.length !== uniqueRunNumbers.length) {
      throw new Error("One or more smelting runs could not be found");
    }

    for (const r of runs) {
      if (r.status !== "POURED") {
        throw new Error(`Smelting run '${r.runNumber}' is already in state '${r.status}'`);
      }
    }

    totalRawFineGrams = runs.reduce((sum, r) => sum + r.fineGoldGrams, 0);

    // Recovery variance check (95% to 105%)
    const varianceRatio = refinedFineGrams / totalRawFineGrams;
    if (varianceRatio < 0.95 || varianceRatio > 1.05) {
      throw new Error(
        `Smelting recovery variance out of bounds (${(varianceRatio * 100).toFixed(1)}%). Expected between 95% and 105%.`
      );
    }

    // 1. Mark runs as refined
    await tx.smeltingRunTelemetry.updateMany({
      where: { runNumber: { in: uniqueRunNumbers } },
      data: {
        status: "REFINED_SETTLED",
        refinedBatchNumber: input.targetBatchNumber,
      },
    });

    // 2. Ensure gold reserve exists
    const reserve = await tx.commodityReserve.upsert({
      where: { commodityType_symbol: { commodityType: "GOLD", symbol: "Au" } },
      create: { commodityType: "GOLD", symbol: "Au" },
      update: {},
    });

    // 3. Create the investment-grade VaultBatch
    return tx.vaultBatch.create({
      data: {
        batchNumber: input.targetBatchNumber,
        reserveId: reserve.id,
        vaultId: input.vaultId,
        custodianName: input.custodianName,
        locationCity: input.locationCity,
        locationCountry: input.locationCountry.toUpperCase(),
        barSerials: input.barSerials,
        grossWeightGrams: input.refinedGrossGrams,
        fineness: input.refinedFineness,
        fineWeightGrams: refinedFineGrams,
        status: "AUDITED",
        auditedAt: new Date(),
      },
    });
  });

  // 4. Update the live Proof-of-Reserves Merkle tree
  const livePoR = await generateLivePoR("GOLD");

  return {
    vaultBatch: batch,
    runsRefinedCount: uniqueRunNumbers.length,
    totalRawFineGrams,
    refinedFineGrams,
    newReserveMerkleRoot: livePoR.reserve.merkleRoot,
  };
}

/**
 * Lists registered industrial mining concessions and telemetry summary.
 */
export async function listConcessions() {
  return prisma.industrialMiningConcession.findMany({
    orderBy: { concessionCode: "asc" },
  });
}

/**
 * Retrieves aggregate industrial mining and royalty metrics.
 */
export async function getIndustrialMiningMetrics() {
  const [concessions, runs] = await Promise.all([
    prisma.industrialMiningConcession.findMany({ where: { activeStatus: "ACTIVE" } }),
    prisma.smeltingRunTelemetry.findMany({
      select: {
        grossPouredGrams: true,
        fineGoldGrams: true,
        grossMarketValueUsd: true,
        royaltyDueAngel: true,
        stateShareDueAngel: true,
        status: true,
      },
    }),
  ]);

  const totalGrossPouredGrams = runs.reduce((sum, r) => sum + r.grossPouredGrams, 0);
  const totalFineGoldGrams = runs.reduce((sum, r) => sum + r.fineGoldGrams, 0);
  const totalMarketValueUsd = runs.reduce((sum, r) => sum + r.grossMarketValueUsd, 0);
  const totalRoyaltiesAngel = runs.reduce((sum, r) => sum + r.royaltyDueAngel, 0);
  const totalStateShareAngel = runs.reduce((sum, r) => sum + r.stateShareDueAngel, 0);
  const refinedCount = runs.filter((r) => r.status === "REFINED_SETTLED").length;

  return {
    activeConcessionsCount: concessions.length,
    totalSmeltingRunsCount: runs.length,
    totalGrossPouredGrams: Number(totalGrossPouredGrams.toFixed(2)),
    totalFineGoldGrams: Number(totalFineGoldGrams.toFixed(2)),
    totalMarketValueUsd: Number(totalMarketValueUsd.toFixed(2)),
    totalRoyaltiesCapturedAngel: totalRoyaltiesAngel,
    totalStateEquityAngel: totalStateShareAngel,
    runsRefinedToBullion: refinedCount,
    runsInTransit: runs.length - refinedCount,
  };
}
