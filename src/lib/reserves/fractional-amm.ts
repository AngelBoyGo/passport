/**
 * Fractionalized Commodity Clearing & Dual-State Autonomous Liquidity Engine (RWA-AMM)
 *
 * Implements AES Protocol ASMC-3 Phase 17:
 * - Fractionalizes audited, unencumbered VaultBatch lots into integer milli-units back by
 *   deterministic 64-hex agent wallets (1 fine gram Au = 1,000 mAu; 1 kg Li = 1,000 gLi).
 * - Oracle-anchored XYK constant-product ANGEL / commodity pools with a Dual-State
 *   Governor interlock (SOLID = 50 bps, GHOST = 1500 bps + liquidity removal halt).
 * - Precise conservation of value: pool balance mutations are guarded by an optimistic
 *   `version` counter, and swap execution prices are bounded to the commodity spot oracle
 *   within a ±5.0% band (anti-sandwich / anti-flash-drain).
 * - Physical redemption: burning 100% of a batch's issued milli-units unlocks the physical
 *   lot back into AUDITED reserve status.
 */

import { prisma } from "@/lib/db";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getCommoditySpotPrices } from "./commodity-oracle";
import { getLiveGovernorAssessment } from "./dual-state-governor";
import type { RegimeState } from "./dual-state-governor";

export const ANGEL_USD_PEG = 5.0;
export const MAX_ORACLE_DEVIATION_PCT = 5.0;

/** Deterministic 64-hex commitment for a fractional commodity wallet. */
export function fractionalCommodityWalletCommitment(
  commoditySymbol: string,
  holderCommitment: string
): string {
  return sha256Hex(`fractional:${commoditySymbol.toUpperCase()}:${holderCommitment}`);
}

export interface CommodityUnit {
  unit: string;
  commodityType: string;
  /** milli-units per 1 fine gram for Au, per 1 kg for Li */
  milliUnitsPerUnit: number;
  priceUsdPerUnit: number;
  symbol: string;
}

export const FRACTIONAL_UNITS: Record<string, CommodityUnit> = {
  MAU: {
    unit: "mAu",
    commodityType: "GOLD",
    milliUnitsPerUnit: 1000,
    priceUsdPerUnit: 75.0,
    symbol: "Au",
  },
  GLI: {
    unit: "gLi",
    commodityType: "LITHIUM",
    milliUnitsPerUnit: 1000,
    priceUsdPerUnit: 14.25,
    symbol: "Li",
  },
};

export const FEE_BPS_SOLID = 50;
export const FEE_BPS_GHOST = 1500;

/** Portion of swap fees retained in the pool (accrues to LPs). */
export const POOL_RETAIN_BPS = 6000;
/** 30% routed to Sovereign Stabilization Treasury. */
export const TREASURY_SHARE_BPS = 3000;
/** 10% routed to Corridor Infrastructure Pool. */
export const CORRIDOR_SHARE_BPS = 1000;

export const STABILIZATION_TREASURY = "protocol_treasury_system";

export interface FractionalizeInput {
  batchNumber: string;
  depositorCommitment: string;
}

export interface SwapInput {
  poolId: string;
  agentCommitment: string;
  inputToken: "ANGEL" | "MAU" | "GLI";
  inputAmount: number;
}

export interface PoolSnapshot {
  poolId: string;
  pairSymbol: string;
  commoditySymbol: string;
  angelReserve: number;
  commodityReserve: number;
  totalLpTokens: number;
  version: number;
  status: string;
  spotPriceUsd: number; // USD per 1,000 milli-units (i.e. per gram Au / kg Li)
  effectivePriceUsd: number; // realized mAu rate from current pool reserves
  deviationPct: number;
  regime: RegimeState;
  feeBps: number;
}

/**
 * Converts a raw wallet commitment into an integer milli-unit balance.
 * All fractional commodity balances are exact ledger integers — no floating dust.
 */
