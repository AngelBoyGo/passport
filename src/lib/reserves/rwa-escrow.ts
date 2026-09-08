/**
 * Sovereign Bilateral RWA Commodity Escrow Service.
 *
 * Binds AngelCoin collateral to physical vaulted lot delivery between autonomous
 * agents and sovereign state entities. Escrow lifecycle:
 *   HELD → RELEASED (assay verified) | DISPUTED | REFUNDED (timeout).
 *
 * Safety invariants:
 *   - Atomic wallet debit/credit inside a single Prisma transaction.
 *   - Oracle freshness gate: stale commodity feeds refuse escrow creation.
 *   - Assay verification gate: release requires a matching AssayerCertification.
 */

import { prisma } from "@/lib/db";
import { getCommoditySpotPrices } from "./commodity-oracle";
import { executeDisbursementInTransaction } from "./royalty-waterfall";

export const ESCROW_PROTOCOL_FEE_BPS = 250; // 2.5% protocol fee on release
const COMMITMENT_RE = /^[0-9a-f]{64}$/i;

export interface CreateEscrowInput {
  escrowId: string;
  buyerCommitment: string;
  sellerCommitment: string;
  batchNumber: string;
  commodityType?: string;
  fineGrams: number;
  unitPriceUsd: number;
  lockedAngel: number;
  timeoutHours?: number;
}

export interface ReleaseEscrowInput {
  escrowId: string;
  assayCertificationNumber: string;
  releaseSignature: string;
}

function validateCommitment(label: string, commitment: string): void {
  if (!COMMITMENT_RE.test(commitment)) {
    throw new Error(`Invalid ${label} commitment`);
  }
}

