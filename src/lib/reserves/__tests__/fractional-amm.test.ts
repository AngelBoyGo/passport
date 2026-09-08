import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    vaultBatch: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    commodityEscrow: { findFirst: vi.fn() },
    commodityLiquidityPool: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    ammSwapReceipt: { create: vi.fn() },
    fractionalCommodityBalance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    agentWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("../dual-state-governor", () => ({
  getLiveGovernorAssessment: vi.fn(),
}));

import {
  fractionalizeVaultBatch,
  executePoolSwap,
  removeLiquidity,
  ensurePool,
  bootstrapAmmLiquidity,
  fractionalCommodityWalletCommitment,
  integerMilliUnitsFromFineWeight,
  FEE_BPS_SOLID,
  FEE_BPS_GHOST,
  MAX_ORACLE_DEVIATION_PCT,
  STABILIZATION_TREASURY,
} from "../fractional-amm";
import { getLiveGovernorAssessment } from "../dual-state-governor";

const GOLD_BATCH = {
  id: "vb_gold",
  batchNumber: "BKO-AU-2026-AMM-001",
  reserveId: "res_au",
  status: "AUDITED",
  fineWeightGrams: 1000.0,
  reserve: { commodityType: "GOLD", symbol: "Au" },
};

const LITHIUM_BATCH = {
  id: "vb_li",
  batchNumber: "GOUL-LI-2026-AMM-001",
  reserveId: "res_li",
  status: "AUDITED",
  fineWeightGrams: 250.0,
  reserve: { commodityType: "LITHIUM", symbol: "Li" },
};

const AGENT = "a".repeat(64);
const OPERATOR = "b".repeat(64);

const setRegime = (regime: "SOLID" | "GHOST") => {
  (getLiveGovernorAssessment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    regime,
    beliefScore: regime === "GHOST" ? 0.9 : 0.1,
  });
};