export function integerMilliUnitsFromFineWeight(fineWeightGrams: number, milliUnitsPerUnit: number): number {
  if (!Number.isFinite(fineWeightGrams) || fineWeightGrams <= 0) return 0;
  return Math.floor(fineWeightGrams * milliUnitsPerUnit);
}

/**
 * Computes the ANGEL value of a commodity pool's milli-unit reserve at the oracle peg.
 * Used for weight/liability math.
 */
export function milliUnitsToAngel(milliUnits: number, unit: CommodityUnit): number {
  const gramsOrKg = milliUnits / unit.milliUnitsPerUnit;
  const usdValue = gramsOrKg * unit.priceUsdPerUnit;
  return Math.floor(usdValue / ANGEL_USD_PEG);
}

/**
 * Creates or returns an existing constant-product pool for a pair symbol.
 */
export async function ensurePool(pairSymbol: "ANGEL_MAU" | "ANGEL_GLI") {
  const unit = pairSymbol === "ANGEL_MAU" ? FRACTIONAL_UNITS.MAU : FRACTIONAL_UNITS.GLI;
  const poolId = `POOL-${pairSymbol}`;
  const existing = await prisma.commodityLiquidityPool.findUnique({
    where: { poolId },
  });
  if (existing) return existing;

  return prisma.commodityLiquidityPool.create({
    data: {
      poolId,
      pairSymbol,
      commoditySymbol: unit.symbol,
      status: "ACTIVE",
    },
  });
}

export interface BootstrapLiquidityInput {
  poolId: string;
  angelSeed: number;
  commoditySeed: number;
  reason?: string;
}

/**
 * Seeds an empty constant-product pool with initial ANGEL + commodity milli-unit reserves.
 * Guards:
 *   - Re-seed is refused (pool.totalLpTokens > 0) → no LP-token dilution.
 *   - Seeding is refused while the Dual-State Governor is in GHOST regime.
 * Mints `floor(sqrt(angelSeed * commoditySeed))` LP tokens to the pool LP vault.
 */
export async function bootstrapAmmLiquidity(input: BootstrapLiquidityInput) {
  const angelSeed = Math.max(1, Math.floor(input.angelSeed));
  const commoditySeed = Math.max(1, Math.floor(input.commoditySeed));

  const pool = await prisma.commodityLiquidityPool.findUnique({
    where: { poolId: input.poolId },
  });
  if (!pool) {
    throw new Error(`Liquidity pool '${input.poolId}' not found`);
  }
  if (pool.status !== "ACTIVE") {
    throw new Error(`Liquidity pool '${input.poolId}' is currently ${pool.status}`);
  }
  if (pool.totalLpTokens > 0) {
    throw new Error(`Liquidity pool '${input.poolId}' is already seeded (re-seed refused)`);
  }

  const regime = (await getLiveGovernorAssessment()).regime;
  if (regime === "GHOST") {
    throw new Error(
      `Liquidity bootstrap blocked while the Dual-State Governor is in GHOST regime`
    );
  }

  const lpTokens = Math.floor(Math.sqrt(angelSeed * commoditySeed));

  return prisma.$transaction(async (tx) => {
    // Atomic guard: only seeds a still-empty pool (version bump protects concurrent seed).
    const seeded = await tx.commodityLiquidityPool.updateMany({
      where: { id: pool.id, totalLpTokens: 0, status: "ACTIVE" },
      data: {
        angelReserve: { increment: angelSeed },
        commodityReserve: { increment: commoditySeed },
        totalLpTokens: lpTokens,
        version: { increment: 1 },
      },
    });
    if (seeded.count !== 1) {
      throw new Error(`Pool '${input.poolId}' was seeded concurrently (aborted)`);
    }

    // NOTE: LP share tokens are NOT written into AgentWallet.balance. That ledger is
    // reserved exclusively for whole ANGEL and is summed as circulating supply by the
    // rate oracle, basket valuation, and Dual-State Governor. LP tokens are pool-relative
    // share accounting only (already tracked in totalLpTokens) and must never inflate
    // the ANGEL money supply.

    return {
      poolId: pool.poolId,
      angelSeed,
      commoditySeed,
      lpTokensMinted: lpTokens,
      regime,
    };
  });
}

