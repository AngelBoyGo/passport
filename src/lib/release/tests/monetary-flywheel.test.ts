import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    agentWallet: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    operatorLedgerEntry: { create: vi.fn(), findMany: vi.fn() },
    commodityReserve: { upsert: vi.fn(), findMany: vi.fn() },
    vaultBatch: { findUnique: vi.fn(), update: vi.fn() },
    commodityEscrow: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    assayerCertification: { findUnique: vi.fn() },
    sovereignDisbursement: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  MONETARY_PARAMS,
  ANGEL_BUNDLES,
  FEATURE_GRID,
  gridRound,
  computeStranded,
  revalue,
} from "@/lib/angelcoin/monetary";
import {
  createCommodityEscrow,
  releaseEscrowOnAssay,
} from "@/lib/reserves/rwa-escrow";
import { calculateStatutoryWaterfall } from "@/lib/reserves/royalty-waterfall";

describe("Unified AngelCoin Monetary Flywheel (Closed-Loop Integration)", () => {
  const buyer = "a".repeat(64);
  const seller = "b".repeat(64);
  const batchNumber = "BKO-AU-2026-FLYWHEEL";

  beforeEach(() => {
    vi.restoreAllMocks();
    prismaMock.commodityEscrow.findMany.mockResolvedValue([]);
  });

  it("executes the complete retail-to-haven economic flywheel", async () => {
    // ── STAGE 1: Retail Top-Up (Stripe Checkout) ──
    // Customer purchases Pro Bundle (17 ANGEL) at $5.00/ANGEL = $85.00 USD (8,500 cents).
    const bundle = ANGEL_BUNDLES.find((b) => b.bundle_id === "pro")!;
    expect(bundle.angl).toBe(17);
    const paidUsdCents = bundle.angl * MONETARY_PARAMS.P0 * 100;
    expect(paidUsdCents).toBe(8500); // $85.00

    // Accounting invariant: 1 cent = 10,000 micro-USD; $85.00 = 85,000,000 micros
    const deltaMicros = paidUsdCents * 10_000;
    expect(deltaMicros).toBe(85_000_000);

    // Initial agent wallet state after Stripe top-up
    let buyerBalance = 17;
    let buyerSpent = 0;

    // ── STAGE 2: Utility Feature Consumption (Stranded Balance Invariant) ──
    // Agent purchases monthly Pro subscription feature ($40.00 USD)
    const proFeatureAngel = gridRound(40.0, MONETARY_PARAMS.P0);
    expect(proFeatureAngel).toBe(8); // $40 / $5 = 8 ANGEL
    expect(FEATURE_GRID.includes(proFeatureAngel)).toBe(true);

    // Verify Stranded Balance geometry: 17 ANGEL allows 2 feature spends of 8, leaving 1 stranded
    expect(computeStranded(bundle.angl, proFeatureAngel)).toBe(1);

    // Agent spends 8 ANGEL
    buyerBalance -= proFeatureAngel;
    buyerSpent += proFeatureAngel;
    expect(buyerBalance).toBe(9);
    expect(buyerSpent).toBe(8);

    // ── STAGE 3: B2B Physical Commodity Escrow Lock ──
    // Agent enters a bilateral clearing trade for physical gold bullion,
    // locking 8 ANGEL against 100g gold, leaving exactly 1 stranded ANGEL in wallet.
    const lockedAngel = 8;
    const fineGrams = 100.0;
    const unitPriceUsd = 75.0;

    prismaMock.vaultBatch.findUnique.mockResolvedValue({
      batchNumber,
      status: "AUDITED",
      fineWeightGrams: 500.0,
    });
    prismaMock.agentWallet.findUnique.mockResolvedValue({
      subjectCommitment: buyer,
      balance: buyerBalance,
      staked: 0,
    });
    prismaMock.agentWallet.update.mockResolvedValue({});
    prismaMock.commodityEscrow.create.mockResolvedValue({
      escrowId: "esc_flywheel_001",
      buyerCommitment: buyer,
      sellerCommitment: seller,
      batchNumber,
      lockedAngel,
      protocolFeeAngel: 0,
      status: "HELD",
    });

    const escrow = await createCommodityEscrow({
      escrowId: "esc_flywheel_001",
      buyerCommitment: buyer,
      sellerCommitment: seller,
      batchNumber,
      fineGrams,
      unitPriceUsd,
      lockedAngel,
    });

    expect(escrow.status).toBe("HELD");
    buyerBalance -= lockedAngel;
    buyerSpent += lockedAngel;

    // Exactly 1 stranded ANGEL remains in the buyer wallet!
    expect(buyerBalance).toBe(1);

    // ── STAGE 4: Assay Verification & Statutory Waterfall Disbursement ──
    // Test statutory waterfall with an enterprise fee batch of 40 ANGEL
    const enterpriseFee = 40;
    const waterfall = calculateStatutoryWaterfall(enterpriseFee, {
      country: "ML",
      district: "Sikasso",
    });

    // Verify Black Paper Q141 allocations
    expect(waterfall.totalFeeAngel).toBe(40);
    // 40% State = 16: National 50% (8), Community 30% (4), Workers 20% (3 + 1 remainder dust)
    expect(waterfall.stateCommunityAngel).toBe(4);
    expect(waterfall.stateWorkersAngel).toBe(3);
    expect(waterfall.stateNationalAngel).toBe(9); // 16 - 7 = 9
    expect(waterfall.treasuryStabilizationAngel).toBe(12); // 30%
    expect(waterfall.validatorPoolAngel).toBe(8); // 20%
    expect(waterfall.agentRebateAngel).toBe(4); // 10%

    // Mathematical zero-leakage invariant
    const totalDisbursed =
      waterfall.stateNationalAngel +
      waterfall.stateCommunityAngel +
      waterfall.stateWorkersAngel +
      waterfall.treasuryStabilizationAngel +
      waterfall.validatorPoolAngel +
      waterfall.agentRebateAngel;
    expect(totalDisbursed).toBe(40);

    // Release escrow
    prismaMock.commodityEscrow.findUnique.mockResolvedValue({
      escrowId: "esc_flywheel_001",
      status: "HELD",
      buyerCommitment: buyer,
      sellerCommitment: seller,
      batchNumber,
      lockedAngel: 8,
      protocolFeeAngel: 0,
    });
    prismaMock.assayerCertification.findUnique.mockResolvedValue({
      certificationNumber: "ASSAY-BKO-FLYWHEEL",
      batchNumber,
    });
    prismaMock.vaultBatch.update.mockResolvedValue({
      locationCountry: "ML",
      locationCity: "Bamako",
    });
    prismaMock.commodityEscrow.update.mockResolvedValue({
      escrowId: "esc_flywheel_001",
      status: "RELEASED",
    });
    prismaMock.commodityEscrow.updateMany.mockResolvedValue({ count: 1 });

    const released = await releaseEscrowOnAssay({
      escrowId: "esc_flywheel_001",
      assayCertificationNumber: "ASSAY-BKO-FLYWHEEL",
      releaseSignature: "sig_flywheel_release",
    });
    expect(released.status).toBe("RELEASED");

    // ── STAGE 5: Solvency Gating Verification (Zero Deficit) ──
    // Total physical gold reserve (500g * $75 = $37,500) + fiat top-up ($85.00) = $37,585.00
    // Total circulating supply = 17 ANGEL
    const reval = revalue({
      previousRate: 5.0,
      reserveBalance: 37585.0,
      previousReserveBalance: 37500.0,
      circulatingSupply: 17,
    });

    expect(reval.floored).toBe(false);
    expect(reval.quarantineRecommended).toBe(false);
    expect(reval.backingRatio).toBeGreaterThan(100.0);
    expect(reval.solvencyDeficitUsd).toBe(0);

    // Total redemption liability is fully covered
    const totalLiability = 17 * reval.P_red;
    expect(totalLiability).toBeLessThan(37585.0);
  });
});
