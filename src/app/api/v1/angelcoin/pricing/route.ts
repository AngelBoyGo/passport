import { NextResponse } from "next/server";
import { ANGL_BATCHES } from "@/lib/angelcoin/batch-economy";
import {
  MONETARY_PARAMS,
  ANGEL_BUNDLES,
  FEATURE_USD_PRICES,
  gridRound,
} from "@/lib/angelcoin/monetary";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/angelcoin/pricing — canonical ANGEL pricing table (Spec v1.1).
 *
 * Every feature priced in ANGEL on the even parity grid {2, 4, 8, 16, 32}.
 * Every bundle sized as 2^k + 1 {5, 9, 17, 33}, guaranteeing exactly 1 stranded ANGEL.
 * Canonical baseline: 1 ANGEL = $5.00 USD.
 */
export async function GET() {
  const currentP = MONETARY_PARAMS.P0; // $5.00

  const canonicalBundles = ANGEL_BUNDLES.map((b) => ({
    bundle_id: b.bundle_id,
    angl: b.angl,
    usd: `$${(b.angl * currentP).toFixed(2)}`,
    label: b.label,
    description: b.description,
    stranded_after_max_spend: 1, // Guaranteed by 2^k+1 / 2^j geometry
  }));

  const canonicalFeatures = Object.entries(FEATURE_USD_PRICES).map(([feature, usd]) => ({
    feature,
    usd_price: usd,
    angel_cost: gridRound(usd, currentP),
  }));

  const spreadBps = Number(process.env.ANGL_SPREAD_BPS) || 500; // 5% default

  return NextResponse.json({
    pricing_model: {
      description: "All features are priced in AngelCoin (ANGEL) under the Spec v1.1 Stranded-Balance Geometry. ANGEL is purchased in 2^k + 1 bundles that guarantee exactly 1 stranded ANGEL against any even feature price.",
      rate: "1 ANGEL = $5.00 USD",
      geometry: "2^k + 1 bundles with even feature grid {2, 4, 8, 16, 32} — guarantees exactly 1 stranded ANGEL",
      why: "The 2^k + 1 geometry ensures high value retention while creating a programmatic demand floor anchored to audited Sahel physical commodity reserves.",
    },
    bundles: canonicalBundles,
    features: canonicalFeatures,
    legacy_prime_batches: ANGL_BATCHES.map((b) => ({
      batch_id: b.batch_id,
      angl: b.angl,
      label: b.label,
    })),
    spread: {
      buy_rate: `$${currentP.toFixed(2)} per ANGEL`,
      sell_rate: `$${(currentP * (1 - spreadBps / 10_000)).toFixed(2)} per ANGEL (${(spreadBps / 100).toFixed(1)}% spread)`,
      spread_pct: `${(spreadBps / 100).toFixed(1)}%`,
      note: "The spread funds sovereign infrastructure, local community royalties, and the stabilization reserve.",
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}