/**
 * Fractionalizes an audited, unencumbered VaultBatch into milli-unit tokens credited to a
 * deterministic 64-hex fractional wallet. The physical lot is locked to FRACTIONALIZED_LOCKED.
 */
export async function fractionalizeVaultBatch(input: FractionalizeInput) {
  if (!/^[0-9a-f]{64}$/i.test(input.depositorCommitment)) {
    throw new Error("Invalid depositor commitment (expected 64-hex)");
  }

  return prisma.$transaction(async (tx) => {
    const batch = await tx.vaultBatch.findUnique({
      where: { batchNumber: input.batchNumber },
      include: { reserve: true },
    });
    if (!batch) {
      throw new Error(`Vault batch '${input.batchNumber}' not found`);
    }
    if (batch.status !== "AUDITED") {
      throw new Error(
        `Vault batch '${input.batchNumber}' must be in AUDITED state to fractionalize (current: ${batch.status})`
      );
    }

    // Unencumbered: must not be locked in an active HELD escrow.
    const heldEscrow = await tx.commodityEscrow.findFirst({
      where: { batchNumber: input.batchNumber, status: "HELD" },
    });
    if (heldEscrow) {
      throw new Error(`Vault batch '${input.batchNumber}' is encumbered by an active escrow`);
    }

    const unit =
      batch.reserve.commodityType === "LITHIUM" ? FRACTIONAL_UNITS.GLI : FRACTIONAL_UNITS.MAU;
    const mintUnits = integerMilliUnitsFromFineWeight(batch.fineWeightGrams, unit.milliUnitsPerUnit);

    if (mintUnits < 1) {
      throw new Error(`Vault batch '${input.batchNumber}' has no fractionalizable fine weight`);
    }

    // 0. Atomic lock AUDITED -> FRACTIONALIZED_LOCKED (guards double-fractionalization).
    const transitioned = await tx.vaultBatch.updateMany({
      where: { batchNumber: input.batchNumber, status: "AUDITED" },
      data: { status: "FRACTIONALIZED_LOCKED" },
    });
    if (transitioned.count !== 1) {
      throw new Error(`Vault batch '${input.batchNumber}' is no longer AUDITED (fractionalization aborted)`);
    }

    // 1. Mint exact integer milli-units into the dedicated fractional commodity ledger.
    //    Fractional units are NEVER written into AgentWallet.balance, which is reserved
    //    for whole ANGEL; storing milli-units there would pollute the protocol-wide
    //    circulating-supply accounting used by the rate oracle and solvency governor.
    const walletCommitment = fractionalCommodityWalletCommitment(unit.symbol, input.depositorCommitment);
    await tx.fractionalCommodityBalance.upsert({
      where: {
        subjectCommitment_commoditySymbol: {
          subjectCommitment: walletCommitment,
          commoditySymbol: unit.symbol,
        },
      },
      create: {
        subjectCommitment: walletCommitment,
        commoditySymbol: unit.symbol,
        milliUnits: mintUnits,
        earnedTotal: mintUnits,
        lastActivityAt: new Date(),
      },
      update: {
        milliUnits: { increment: mintUnits },
        earnedTotal: { increment: mintUnits },
        lastActivityAt: new Date(),
      },
    });

    return {
      batchNumber: input.batchNumber,
      commodityType: batch.reserve.commodityType,
      symbol: unit.symbol,
      unit: unit.unit,
      mintedMilliUnits: mintUnits,
      walletCommitment,
      status: "FRACTIONALIZED_LOCKED",
    };
  });
}

/**
 * Live pool snapshot with oracle-anchored price deviation and governing regime.
 */
