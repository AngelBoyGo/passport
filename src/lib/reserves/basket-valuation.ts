/**
 * Commodity Basket Valuation & Cost-of-Carry Engine
 *
 * Implements:
 * - Aggregated basket valuation across vaulted physical commodities
 * - Annualized physical cost-of-carry deduction (storage, vault security, assay maintenance)
 * - Floor backing calculation per circulating AngelCoin
 * - Mathematical solvency ratio audit (Net Vaulted Assets vs. Outstanding Liabilities)
 */

import { getCommoditySpotPrices, type CommodityPrice } from "./commodity-oracle";
import { prisma } from "@/lib/db";

export interface BasketComposition {
  commodityType: string;
  symbol: string;
  fineUnits: number;
  unit: string;
  spotPriceUsd: number;
  grossValueUsd: number;
  weightPercent: number;
}

export interface BasketValuationResult {
  timestamp: string;
  totalGrossValueUsd: number;
  annualCarryRatePercent: number;
  annualCarryCostUsd: number;
  netReserveValueUsd: number;
  composition: BasketComposition[];
  solvencyMetrics: {
    circulatingSupply: number;
    nominalTokenPriceUsd: number;
    totalLiabilityUsd: number;
    backingRatio: number; // netReserveValueUsd / totalLiabilityUsd
    isSolvent: boolean;
    reserveFloorPriceUsd: number; // netReserveValueUsd / circulatingSupply
  };
}

export const DEFAULT_CARRY_RATE_PERCENT = 0.5; // 50 bps annualized custody/vaulting fee

/**
 * Computes pure mathematical valuation over an explicit inventory of commodity holdings.
 */
export function computeBasketValuation(params: {
  holdings: Array<{ commodityType: string; symbol: string; fineUnits: number }>;
  spotPrices?: Record<string, CommodityPrice>;
  circulatingSupply?: number;
  tokenPriceUsd?: number;
  carryRatePercent?: number;
}): BasketValuationResult {
  const spotPrices = params.spotPrices ?? getCommoditySpotPrices();
  const circulatingSupply = Math.max(params.circulatingSupply ?? 1000, 1);
  const tokenPriceUsd = params.tokenPriceUsd ?? 5.0;
  const carryRate = params.carryRatePercent ?? DEFAULT_CARRY_RATE_PERCENT;

  let totalGrossValueUsd = 0;
  const rawComposition: Array<{
    commodityType: string;
    symbol: string;
    fineUnits: number;
    unit: string;
    spotPriceUsd: number;
    grossValueUsd: number;
  }> = [];

  for (const item of params.holdings) {
    const priceInfo = spotPrices[item.symbol];
    const spotPrice = priceInfo ? priceInfo.priceUsd : 0;
    const grossValue = Number((item.fineUnits * spotPrice).toFixed(2));
    totalGrossValueUsd += grossValue;

    rawComposition.push({
      commodityType: item.commodityType,
      symbol: item.symbol,
      fineUnits: item.fineUnits,
      unit: priceInfo?.unit || "unit",
      spotPriceUsd: spotPrice,
      grossValueUsd: grossValue,
    });
  }

  // Calculate percentage weights
  const composition: BasketComposition[] = rawComposition.map((c) => ({
    ...c,
    weightPercent:
      totalGrossValueUsd > 0
        ? Number(((c.grossValueUsd / totalGrossValueUsd) * 100).toFixed(2))
        : 0,
  }));

  const annualCarryCostUsd = Number(((totalGrossValueUsd * carryRate) / 100).toFixed(2));
  const netReserveValueUsd = Math.max(0, totalGrossValueUsd - annualCarryCostUsd);

  const totalLiabilityUsd = Number((circulatingSupply * tokenPriceUsd).toFixed(2));
  const backingRatio =
    totalLiabilityUsd > 0
      ? Number((netReserveValueUsd / totalLiabilityUsd).toFixed(4))
      : 0;
  const isSolvent = backingRatio >= 1.0;
  const reserveFloorPriceUsd = Number((netReserveValueUsd / circulatingSupply).toFixed(4));

  return {
    timestamp: new Date().toISOString(),
    totalGrossValueUsd: Number(totalGrossValueUsd.toFixed(2)),
    annualCarryRatePercent: carryRate,
    annualCarryCostUsd,
    netReserveValueUsd: Number(netReserveValueUsd.toFixed(2)),
    composition,
    solvencyMetrics: {
      circulatingSupply,
      nominalTokenPriceUsd: tokenPriceUsd,
      totalLiabilityUsd,
      backingRatio,
      isSolvent,
      reserveFloorPriceUsd,
    },
  };
}

/**
 * Evaluates live database reserves against market spot prices and total token supply.
 */
export async function getLiveBasketValuation(options?: {
  tokenPriceUsd?: number;
  carryRatePercent?: number;
}): Promise<BasketValuationResult> {
  const [reserves, wallets] = await Promise.all([
    prisma.commodityReserve.findMany(),
    prisma.agentWallet.findMany({ select: { balance: true } }),
  ]);

  const circulatingSupply = wallets.reduce((sum, w) => sum + w.balance, 0);

  const holdings = reserves.map((r) => ({
    commodityType: r.commodityType,
    symbol: r.symbol,
    fineUnits: r.totalFineGrams, // currently gold is in grams
  }));

  // If no reserves are yet registered in DB, provide empty holdings
  return computeBasketValuation({
    holdings,
    circulatingSupply: Math.max(circulatingSupply, 1),
    tokenPriceUsd: options?.tokenPriceUsd,
    carryRatePercent: options?.carryRatePercent,
  });
}
