/**
 * RWA Commodity Closed-Loop Settlement — Pure, DB-Free Invariant Engine.
 *
 * Implements pure invariant validation and deterministic golden projection
 * for the end-to-end physical commodity clearing lifecycle:
 *   Vault Batch Audited → Collateral Escrow Locked → Assay Verified →
 *   Settlement Released → Collateral Conserved & Protocol Fee Captured.
 */

export interface RwaClosedLoopSnapshot {
  escrowId: string;
  buyerCommitment: string;
  sellerCommitment: string;
  batchNumber: string;
  fineGrams: number;
  unitPriceUsd: number;
  lockedAngel: number;
  protocolFeeAngel: number;
  sellerPayoutAngel: number;
  buyerInitialBalance: number;
  buyerFinalBalance: number;
  sellerInitialBalance: number;
  sellerFinalBalance: number;
  escrowStatus: "HELD" | "RELEASED" | "REFUNDED";
  batchInitialStatus: "AUDITED";
  batchFinalStatus: "SETTLED_DELIVERY";
  assayCertificationNumber: string;
  merkleRootPreSettlement: string;
  disbursement?: {
    totalFee: number;
    national: number;
    community: number;
    workers: number;
    treasury: number;
    validators: number;
    agentRebate: number;
  };
}

export type RwaClosedLoopGolden = {
  batchNumber: string;
  fineGrams: number;
  unitPriceUsd: number;
  lockedAngel: number;
  protocolFeeAngel: number;
  sellerPayoutAngel: number;
  buyerBalanceDelta: number;
  sellerBalanceDelta: number;
  escrowStatus: string;
  batchFinalStatus: string;
  assayCertificationNumber: string;
  merkleRootPreSettlement: string;
  disbursement?: {
    totalFee: number;
    national: number;
    community: number;
    workers: number;
    treasury: number;
    validators: number;
    agentRebate: number;
  };
};

/**
 * Asserts the 5 core mathematical and cryptographic invariants of RWA commodity settlement.
 * Returns an array of violation strings (empty when fully sound).
 */
export function assertRwaClosedLoopInvariants(s: RwaClosedLoopSnapshot): string[] {
  const violations: string[] = [];

  // Invariant 1: Collateral Conservation — lockedAngel must equal seller payout + protocol fee
  if (s.lockedAngel !== s.sellerPayoutAngel + s.protocolFeeAngel) {
    violations.push(
      `Collateral conservation broken: locked ${s.lockedAngel} != payout ${s.sellerPayoutAngel} + fee ${s.protocolFeeAngel}`
    );
  }

  // Invariant 2: Buyer balance decrement exactly matches lockedAngel
  const buyerDelta = s.buyerInitialBalance - s.buyerFinalBalance;
  if (buyerDelta !== s.lockedAngel) {
    violations.push(
      `Buyer balance decrement ${buyerDelta} != locked collateral ${s.lockedAngel}`
    );
  }

  // Invariant 3: Seller balance increment exactly matches sellerPayoutAngel
  const sellerDelta = s.sellerFinalBalance - s.sellerInitialBalance;
  if (sellerDelta !== s.sellerPayoutAngel) {
    violations.push(
      `Seller balance increment ${sellerDelta} != seller payout ${s.sellerPayoutAngel}`
    );
  }

  // Invariant 4: State progression — escrow must be RELEASED and lot must be SETTLED_DELIVERY
  if (s.escrowStatus !== "RELEASED") {
    violations.push(`Expected escrowStatus 'RELEASED', got '${s.escrowStatus}'`);
  }
  if (s.batchFinalStatus !== "SETTLED_DELIVERY") {
    violations.push(`Expected batchFinalStatus 'SETTLED_DELIVERY', got '${s.batchFinalStatus}'`);
  }

  // Invariant 5: Protocol fee calculation — must match 2.5% (250 bps) exactly
  const expectedFee = Math.round((s.lockedAngel * 250) / 10000);
  if (s.protocolFeeAngel !== expectedFee) {
    violations.push(
      `Protocol fee mismatch: recorded ${s.protocolFeeAngel} != calculated ${expectedFee} (250 bps)`
    );
  }

  // Invariant 6: Statutory Sovereign Dividend Waterfall (Black Paper Q141)
  if (s.disbursement) {
    const d = s.disbursement;
    if (d.totalFee !== s.protocolFeeAngel) {
      violations.push(
        `Disbursement total fee ${d.totalFee} != protocol fee ${s.protocolFeeAngel}`
      );
    }
    const allocatedSum =
      d.national +
      d.community +
      d.workers +
      d.treasury +
      d.validators +
      d.agentRebate;
    if (allocatedSum !== d.totalFee) {
      violations.push(
        `Disbursement waterfall sum ${allocatedSum} != total fee ${d.totalFee}`
      );
    }
  }

  // Cryptographic integrity validations
  if (!/^[0-9a-f]{64}$/i.test(s.buyerCommitment)) {
    violations.push("buyerCommitment is not a valid 64-hex hash");
  }
  if (!/^[0-9a-f]{64}$/i.test(s.sellerCommitment)) {
    violations.push("sellerCommitment is not a valid 64-hex hash");
  }
  if (!/^[0-9a-f]{64}$/i.test(s.merkleRootPreSettlement)) {
    violations.push("merkleRootPreSettlement is not a valid 64-hex SHA-256 root");
  }

  return violations;
}

/**
 * Projects an RWA snapshot into a deterministic, id-independent golden fixture.
 */
export function snapshotToRwaGolden(s: RwaClosedLoopSnapshot): RwaClosedLoopGolden {
  return {
    batchNumber: s.batchNumber,
    fineGrams: s.fineGrams,
    unitPriceUsd: s.unitPriceUsd,
    lockedAngel: s.lockedAngel,
    protocolFeeAngel: s.protocolFeeAngel,
    sellerPayoutAngel: s.sellerPayoutAngel,
    buyerBalanceDelta: s.buyerInitialBalance - s.buyerFinalBalance,
    sellerBalanceDelta: s.sellerFinalBalance - s.sellerInitialBalance,
    escrowStatus: s.escrowStatus,
    batchFinalStatus: s.batchFinalStatus,
    assayCertificationNumber: s.assayCertificationNumber,
    merkleRootPreSettlement: s.merkleRootPreSettlement,
    ...(s.disbursement ? { disbursement: s.disbursement } : {}),
  };
}

export interface RwaSmokeArgs {
  writeGolden: boolean;
  dryRun: boolean;
  help: boolean;
}

/**
 * Parses CLI arguments for the RWA smoke harness.
 */
export function parseRwaSmokeArgs(argv: string[]): RwaSmokeArgs {
  return {
    writeGolden: argv.includes("--write-golden"),
    dryRun: argv.includes("--dry-run"),
    help: argv.includes("-h") || argv.includes("--help"),
  };
}