export async function getPoolSnapshot(poolIdOrSymbol: string): Promise<PoolSnapshot> {
  const pool = await prisma.commodityLiquidityPool.findFirst({
    where: {
      OR: [
        { poolId: poolIdOrSymbol },
        { pairSymbol: poolIdOrSymbol },
      ],
    },
  });
  if (!pool) {
    throw new Error(`Liquidity pool '${poolIdOrSymbol}' not found`);
  }

  const unit = pool.pairSymbol === "ANGEL_MAU" ? FRACTIONAL_UNITS.MAU : FRACTIONAL_UNITS.GLI;
  const spotPrices = getCommoditySpotPrices();
  const spotPriceUsd = spotPrices[pool.commoditySymbol]?.priceUsd ?? unit.priceUsdPerUnit;

  // Effective price: ANGEL per 1000 milli-units (i.e. per gram Au / kg Li), integer-safe.
  const effectivePerUnitUsd =
    pool.commodityReserve > 0
      ? (pool.angelReserve / (pool.commodityReserve / unit.milliUnitsPerUnit))
      : 0;
  const deviationPct =
    spotPriceUsd > 0
      ? Number((((effectivePerUnitUsd - spotPriceUsd) / spotPriceUsd) * 100).toFixed(4))
      : 0;

  const regime = (await getLiveGovernorAssessment()).regime;
  const feeBps = regime === "GHOST" ? FEE_BPS_GHOST : FEE_BPS_SOLID;

  return {
    poolId: pool.poolId,
    pairSymbol: pool.pairSymbol,
    commoditySymbol: pool.commoditySymbol,
    angelReserve: pool.angelReserve,
    commodityReserve: pool.commodityReserve,
    totalLpTokens: pool.totalLpTokens,
    version: pool.version,
    status: pool.status,
    spotPriceUsd: Number(spotPriceUsd.toFixed(4)),
    effectivePriceUsd: Number(effectivePerUnitUsd.toFixed(4)),
    deviationPct,
    regime,
    feeBps,
  };
}

/**
 * Determines the input/output token directions for a swap.
 */
function resolveSwapDirections(
  inputToken: string
): { inputIsAngel: boolean; inputCommodity: "ANGEL" | "MAU" | "GLI"; outputToken: string } {
  if (inputToken === "ANGEL") {
    return { inputIsAngel: true, inputCommodity: "ANGEL", outputToken: "COMMODITY" };
  }
  if (inputToken === "MAU" || inputToken === "GLI") {
    return { inputIsAngel: false, inputCommodity: inputToken, outputToken: "ANGEL" };
  }
  throw new Error("inputToken must be ANGEL, MAU, or GLI");
}

/**
 * Executes an oracle-guarded constant-product swap. Uses an optimistic-version row guard
 * to make double-swends on the same pool impossible.
 */