function assertPositiveNumber(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

/**
 * Creates a HELD commodity escrow: debits buyer collateral, reserves the lot.
 */
export async function createCommodityEscrow(input: CreateEscrowInput) {
  validateCommitment("buyer", input.buyerCommitment);
  validateCommitment("seller", input.sellerCommitment);
  assertPositiveNumber("fineGrams", input.fineGrams);
  assertPositiveNumber("unitPriceUsd", input.unitPriceUsd);
  assertPositiveNumber("lockedAngel", input.lockedAngel);

  const lockedAngel = Math.floor(input.lockedAngel);

  // Oracle freshness gate — refuse settlement on stale commodity feeds
  const spotPrices = getCommoditySpotPrices();
  const gold = spotPrices.Au;
  if (!gold || gold.isStale) {
    throw new Error("Commodity oracle feed is stale; escrow creation refused");
  }

  const timeoutHours = input.timeoutHours ?? 72;
  const timeoutAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

  const escrow = await prisma.$transaction(async (tx) => {
    // Verify vaulted lot is audited and sufficient
    const batch = await tx.vaultBatch.findUnique({
      where: { batchNumber: input.batchNumber },
    });
    if (!batch) {
      throw new Error(`Vault batch '${input.batchNumber}' not found`);
    }
    if (batch.status !== "AUDITED") {
      throw new Error(`Vault batch '${input.batchNumber}' is not in AUDITED state`);
    }

    // Enforce lot capacity against existing active HELD escrows to prevent over-allocation
    const activeEscrows = await tx.commodityEscrow.findMany({
      where: {
        batchNumber: input.batchNumber,
        status: "HELD",
      },
      select: { fineGrams: true },
    });
    const alreadyCommittedGrams = activeEscrows.reduce((sum, e) => sum + e.fineGrams, 0);
    const availableGrams = Number((batch.fineWeightGrams - alreadyCommittedGrams).toFixed(4));

    if (input.fineGrams > availableGrams) {
      throw new Error(
        `Requested fine grams (${input.fineGrams.toFixed(2)}g) exceed available lot capacity (${availableGrams.toFixed(2)}g remaining)`
      );
    }

    // Debit buyer collateral atomically
    const buyerWallet = await tx.agentWallet.findUnique({
      where: { subjectCommitment: input.buyerCommitment },
    });
    if (!buyerWallet) {
      throw new Error("Buyer wallet not found");
    }
    if (buyerWallet.balance - buyerWallet.staked < lockedAngel) {
      throw new Error("Buyer has insufficient available AngelCoin collateral");
    }

    await tx.agentWallet.update({
      where: { subjectCommitment: input.buyerCommitment },
      data: {
        balance: { decrement: lockedAngel },
        spentTotal: { increment: lockedAngel },
        lastActivityAt: new Date(),
      },
    });

    return tx.commodityEscrow.create({
      data: {
        escrowId: input.escrowId,
        buyerCommitment: input.buyerCommitment,
        sellerCommitment: input.sellerCommitment,
        batchNumber: input.batchNumber,
        commodityType: input.commodityType ?? "GOLD",
        fineGrams: input.fineGrams,
        unitPriceUsd: input.unitPriceUsd,
        lockedAngel,
        protocolFeeAngel: Math.round((lockedAngel * ESCROW_PROTOCOL_FEE_BPS) / 10_000),
        status: "HELD",
        timeoutAt,
      },
    });
  });

  return escrow;
}

/**
 * Releases escrow to the seller after assay certification verification.
 * Marks the vaulted lot as SETTLED_DELIVERY and deducts the protocol fee.
 */
export async function releaseEscrowOnAssay(input: ReleaseEscrowInput) {
  if (!input.releaseSignature || typeof input.releaseSignature !== "string" || input.releaseSignature.trim().length === 0) {
    throw new Error("Valid release signature is required for settlement release");
  }

  const escrow = await prisma.$transaction(async (tx) => {
    const held = await tx.commodityEscrow.findUnique({
      where: { escrowId: input.escrowId },
    });
    if (!held) {
      throw new Error("Escrow not found");
    }
    if (held.status !== "HELD") {
      throw new Error(`Escrow is not in HELD state (current: ${held.status})`);
    }

    // 0. Atomic guard against concurrent double-release race
    const transitioned = await tx.commodityEscrow.updateMany({
      where: { escrowId: input.escrowId, status: "HELD" },
      data: {
        status: "RELEASED",
        assayCertificationNumber: input.assayCertificationNumber,
        releaseSignature: input.releaseSignature,
        releasedAt: new Date(),
      },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Escrow '${input.escrowId}' is no longer in HELD state`);
    }

    // Assay verification gate
    const assay = await tx.assayerCertification.findUnique({
      where: { certificationNumber: input.assayCertificationNumber },
    });
    if (!assay || assay.batchNumber !== held.batchNumber) {
      throw new Error("Assay certification does not match the escrow lot");
    }

    const fee = held.protocolFeeAngel;
    const sellerPayout = held.lockedAngel - fee;

    // Credit seller wallet
    await tx.agentWallet.update({
      where: { subjectCommitment: held.sellerCommitment },
      data: {
        balance: { increment: sellerPayout },
        earnedTotal: { increment: sellerPayout },
        lastActivityAt: new Date(),
      },
    });

    // Mark the physical lot as settled
    const updatedBatch = await tx.vaultBatch.update({
      where: { batchNumber: held.batchNumber },
      data: { status: "SETTLED_DELIVERY" },
      select: { locationCountry: true, locationCity: true },
    });

    // Execute statutory sovereign dividend waterfall (Black Paper Q141)
    await executeDisbursementInTransaction(tx, {
      escrowId: held.escrowId,
      batchNumber: held.batchNumber,
      totalFeeAngel: fee,
      location: {
        country: updatedBatch.locationCountry,
        district: updatedBatch.locationCity,
      },
    });

    return tx.commodityEscrow.update({
      where: { escrowId: input.escrowId },
      data: {
        status: "RELEASED",
        assayCertificationNumber: input.assayCertificationNumber,
        releaseSignature: input.releaseSignature,
        releasedAt: new Date(),
      },
    });
  });

  return escrow;
}

/**
 * Refunds the buyer's collateral when the escrow times out before settlement.
 */
export async function refundEscrowOnTimeout(escrowId: string) {
  const escrow = await prisma.$transaction(async (tx) => {
    const held = await tx.commodityEscrow.findUnique({
      where: { escrowId },
    });
    if (!held) {
      throw new Error("Escrow not found");
    }
    if (held.status !== "HELD") {
      throw new Error(`Escrow is not in HELD state (current: ${held.status})`);
    }
    if (new Date() < held.timeoutAt) {
      throw new Error("Escrow has not reached its timeout");
    }

    // 0. Atomic guard against concurrent double-refund race
    const transitioned = await tx.commodityEscrow.updateMany({
      where: { escrowId, status: "HELD" },
      data: { status: "REFUNDED" },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Escrow '${escrowId}' is no longer in HELD state`);
    }

    await tx.agentWallet.update({
      where: { subjectCommitment: held.buyerCommitment },
      data: {
        balance: { increment: held.lockedAngel },
        spentTotal: { decrement: held.lockedAngel },
        lastActivityAt: new Date(),
      },
    });

    return tx.commodityEscrow.update({
      where: { escrowId },
      data: { status: "REFUNDED" },
    });
  });

  return escrow;
}

/**
 * Retrieves an escrow by its public escrowId.
 */
export async function getEscrow(escrowId: string) {
  return prisma.commodityEscrow.findUnique({
    where: { escrowId },
  });
}
