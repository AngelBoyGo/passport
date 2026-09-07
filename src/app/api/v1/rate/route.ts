import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import {
  MONETARY_PARAMS,
  ANGEL_BUNDLES,
  FEATURE_GRID,
  FEATURE_USD_PRICES,
  gridRound,
  revalue,
  signRateReceipt,
} from "@/lib/angelcoin/monetary";
import { generateLivePoR } from "@/lib/reserves/por-service";
import { getCommoditySpotPrices } from "@/lib/reserves/commodity-oracle";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/rate — current ANGEL rate, signed and publicly verifiable.
 *
 * Returns: current rate P(t), redemption rate P_red(t), circulating supply,
 * reserve balance derived from audited physical gold (fine grams × spot) plus
 * fiat treasury, epoch number, and an Ed25519 signature over the state.
 *
 * This is the "central bank publishes its numbers" endpoint.
 */
export async function GET() {
  // Gather supply, fiat treasury, and physical gold reserve data
  const [wallets, goldPoR, spotPrices] = await Promise.all([
    prisma.agentWallet.findMany({ select: { balance: true, staked: true } }),
    generateLivePoR("GOLD").catch(() => null),
    Promise.resolve(getCommoditySpotPrices()),
  ]);

  const circulatingSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
  const stakedSupply = wallets.reduce((sum, w) => sum + w.staked, 0);

  // Physical commodity reserve valuation (fine grams × live gold spot price)
  const goldSpotUsd = spotPrices.Au?.priceUsd ?? 0;
  const physicalGoldGrams = goldPoR?.reserve?.totalFineGrams ?? 0;
  const commodityReserveUsd = Number((physicalGoldGrams * goldSpotUsd).toFixed(2));

  // Fiat treasury component: sum inflows and subtract redemption outflows
  const ledgerEntries = await prisma.operatorLedgerEntry.findMany({
    where: {
      kind: {
        in: [
          "stablecoin_topup",
          "angelcoin_topup",
          "angelcoin_on_behalf",
          "rwa_redemption_queued",
          "angl_redemption",
        ],
      },
    },
    select: { deltaMicros: true },
  });
  const fiatReserveUsd = Math.max(
    0,
    ledgerEntries.reduce((sum, t) => sum + t.deltaMicros / 10_000 / 100, 0)
  );

  const reserveBalance = Number((commodityReserveUsd + fiatReserveUsd).toFixed(2));

  // Revaluation with solvency gating (physical + fiat reserve)
  const revalued = revalue({
    previousRate: MONETARY_PARAMS.P0,
    reserveBalance,
    previousReserveBalance: reserveBalance,
    circulatingSupply: Math.max(circulatingSupply, 1),
  });
  const currentP = revalued.P;
  const currentPRed = revalued.P_red;

  // Compute epoch number (weeks since epoch 0 = Jan 1 2026)
  const epochZero = new Date("2026-01-01T00:00:00Z").getTime();
  const epoch = Math.floor((Date.now() - epochZero) / (MONETARY_PARAMS.epochSeconds * 1000));

  // Bundle prices at current rate
  const bundles = ANGEL_BUNDLES.map((b) => ({
    ...b,
    price_usd: b.angl * currentP,
    stranded_after_max_spend: 1, // Guaranteed by 2^k+1 / 2^j geometry
  }));

  // Feature prices at current rate
  const features = Object.entries(FEATURE_USD_PRICES).map(([feature, usd]) => ({
    feature,
    usd_price: usd,
    angel_price: gridRound(usd, currentP),
    grid: FEATURE_GRID.includes(gridRound(usd, currentP)),
  }));

  const rateState = {
    epoch,
    P: currentP,
    S: circulatingSupply,
    R: reserveBalance,
    P_red: currentPRed,
    staked: stakedSupply,
    previous_P: currentP,
    net_inflow: 0,
    g: 0,
  };

  const signature = await signRateReceipt(rateState);

  return NextResponse.json({
    rate: {
      price_usd: currentP,
      redemption_usd: currentPRed,
      spread: `${(MONETARY_PARAMS.redemptionSpread * 100).toFixed(0)}%`,
      currency: "USD",
      epoch,
      next_epoch: new Date(Date.now() + MONETARY_PARAMS.epochSeconds * 1000).toISOString(),
    },
    supply: {
      circulating: circulatingSupply,
      staked: stakedSupply,
      total_minted: circulatingSupply + stakedSupply,
    },
    reserve: {
      balance_usd: reserveBalance,
      ratio: MONETARY_PARAMS.reserveRatio,
      backing: "Physical gold bullion + fiat treasury backing",
      composition: {
        physical_gold_grams: physicalGoldGrams,
        gold_spot_usd_per_gram: goldSpotUsd,
        commodity_reserve_usd: commodityReserveUsd,
        fiat_reserve_usd: Number(fiatReserveUsd.toFixed(2)),
        total_reserve_usd: reserveBalance,
        merkle_root: goldPoR?.reserve?.merkleRoot ?? "0".repeat(64),
      },
      solvency: {
        backing_ratio: revalued.backingRatio,
        solvency_deficit_usd: revalued.solvencyDeficitUsd,
        floored: revalued.floored,
        quarantine_recommended: revalued.quarantineRecommended,
      },
    },
    bundles,
    features,
    parameters: {
      P0: MONETARY_PARAMS.P0,
      alpha: MONETARY_PARAMS.alpha,
      band: `${((MONETARY_PARAMS.bandDown - 1) * 100).toFixed(0)}% / +${((MONETARY_PARAMS.bandUp - 1) * 100).toFixed(0)}%`,
      spread: `${(MONETARY_PARAMS.redemptionSpread * 100).toFixed(0)}%`,
      min_feature_price: MONETARY_PARAMS.minFeaturePrice,
      grid: FEATURE_GRID,
      hysteresis: `±${(MONETARY_PARAMS.hysteresisBand * 100).toFixed(0)}%`,
    },
    signature: {
      algorithm: "ed25519",
      public_key: getPublicKeyHex(),
      signature,
      signed_payload: rateState,
      verify: "Verify signature over canonicalJson(signed_payload) using public_key",
    },
    disclaimer: "ANGEL is a closed-loop utility currency. Value represents purchasing power within the Passport ecosystem. Not an investment. Not redeemable for cash by end users. See terms of service.",
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}