export async function executePoolSwap(input: SwapInput) {
  if (!/^[0-9a-f]{64}$/i.test(input.agentCommitment)) {
    throw new Error("Invalid agent commitment (expected 64-hex)");
  }
  const inputAmount = Math.max(1, Math.floor(input.inputAmount));
  const directions = resolveSwapDirections(input.inputToken);

  const pool = await prisma.commodityLiquidityPool.findUnique({
    where: { poolId: input.poolId },
  });
  if (!pool) {
    throw new Error(`Liquidity pool '${input.poolId}' not found`);
  }
  if (pool.status !== "ACTIVE") {
    throw new Error(`Liquidity pool '${input.poolId}' is currently ${pool.status}`);
  }
  if (
    (directions.inputCommodity === "MAU" && pool.pairSymbol !== "ANGEL_MAU") ||
    (directions.inputCommodity === "GLI" && pool.pairSymbol !== "ANGEL_GLI")
  ) {
    throw new Error(`Pool '${input.poolId}' does not trade token '${directions.inputCommodity}'`);
  }

  const unit = pool.pairSymbol === "ANGEL_MAU" ? FRACTIONAL_UNITS.MAU : FRACTIONAL_UNITS.GLI;
  const spotPrices = getCommoditySpotPrices();
  const spotPriceUsd = spotPrices[pool.commoditySymbol]?.priceUsd ?? unit.priceUsdPerUnit;
  const regime = (await getLiveGovernorAssessment()).regime;
  const feeBps = regime === "GHOST" ? FEE_BPS_GHOST : FEE_BPS_SOLID;

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.commodityLiquidityPool.findUnique({
      where: { poolId: input.poolId },
    });
    if (!fresh) {
      throw new Error(`Liquidity pool '${input.poolId}' not found`);
    }
    if (fresh.status !== "ACTIVE") {
      throw new Error(`Liquidity pool '${input.poolId}' is no longer ACTIVE`);
    }

    let outputAmount: number;
    let newAngelReserve: number;
    let newCommodityReserve: number;
    let effectivePriceUsd: number;

    if (directions.inputIsAngel) {
      // ANGEL -> mAu: sell ANGEL into pool for commodity milli-units.
      const k = fresh.angelReserve * fresh.commodityReserve;
      if (fresh.commodityReserve <= 0) {
        throw new Error("Pool has no commodity liquidity");
      }
      const newAngel = fresh.angelReserve + inputAmount;
      const newCommodity = Math.floor(k / newAngel);
      if (newCommodity < 1) {
        throw new Error("Pool commodity depth cannot satisfy swap");
      }
      outputAmount = fresh.commodityReserve - newCommodity;
      if (outputAmount < 1) {
        throw new Error("Swap output below 1 milli-unit");
      }
      newAngelReserve = newAngel;
      newCommodityReserve = newCommodity;
      // Effective price in USD per 1000 milli-units received (i.e. per gram).
      const gramsOut = outputAmount / unit.milliUnitsPerUnit;
      const spentUsd = inputAmount * ANGEL_USD_PEG;
      effectivePriceUsd = Number((spentUsd / gramsOut).toFixed(6));
    } else {
      // mAu -> ANGEL: sell commodity milli-units for ANGEL.
      const k = fresh.angelReserve * fresh.commodityReserve;
      if (fresh.angelReserve <= 0) {
        throw new Error("Pool has no ANGEL liquidity");
      }
      const newCommodity = fresh.commodityReserve + inputAmount;
      const newAngel = Math.floor(k / newCommodity);
      if (newAngel >= fresh.angelReserve) {
        throw new Error("Pool ANGEL depth cannot satisfy swap");
      }
      outputAmount = fresh.angelReserve - newAngel;
      if (outputAmount < 1) {
        throw new Error("Swap output below 1 ANGEL");
      }
      newAngelReserve = newAngel;
      newCommodityReserve = newCommodity;
      const gramsIn = inputAmount / unit.milliUnitsPerUnit;
      const receivedUsd = outputAmount * ANGEL_USD_PEG;
      effectivePriceUsd = Number((receivedUsd / gramsIn).toFixed(6));
    }

    // Oracle price-band guard (anti-sandwich / anti-flash-drain).
    const deviationPct =
      spotPriceUsd > 0
        ? Number((((effectivePriceUsd - spotPriceUsd) / spotPriceUsd) * 100).toFixed(4))
        : 0;
    if (Math.abs(deviationPct) > MAX_ORACLE_DEVIATION_PCT) {
      throw new Error(
        `Swap price deviation ${deviationPct.toFixed(2)}% exceeds the ${MAX_ORACLE_DEVIATION_PCT}% oracle band (aborted)`
      );
    }

    // Fee split: 60% retained in pool (accrues to LPs), 30% treasury, 10% corridor pool.
    // The fee base is the ANGEL-denominated flow: inputAmount (ANGEL) when buying
    // commodities, outputAmount (ANGEL) when selling commodities for ANGEL.
    const feeBaseAngel = directions.inputIsAngel ? inputAmount : outputAmount;
    const feeAngel = Math.floor((feeBaseAngel * feeBps) / 10_000);
    const treasuryShare = Math.floor((feeAngel * TREASURY_SHARE_BPS) / 10_000);
    const corridorShare = Math.floor((feeAngel * CORRIDOR_SHARE_BPS) / 10_000);
    const retained = Math.max(0, feeAngel - treasuryShare - corridorShare);
    const inputTokenDir = directions.inputCommodity;

    // Conservation of value:
    // - ANGEL -> commodity: pool keeps all input ANGEL except the treasury + corridor
    //   shares that leave the pool (the retained LP share stays in the pool).
    // - commodity -> ANGEL: pool ANGEL reserve already shed `outputAmount`; the retained
    //   LP share is credited back, and the agent is paid the output net of protocol fees.
    let finalAngelReserve: number;
    let finalCommodityReserve: number;
    let agentPayoutAngel: number;
    if (directions.inputIsAngel) {
      finalAngelReserve = newAngelReserve - treasuryShare - corridorShare;
      finalCommodityReserve = newCommodityReserve;
      agentPayoutAngel = 0;
    } else {
      finalAngelReserve = newAngelReserve + retained;
      finalCommodityReserve = newCommodityReserve;
      agentPayoutAngel = outputAmount - treasuryShare - corridorShare;
    }

    // Atomic optimistic-lock: only succeeds if pool version is unchanged.
    const guarded = await tx.commodityLiquidityPool.updateMany({
      where: { id: pool.id, version: pool.version, status: "ACTIVE" },
      data: {
        angelReserve: finalAngelReserve,
        commodityReserve: finalCommodityReserve,
        version: { increment: 1 },
      },
    });
    if (guarded.count !== 1) {
      throw new Error(`Pool '${input.poolId}' mutated concurrently (swap aborted)`);
    }

    // Credit protocol wallets for treasury & corridor shares.
    if (treasuryShare > 0) {
      await tx.agentWallet.upsert({
        where: { subjectCommitment: STABILIZATION_TREASURY },
        create: {
          subjectCommitment: STABILIZATION_TREASURY,
          balance: treasuryShare,
          earnedTotal: treasuryShare,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: treasuryShare },
          earnedTotal: { increment: treasuryShare },
          lastActivityAt: new Date(),
        },
      });
    }
    if (corridorShare > 0) {
      const corridorCommitment = sha256Hex("corridor:infrastructure:pool");
      await tx.agentWallet.upsert({
        where: { subjectCommitment: corridorCommitment },
        create: {
          subjectCommitment: corridorCommitment,
          balance: corridorShare,
          earnedTotal: corridorShare,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: corridorShare },
          earnedTotal: { increment: corridorShare },
          lastActivityAt: new Date(),
        },
      });
    }

    // Debit agent on the input leg.
    const agentWalletCommitment = fractionalCommodityWalletCommitment(
      unit.symbol,
      input.agentCommitment
    );
    if (directions.inputIsAngel) {
      // Agent pays ANGEL from their whole-ANGEL wallet (AgentWallet holds only ANGEL).
      const angelDebit = await tx.agentWallet.updateMany({
        where: { subjectCommitment: input.agentCommitment, balance: { gte: inputAmount } },
        data: {
          balance: { decrement: inputAmount },
          spentTotal: { increment: inputAmount },
          lastActivityAt: new Date(),
        },
      });
      if (angelDebit.count !== 1) {
        throw new Error(`Agent '${input.agentCommitment}' has insufficient ANGEL balance`);
      }
    } else {
      // Agent pays commodity milli-units from the dedicated fractional ledger.
      const commodityDebit = await tx.fractionalCommodityBalance.updateMany({
        where: {
          subjectCommitment: agentWalletCommitment,
          commoditySymbol: unit.symbol,
          milliUnits: { gte: inputAmount },
        },
        data: {
          milliUnits: { decrement: inputAmount },
          lastActivityAt: new Date(),
        },
      });
      if (commodityDebit.count !== 1) {
        throw new Error(`Agent '${input.agentCommitment}' has insufficient ${unit.unit} balance`);
      }
    }

    // Credit agent on the output leg.
    const payoutAmount = directions.inputIsAngel ? outputAmount : agentPayoutAngel;
    if (payoutAmount < 1) {
      throw new Error("Swap output net of fees is below 1 unit");
    }
    if (directions.inputIsAngel) {
      // ANGEL -> commodity: credit milli-units to the dedicated fractional ledger.
      await tx.fractionalCommodityBalance.upsert({
        where: {
          subjectCommitment_commoditySymbol: {
            subjectCommitment: agentWalletCommitment,
            commoditySymbol: unit.symbol,
          },
        },
        create: {
          subjectCommitment: agentWalletCommitment,
          commoditySymbol: unit.symbol,
          milliUnits: payoutAmount,
          earnedTotal: payoutAmount,
          lastActivityAt: new Date(),
        },
        update: {
          milliUnits: { increment: payoutAmount },
          earnedTotal: { increment: payoutAmount },
          lastActivityAt: new Date(),
        },
      });
    } else {
      // commodity -> ANGEL: credit net ANGEL payout to the whole-ANGEL wallet.
      await tx.agentWallet.upsert({
        where: { subjectCommitment: input.agentCommitment },
        create: {
          subjectCommitment: input.agentCommitment,
          balance: payoutAmount,
          earnedTotal: payoutAmount,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: payoutAmount },
          earnedTotal: { increment: payoutAmount },
          lastActivityAt: new Date(),
        },
      });
    }

    const swapId = `SWAP-${input.poolId}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
    const receipt = await tx.ammSwapReceipt.create({
      data: {
        swapId,
        poolId: pool.id,
        agentCommitment: input.agentCommitment,
        inputToken: inputTokenDir,
        inputAmount,
        outputToken: directions.outputToken,
        outputAmount: payoutAmount,
        feeAngel,
        oracleSpotUsd: Number(spotPriceUsd.toFixed(4)),
        effectivePriceUsd,
        deviationPct,
        regimeAtSwap: regime,
      },
    });

    return {
      receipt,
      poolId: pool.poolId,
      inputToken: inputTokenDir,
      inputAmount,
      outputToken: directions.outputToken,
      outputAmount: payoutAmount,
      feeAngel,
      regime,
      effectivePriceUsd,
      deviationPct,
    };
  });
}

export interface RemoveLiquidityInput {
  poolId: string;
  operatorCommitment: string;
  angelAmount: number;
}

/**
 * Removes single-sided ANGEL liquidity from a pool (LP withdrawal).
 * Blocked outright while the Dual-State Governor is in GHOST regime.
 */
export async function removeLiquidity(input: RemoveLiquidityInput) {
  if (!/^[0-9a-f]{64}$/i.test(input.operatorCommitment)) {
    throw new Error("Invalid operator commitment (expected 64-hex)");
  }
  const angelAmount = Math.max(1, Math.floor(input.angelAmount));

  const pool = await prisma.commodityLiquidityPool.findUnique({
    where: { poolId: input.poolId },
  });
  if (!pool) {
    throw new Error(`Liquidity pool '${input.poolId}' not found`);
  }
  if (pool.status !== "ACTIVE") {
    throw new Error(`Liquidity pool '${input.poolId}' is currently ${pool.status}`);
  }

  const regime = (await getLiveGovernorAssessment()).regime;
  if (regime === "GHOST") {
    throw new Error(
      "REMOVE_LIQUIDITY_HALTED: liquidity removal is halted while the Dual-State Governor is in GHOST regime"
    );
  }

  return prisma.$transaction(async (tx) => {
    const guarded = await tx.commodityLiquidityPool.updateMany({
      where: { id: pool.id, version: pool.version, angelReserve: { gte: angelAmount }, status: "ACTIVE" },
      data: {
        angelReserve: { decrement: angelAmount },
        version: { increment: 1 },
      },
    });
    if (guarded.count !== 1) {
      throw new Error(`Pool '${input.poolId}' mutated concurrently or has insufficient ANGEL (removal aborted)`);
    }

    await tx.agentWallet.upsert({
      where: { subjectCommitment: input.operatorCommitment },
      create: {
        subjectCommitment: input.operatorCommitment,
        balance: angelAmount,
        earnedTotal: angelAmount,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: angelAmount },
        earnedTotal: { increment: angelAmount },
        lastActivityAt: new Date(),
      },
    });

    return { poolId: pool.poolId, removedAngel: angelAmount, regime };
  });
}

/**
 * De-fractionalizes a batch by burning 100% of its issued milli-units. The physical lot is
 * restored to AUDITED reserve status only when all outstanding milli-units are surrendered.
 */
export async function redeemFractionalBatch(input: {
  batchNumber: string;
  holderCommitment: string;
}) {
  if (!/^[0-9a-f]{64}$/i.test(input.holderCommitment)) {
    throw new Error("Invalid holder commitment (expected 64-hex)");
  }

  return prisma.$transaction(async (tx) => {
    const batch = await tx.vaultBatch.findUnique({
      where: { batchNumber: input.batchNumber },
      include: { reserve: true },
    });
    if (!batch) {
      throw new Error(`Vault batch '${input.batchNumber}' not found`);
    }
    if (batch.status !== "FRACTIONALIZED_LOCKED") {
      throw new Error(
        `Vault batch '${input.batchNumber}' is not FRACTIONALIZED_LOCKED (current: ${batch.status})`
      );
    }

    const unit =
      batch.reserve.commodityType === "LITHIUM" ? FRACTIONAL_UNITS.GLI : FRACTIONAL_UNITS.MAU;
    const totalMinted = integerMilliUnitsFromFineWeight(batch.fineWeightGrams, unit.milliUnitsPerUnit);
    const walletCommitment = fractionalCommodityWalletCommitment(unit.symbol, input.holderCommitment);

    const holder = await tx.fractionalCommodityBalance.findUnique({
      where: {
        subjectCommitment_commoditySymbol: {
          subjectCommitment: walletCommitment,
          commoditySymbol: unit.symbol,
        },
      },
    });
    if (!holder || holder.milliUnits < totalMinted) {
      throw new Error(
        `Holder does not hold 100% of the ${unit.unit} issued for batch '${input.batchNumber}'`
      );
    }

    // Burn the full milli-unit supply atomically with a balance guard (TOCTOU-safe).
    const burned = await tx.fractionalCommodityBalance.updateMany({
      where: {
        subjectCommitment: walletCommitment,
        commoditySymbol: unit.symbol,
        milliUnits: { gte: totalMinted },
      },
      data: {
        milliUnits: { decrement: totalMinted },
        lastActivityAt: new Date(),
      },
    });
    if (burned.count !== 1) {
      throw new Error(
        `Holder's ${unit.unit} balance changed concurrently (burn aborted)`
      );
    }

    // Restore the physical lot to AUDITED reserve status.
    const unlocked = await tx.vaultBatch.updateMany({
      where: { batchNumber: input.batchNumber, status: "FRACTIONALIZED_LOCKED" },
      data: { status: "AUDITED" },
    });
    if (unlocked.count !== 1) {
      throw new Error(`Vault batch '${input.batchNumber}' could not be restored to AUDITED`);
    }

    return {
      batchNumber: input.batchNumber,
      burnedMilliUnits: totalMinted,
      holderCommitment: input.holderCommitment,
      restoredStatus: "AUDITED",
      burned: burned.count === 1,
    };
  });
}

/**
 * Lists all live pools and their normalized snapshots.
 */
export async function listPools() {
  const pools = await prisma.commodityLiquidityPool.findMany({
    orderBy: { pairSymbol: "asc" },
  });

  const snapshots: PoolSnapshot[] = [];
  for (const p of pools) {
    try {
      snapshots.push(await getPoolSnapshot(p.poolId));
    } catch {
      // Skip pool if it disappears mid-list; surface aggregate below.
    }
  }
  return snapshots;
}

/**
 * Reads the canonical normalized JSON representation of any pool — used as a stable
 * API output payload and for deterministic hashing.
 */
export function poolPayloadForHash(pool: PoolSnapshot): string {
  return canonicalJson({
    pool_id: pool.poolId,
    pair_symbol: pool.pairSymbol,
    commodity_symbol: pool.commoditySymbol,
    angel_reserve: pool.angelReserve,
    commodity_reserve: pool.commodityReserve,
    regime: pool.regime,
    fee_bps: pool.feeBps,
  });
}