describe("Fractionalized Commodity Clearing & RWA-AMM (Phase 17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setRegime("SOLID");
  });

  describe("integerMilliUnitsFromFineWeight (Dust-Free Invariant)", () => {
    it("mints exact integer milli-units with zero fractional dust", () => {
      expect(integerMilliUnitsFromFineWeight(1000.0, 1000)).toBe(1_000_000);
      expect(integerMilliUnitsFromFineWeight(0.001, 1000)).toBe(1);
      expect(integerMilliUnitsFromFineWeight(0.0001, 1000)).toBe(0);
      expect(integerMilliUnitsFromFineWeight(-5, 1000)).toBe(0);
    });
  });

  describe("fractionalizeVaultBatch", () => {
    it("locks an AUDITED gold batch and mints exact integer mAu without dust leakage", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({ ...GOLD_BATCH });
      prismaMock.commodityEscrow.findFirst.mockResolvedValue(null);
      prismaMock.vaultBatch.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await fractionalizeVaultBatch({
        batchNumber: GOLD_BATCH.batchNumber,
        depositorCommitment: AGENT,
      });

      expect(result.status).toBe("FRACTIONALIZED_LOCKED");
      expect(result.symbol).toBe("Au");
      expect(result.unit).toBe("mAu");
      expect(result.mintedMilliUnits).toBe(1_000_000);
      expect(prismaMock.vaultBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            batchNumber: GOLD_BATCH.batchNumber,
            status: "AUDITED",
          }),
          data: expect.objectContaining({ status: "FRACTIONALIZED_LOCKED" }),
        })
      );
      expect(prismaMock.fractionalCommodityBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment_commoditySymbol: expect.objectContaining({
              subjectCommitment: fractionalCommodityWalletCommitment("Au", AGENT),
              commoditySymbol: "Au",
            }),
          }),
          create: expect.objectContaining({ milliUnits: 1_000_000 }),
        })
      );
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectCommitment: fractionalCommodityWalletCommitment("Au", AGENT),
          }),
        })
      );
    });

    it("mints lithium gLi against the correct unit conversion", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({ ...LITHIUM_BATCH });
      prismaMock.commodityEscrow.findFirst.mockResolvedValue(null);
      prismaMock.vaultBatch.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await fractionalizeVaultBatch({
        batchNumber: LITHIUM_BATCH.batchNumber,
        depositorCommitment: AGENT,
      });

      expect(result.symbol).toBe("Li");
      expect(result.unit).toBe("gLi");
      expect(result.mintedMilliUnits).toBe(250_000);
    });

    it("rejects fractionalizing a batch with an active HELD escrow (encumbered)", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({ ...GOLD_BATCH });
      prismaMock.commodityEscrow.findFirst.mockResolvedValue({
        escrowId: "esc_active",
        status: "HELD",
      });

      await expect(
        fractionalizeVaultBatch({
          batchNumber: GOLD_BATCH.batchNumber,
          depositorCommitment: AGENT,
        })
      ).rejects.toThrow(/encumbered/);
      expect(prismaMock.vaultBatch.updateMany).not.toHaveBeenCalled();
    });

    it("aborts if a concurrent transaction already locked the batch", async () => {
      prismaMock.vaultBatch.findUnique.mockResolvedValue({ ...GOLD_BATCH });
      prismaMock.commodityEscrow.findFirst.mockResolvedValue(null);
      prismaMock.vaultBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        fractionalizeVaultBatch({
          batchNumber: GOLD_BATCH.batchNumber,
          depositorCommitment: AGENT,
        })
      ).rejects.toThrow(/no longer AUDITED/);
    });
  });

  describe("executePoolSwap", () => {
    const GOLD_POOL = {
      id: "pool_au",
      poolId: "POOL-ANGEL_MAU",
      pairSymbol: "ANGEL_MAU",
      commoditySymbol: "Au",
      angelReserve: 30_000_000,
      commodityReserve: 2_000_000_000,
      totalLpTokens: 0,
      version: 1,
      status: "ACTIVE",
    };

    const mockSwapSetup = (overrides: Partial<typeof GOLD_POOL> = {}) => {
      const pool = { ...GOLD_POOL, ...overrides };
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({ ...pool });
      prismaMock.commodityLiquidityPool.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});
      prismaMock.ammSwapReceipt.create.mockResolvedValue({
        swapId: "SWAP-1",
        poolId: pool.id,
        status: "EXECUTED",
      });
      return pool;
    };

    it("executes an oracle-guarded ANGEL→mAu swap with a 50 bps SOLID fee", async () => {
      const pool = mockSwapSetup();

      const result = await executePoolSwap({
        poolId: pool.poolId,
        agentCommitment: AGENT,
        inputToken: "ANGEL",
        inputAmount: 15_000,
      });

      expect(result.inputToken).toBe("ANGEL");
      expect(result.outputToken).toBe("COMMODITY");
      expect(result.outputAmount).toBeGreaterThan(0);
      expect(result.feeAngel).toBeGreaterThan(0);
      expect(result.regime).toBe("SOLID");
      expect(Math.abs(result.deviationPct)).toBeLessThanOrEqual(MAX_ORACLE_DEVIATION_PCT);
      expect(prismaMock.commodityLiquidityPool.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "pool_au", version: 1, status: "ACTIVE" }),
        })
      );
      expect(prismaMock.agentWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ subjectCommitment: STABILIZATION_TREASURY }),
        })
      );
    });

    it("applies 1500 bps fee and records GHOST regime when governor is stressed", async () => {
      setRegime("GHOST");
      const pool = mockSwapSetup();

      const result = await executePoolSwap({
        poolId: pool.poolId,
        agentCommitment: AGENT,
        inputToken: "ANGEL",
        inputAmount: 15_000,
      });

      expect(result.regime).toBe("GHOST");
      expect(result.feeAngel).toBe(2250);
    });

    it("rejects a swap whose execution price deviates more than 5% from the oracle spot", async () => {
      const pool = mockSwapSetup({
        angelReserve: 300_000_000,
        commodityReserve: 10_000_000,
      });

      await expect(
        executePoolSwap({
          poolId: pool.poolId,
          agentCommitment: AGENT,
          inputToken: "ANGEL",
          inputAmount: 15_000,
        })
      ).rejects.toThrow(/exceeds the .* oracle band/i);
      expect(prismaMock.commodityLiquidityPool.updateMany).not.toHaveBeenCalled();
    });

    it("aborts the swap under concurrent mutation of the pool (double-spend guard)", async () => {
      const pool = mockSwapSetup();
      prismaMock.commodityLiquidityPool.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        executePoolSwap({
          poolId: pool.poolId,
          agentCommitment: AGENT,
          inputToken: "ANGEL",
          inputAmount: 15_000,
        })
      ).rejects.toThrow(/mutated concurrently/i);
      expect(prismaMock.ammSwapReceipt.create).not.toHaveBeenCalled();
    });
  });

  describe("removeLiquidity", () => {
    it("halts LP liquidity removal outright in GHOST regime", async () => {
      setRegime("GHOST");
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({
        id: "pool_au",
        poolId: "POOL-ANGEL_MAU",
        status: "ACTIVE",
        version: 1,
      });

      await expect(
        removeLiquidity({
          poolId: "POOL-ANGEL_MAU",
          operatorCommitment: OPERATOR,
          angelAmount: 1000,
        })
      ).rejects.toThrow(/REMOVE_LIQUIDITY_HALTED/i);

      expect(prismaMock.commodityLiquidityPool.updateMany).not.toHaveBeenCalled();
    });

    it("allows LP liquidity removal with an atomic version guard in SOLID regime", async () => {
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({
        id: "pool_au",
        poolId: "POOL-ANGEL_MAU",
        status: "ACTIVE",
        version: 3,
        angelReserve: 50_000,
      });
      prismaMock.commodityLiquidityPool.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await removeLiquidity({
        poolId: "POOL-ANGEL_MAU",
        operatorCommitment: OPERATOR,
        angelAmount: 1000,
      });

      expect(result.removedAngel).toBe(1000);
      expect(prismaMock.commodityLiquidityPool.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "pool_au", version: 3, status: "ACTIVE" }),
        })
      );
    });
  });

  describe("bootstrapAmmLiquidity", () => {
    const GOLD_POOL_EMPTY = {
      id: "pool_au",
      poolId: "POOL-ANGEL_MAU",
      pairSymbol: "ANGEL_MAU",
      commoditySymbol: "Au",
      status: "ACTIVE",
      totalLpTokens: 0,
      version: 1,
    };

    it("blocks re-seeding an already-seeded pool", async () => {
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({
        ...GOLD_POOL_EMPTY,
        totalLpTokens: 500,
      });

      await expect(
        bootstrapAmmLiquidity({
          poolId: "POOL-ANGEL_MAU",
          angelSeed: 10_000,
          commoditySeed: 100_000,
        })
      ).rejects.toThrow(/re-seed refused/i);
      expect(prismaMock.commodityLiquidityPool.updateMany).not.toHaveBeenCalled();
    });

    it("blocks seeding in GHOST regime", async () => {
      setRegime("GHOST");
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({ ...GOLD_POOL_EMPTY });

      await expect(
        bootstrapAmmLiquidity({
          poolId: "POOL-ANGEL_MAU",
          angelSeed: 10_000,
          commoditySeed: 100_000,
        })
      ).rejects.toThrow(/GHOST regime/i);
    });

    it("mints LP tokens exactly once on a valid seed", async () => {
      setRegime("SOLID");
      prismaMock.commodityLiquidityPool.findUnique.mockResolvedValue({ ...GOLD_POOL_EMPTY });
      prismaMock.commodityLiquidityPool.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.agentWallet.upsert.mockResolvedValue({});

      const result = await bootstrapAmmLiquidity({
        poolId: "POOL-ANGEL_MAU",
        angelSeed: 10_000,
        commoditySeed: 90_000,
      });

      // floor(sqrt(10,000 * 90,000)) = floor(30,000) = 30,000
      expect(result.lpTokensMinted).toBe(30000);
      expect(result.regime).toBe("SOLID");
      expect(prismaMock.commodityLiquidityPool.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "pool_au",
            totalLpTokens: 0,
            status: "ACTIVE",
          }),
        })
      );
      // REGRESSION GUARD: LP share tokens are pool-relative accounting and must NEVER be
      // written into AgentWallet.balance (which is summed as ANGEL circulating supply).
      expect(prismaMock.agentWallet.upsert).not.toHaveBeenCalled();
    });
  });
});