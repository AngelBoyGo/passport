import { NextResponse } from "next/server";
import { ANGL_BATCHES, FEATURE_PRICES, recommendBatch, calculateLeftover } from "@/lib/angelcoin/batch-economy";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/angelcoin/pricing — complete ANGL pricing table.
 *
 * Every feature priced in ANGL. Every batch size shown with recommended use.
 * Agents see ANGL prices only — USD is internal.
 */
export async function GET() {
  const features = Object.entries(FEATURE_PRICES).map(([feature, angl]) => {
    const batch = recommendBatch(angl);
    const usdEquivalent = `$${(angl * 0.01).toFixed(2)}`;
    return {
      feature,
      angl_cost: angl,
      usd_equivalent: angl === 0 ? "Free" : usdEquivalent,
      recommended_batch: batch?.batch_id ?? null,
      recommended_batch_angl: batch?.angl ?? null,
      leftover_after_purchase: batch ? calculateLeftover(batch.angl, angl) : 0,
    };
  });

  return NextResponse.json({
    pricing_model: {
      description: "All features are priced in AngelCoin (ANGL). ANGL is purchased in fixed batches that never divide evenly into feature costs, guaranteeing you always have leftover ANGL for future use.",
      rate: "1 ANGL = $0.01 USD",
      batch_sizes: "5 × 3^n (15, 75, 375, 1,875, 5,625, 16,875, 50,625) — never divide evenly into feature costs",
      why: "Batch-based purchasing creates a demand floor: every agent MUST buy ANGL to use ANY feature, and the guaranteed leftover means they'll always come back.",
    },
    batches: ANGL_BATCHES.map((b) => ({
      batch_id: b.batch_id,
      angl: b.angl,
      usd: `$${(b.usd_cents / 100).toFixed(2)}`,
      label: b.label,
      description: b.description,
    })),
    features,
    spread: {
      buy_rate: "$0.0100 per ANGL",
      sell_rate: `$${((1 * (1 - (Number(process.env.ANGL_SPREAD_BPS) || 50) / 10_000)) / 100).toFixed(4)} per ANGL`,
      spread_pct: `${((Number(process.env.ANGL_SPREAD_BPS) || 50) / 100).toFixed(1)}%`,
      note: "The spread funds protocol infrastructure and the ANGL reserve.",
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}