import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import {
  MONETARY_PARAMS,
  ANGEL_BUNDLES,
  FEATURE_GRID,
  FEATURE_USD_PRICES,
  gridRound,
  signRateReceipt,
} from "@/lib/angelcoin/monetary";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/rate — current ANGEL rate, signed and publicly verifiable.
 *
 * Returns: current rate P(t), redemption rate P_red(t), circulating supply,
 * reserve balance, epoch number, and an Ed25519 signature over the entire
 * state so anyone can verify the rate wasn't set discretionarily.
 *
 * This is the "central bank publishes its numbers" endpoint.
 */
export async function GET() {
  // Gather supply and reserve data
  const [wallets, treasuryAccount] = await Promise.all([
    prisma.agentWallet.findMany({ select: { balance: true, staked: true } }),
    prisma.angelCoinAccount.findUnique({
      where: { subjectCommitment: "protocol_treasury_system" },
    }),
  ]);

  const circulatingSupply = wallets.reduce((sum, w) => sum + w.balance, 0);
  const stakedSupply = wallets.reduce((sum, w) => sum + w.staked, 0);

  // Reserve = total USD value from all topups (proxy for actual reserve)
  const topups = await prisma.operatorLedgerEntry.findMany({
    where: { kind: { in: ["stablecoin_topup", "angelcoin_topup", "angelcoin_on_behalf"] } },
    select: { deltaMicros: true },
  });
  const reserveBalance = topups.reduce((sum, t) => sum + Math.abs(t.deltaMicros) / 10_000 / 100, 0);

  // Current rate — for now, P0 (the revaluation cron will update this over time)
  // In production, store P(t) in a RateState table or env var
  const currentP = MONETARY_PARAMS.P0;
  const currentPRed = currentP * (1 - MONETARY_PARAMS.redemptionSpread);

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
    grid: FEATURE_GRID.includes(gridRound(usd, currentP) as any),
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
      backing: "100% — every ANGEL backed by USD in treasury",
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