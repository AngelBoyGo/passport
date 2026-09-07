/**
 * Sovereign RWA Commodity Clearing Smoke Harness.
 *
 * Drives the real RWA escrow and reserve clearing services against the local DB:
 *   1. Provisions temporary buyer and seller agent wallets.
 *   2. Registers an audited physical gold lot and generates a live Merkle tree.
 *   3. Locks buyer collateral via createCommodityEscrow.
 *   4. Ingests an authenticated AssayerCertification.
 *   5. Releases escrow via releaseEscrowOnAssay (seller credited, lot marked SETTLED_DELIVERY).
 *   6. Captures RwaClosedLoopSnapshot and asserts all 5 mathematical invariants.
 *
 * Run (non-production only):
 *   PASSPORT_SMOKE_ALLOW=1 npx tsx scripts/smoke-rwa-clearing.ts [--write-golden] [--dry-run]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/db";
import { sha256Hex } from "../src/lib/receipt/canonical";
import {
  createCommodityEscrow,
  releaseEscrowOnAssay,
} from "../src/lib/reserves/rwa-escrow";
import { generateLivePoR } from "../src/lib/reserves/por-service";
import {
  assertRwaClosedLoopInvariants,
  parseRwaSmokeArgs,
  snapshotToRwaGolden,
  type RwaClosedLoopSnapshot,
} from "../src/lib/release/rwa-closed-loop";

const GOLDEN_PATH = resolve("scripts/fixtures", "rwa-closed-loop.golden.json");

const SMOKE_BUYER_COMMITMENT = sha256Hex("smoke:rwa:buyer:2026");
const SMOKE_SELLER_COMMITMENT = sha256Hex("smoke:rwa:seller:2026");
const SMOKE_BATCH_NUMBER = "BKO-AU-2026-SMOKE";
const SMOKE_ESCROW_ID = "esc_smoke_rwa_001";
const SMOKE_ASSAY_NUMBER = "ASSAY-BKO-2026-SMOKE";

const INITIAL_BUYER_ANGEL = 2000;
const INITIAL_SELLER_ANGEL = 500;
const LOCKED_ANGEL = 1000;
const FINE_GRAMS = 100.0;
const UNIT_PRICE_USD = 75.0;

async function fail(msg: string): Promise<never> {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function cleanupHarness(): Promise<void> {
  await prisma.sovereignDisbursement.deleteMany({ where: { escrowId: SMOKE_ESCROW_ID } });
  await prisma.commodityEscrow.deleteMany({ where: { escrowId: SMOKE_ESCROW_ID } });
  await prisma.assayerCertification.deleteMany({
    where: { certificationNumber: SMOKE_ASSAY_NUMBER },
  });
  await prisma.vaultBatch.deleteMany({ where: { batchNumber: SMOKE_BATCH_NUMBER } });
  await prisma.agentWallet.deleteMany({
    where: {
      subjectCommitment: { in: [SMOKE_BUYER_COMMITMENT, SMOKE_SELLER_COMMITMENT] },
    },
  });
}

async function main(): Promise<void> {
  const args = parseRwaSmokeArgs(process.argv.slice(2));

  if (args.help) {
    console.log("Usage: PASSPORT_SMOKE_ALLOW=1 npx tsx scripts/smoke-rwa-clearing.ts [options]");
    console.log("  --write-golden  update scripts/fixtures/rwa-closed-loop.golden.json");
    console.log("  --dry-run       skip database cleanup at the end of the run");
    console.log("  -h, --help      show this help message");
    return;
  }

  // Safety checks
  if (process.env.NODE_ENV === "production") {
    await fail("Refusing to run RWA smoke in production (NODE_ENV=production)");
  }
  if (process.env.PASSPORT_SMOKE_ALLOW !== "1") {
    await fail("Set PASSPORT_SMOKE_ALLOW=1 to run this smoke harness");
  }

  console.log("=== Sovereign RWA Commodity Clearing Smoke Harness ===");

  try {
    // 0. Clean prior test state
    await cleanupHarness();
    console.log("• Harness state initialized");

    // 1. Setup buyer & seller wallets
    const buyerWallet = await prisma.agentWallet.create({
      data: {
        subjectCommitment: SMOKE_BUYER_COMMITMENT,
        balance: INITIAL_BUYER_ANGEL,
        staked: 0,
      },
    });

    const sellerWallet = await prisma.agentWallet.create({
      data: {
        subjectCommitment: SMOKE_SELLER_COMMITMENT,
        balance: INITIAL_SELLER_ANGEL,
        staked: 0,
      },
    });
    console.log(`• Wallets provisioned: Buyer (${buyerWallet.balance} ANGEL), Seller (${sellerWallet.balance} ANGEL)`);

    // 2. Setup reserve and audited physical lot
    const reserve = await prisma.commodityReserve.upsert({
      where: { commodityType_symbol: { commodityType: "GOLD", symbol: "Au" } },
      create: { commodityType: "GOLD", symbol: "Au", totalFineGrams: 500.0, totalGrams: 500.0 },
      update: {},
    });

    await prisma.vaultBatch.create({
      data: {
        batchNumber: SMOKE_BATCH_NUMBER,
        reserveId: reserve.id,
        vaultId: "VAULT-BKO-CENTRAL",
        custodianName: "Banque Nationale / SOREM",
        locationCity: "Bamako",
        locationCountry: "ML",
        barSerials: ["SMOKE-BAR-01", "SMOKE-BAR-02"],
        grossWeightGrams: 100.1,
        fineness: 0.9990,
        fineWeightGrams: 100.0,
        status: "AUDITED",
        auditedAt: new Date(),
      },
    });

    const livePoR = await generateLivePoR("GOLD");
    console.log(`• Physical gold batch audited (Merkle Root: ${livePoR.reserve.merkleRoot.slice(0, 16)}...)`);

    // 3. Create Bilateral Escrow
    const escrow = await createCommodityEscrow({
      escrowId: SMOKE_ESCROW_ID,
      buyerCommitment: SMOKE_BUYER_COMMITMENT,
      sellerCommitment: SMOKE_SELLER_COMMITMENT,
      batchNumber: SMOKE_BATCH_NUMBER,
      fineGrams: FINE_GRAMS,
      unitPriceUsd: UNIT_PRICE_USD,
      lockedAngel: LOCKED_ANGEL,
    });
    console.log(`• Escrow created & locked: ${escrow.lockedAngel} ANGEL (Fee: ${escrow.protocolFeeAngel} ANGEL)`);

    // 4. Ingest matching Assayer Certification
    await prisma.assayerCertification.create({
      data: {
        certificationNumber: SMOKE_ASSAY_NUMBER,
        assayerName: "Bureau National des Mines (SOREM Lab)",
        assayerPublicKey: "pk_smoke_assayer_2026",
        batchNumber: SMOKE_BATCH_NUMBER,
        methodology: "XRF_SPECTROMETRY",
        purityFineness: 0.9990,
        grossGrams: 100.1,
        sampleSignature: "sig_smoke_valid_assay",
      },
    });
    console.log(`• Spectrometry assay certified: ${SMOKE_ASSAY_NUMBER}`);

    // 5. Release Escrow on Verified Assay
    const releasedEscrow = await releaseEscrowOnAssay({
      escrowId: SMOKE_ESCROW_ID,
      assayCertificationNumber: SMOKE_ASSAY_NUMBER,
      releaseSignature: "sig_smoke_seller_release",
    });

    const finalBuyer = await prisma.agentWallet.findUniqueOrThrow({
      where: { subjectCommitment: SMOKE_BUYER_COMMITMENT },
    });
    const finalSeller = await prisma.agentWallet.findUniqueOrThrow({
      where: { subjectCommitment: SMOKE_SELLER_COMMITMENT },
    });
    const settledBatch = await prisma.vaultBatch.findUniqueOrThrow({
      where: { batchNumber: SMOKE_BATCH_NUMBER },
    });
    const disbursement = await prisma.sovereignDisbursement.findFirstOrThrow({
      where: { escrowId: SMOKE_ESCROW_ID },
    });

    console.log(`• Escrow released: Seller received ${finalSeller.balance - INITIAL_SELLER_ANGEL} ANGEL`);
    console.log(`• Sovereign dividend disbursed: ${disbursement.totalFeeAngel} ANGEL (National: ${disbursement.stateNationalAngel}, Community: ${disbursement.stateCommunityAngel}, Workers: ${disbursement.stateWorkersAngel})`);
    console.log(`• Vault lot status updated: ${settledBatch.status}`);

    // 6. Capture Closed-Loop Snapshot & Assert Invariants
    const snapshot: RwaClosedLoopSnapshot = {
      escrowId: releasedEscrow.escrowId,
      buyerCommitment: SMOKE_BUYER_COMMITMENT,
      sellerCommitment: SMOKE_SELLER_COMMITMENT,
      batchNumber: SMOKE_BATCH_NUMBER,
      fineGrams: FINE_GRAMS,
      unitPriceUsd: UNIT_PRICE_USD,
      lockedAngel: LOCKED_ANGEL,
      protocolFeeAngel: releasedEscrow.protocolFeeAngel,
      sellerPayoutAngel: LOCKED_ANGEL - releasedEscrow.protocolFeeAngel,
      buyerInitialBalance: INITIAL_BUYER_ANGEL,
      buyerFinalBalance: finalBuyer.balance,
      sellerInitialBalance: INITIAL_SELLER_ANGEL,
      sellerFinalBalance: finalSeller.balance,
      escrowStatus: releasedEscrow.status as "RELEASED",
      batchInitialStatus: "AUDITED",
      batchFinalStatus: settledBatch.status as "SETTLED_DELIVERY",
      assayCertificationNumber: SMOKE_ASSAY_NUMBER,
      merkleRootPreSettlement: livePoR.reserve.merkleRoot,
      disbursement: {
        totalFee: disbursement.totalFeeAngel,
        national: disbursement.stateNationalAngel,
        community: disbursement.stateCommunityAngel,
        workers: disbursement.stateWorkersAngel,
        treasury: disbursement.treasuryStabilizationAngel,
        validators: disbursement.validatorPoolAngel,
        agentRebate: disbursement.agentRebateAngel,
      },
    };

    const violations = assertRwaClosedLoopInvariants(snapshot);
    if (violations.length > 0) {
      console.error("\n❌ RWA Closed-Loop Invariants VIOLATED:");
      for (const v of violations) console.error(`   - ${v}`);
      process.exit(1);
    }

    console.log("\n✔ All 6 RWA Closed-Loop Invariants Verified (0 violations):");
    console.log("   [1] Collateral Conservation: Locked = Seller Payout + Protocol Fee");
    console.log("   [2] Buyer Collateral Debit: Initial - Final == Locked ANGEL");
    console.log("   [3] Seller Payout Credit: Final - Initial == Payout ANGEL");
    console.log("   [4] State Progression: Escrow RELEASED & Lot SETTLED_DELIVERY");
    console.log("   [5] Statutory Protocol Fee: 2.50% (250 bps) Captured");
    console.log("   [6] Sovereign Waterfall Distribution: Exact conservation across all tiers");

    // 7. Write Golden if requested
    if (args.writeGolden) {
      const golden = snapshotToRwaGolden(snapshot);
      writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n");
      console.log(`• Updated golden fixture at ${GOLDEN_PATH}`);
    }

    // 8. Cleanup unless dry run
    if (!args.dryRun) {
      await cleanupHarness();
      console.log("• Harness test records cleaned up");
    }

    console.log("\n=== RWA Clearing Smoke Test PASSED ===");
  } catch (err: unknown) {
    await cleanupHarness().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    await fail(`RWA Smoke execution failed: ${message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
