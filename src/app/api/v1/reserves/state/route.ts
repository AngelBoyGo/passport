import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { getLiveGovernorAssessment } from "@/lib/reserves/dual-state-governor";
import { getCommoditySpotPrices } from "@/lib/reserves/commodity-oracle";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/state — Dual-State Governor Regime, Volatility Metrics & Multi-Commodity Oracle.
 *
 * Returns:
 * - Current regime: "SOLID" (normal operations) vs. "GHOST" (circuit breaker active)
 * - Bayesian stress belief score [0.0 - 1.0] and active triggers
 * - Multi-commodity spot prices (Gold, Lithium, Neodymium)
 * - Basket valuation, physical carry cost, and solvency ratio
 * - Dynamic transaction damping fee (bps)
 * - Ed25519 cryptographic attestation
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:state:get:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const [assessment, spotPrices] = await Promise.all([
      getLiveGovernorAssessment(),
      Promise.resolve(getCommoditySpotPrices()),
    ]);

    return NextResponse.json(
      {
        success: true,
        regime: assessment.regime,
        belief_score: assessment.beliefScore,
        damping_fee_bps: assessment.dampingFeeBps,
        damping_fee_percent: `${(assessment.dampingFeeBps / 100).toFixed(2)}%`,
        circuit_breaker_active: assessment.circuitBreakerActive,
        revival_eligible: assessment.revivalEligible,
        triggers: assessment.triggers,
        commodities: Object.values(spotPrices).map((p) => ({
          symbol: p.symbol,
          commodity_type: p.commodityType,
          name: p.name,
          unit: p.unit,
          price_usd: p.priceUsd,
          change_24h_percent: p.change24hPercent,
          volatility_30d_percent: p.volatility30dPercent,
          is_stale: p.isStale,
          last_updated: p.lastUpdated,
        })),
        basket_valuation: {
          total_gross_usd: assessment.valuation.totalGrossValueUsd,
          annual_carry_cost_usd: assessment.valuation.annualCarryCostUsd,
          net_reserve_usd: assessment.valuation.netReserveValueUsd,
          backing_ratio: assessment.valuation.solvencyMetrics.backingRatio,
          is_solvent: assessment.valuation.solvencyMetrics.isSolvent,
          reserve_floor_price_usd: assessment.valuation.solvencyMetrics.reserveFloorPriceUsd,
          composition: assessment.valuation.composition,
        },
        evidence: {
          oracle_stale: assessment.evidence.oracleStale,
          max_24h_volatility_percent: assessment.evidence.max24hVolatilityPercent,
          quarantined_batch_count: assessment.evidence.quarantinedBatchCount,
          backing_ratio: assessment.evidence.backingRatio,
        },
        signature: {
          algorithm: assessment.algorithm,
          public_key: assessment.public_key,
          signature: assessment.signature,
        },
        disclaimer:
          "The Dual-State Governor monitors algorithmic stability, physical custody telemetry, and commodity volatility. Ghost regime isolates capital flight without violating physical asset solvency.",
        timestamp: assessment.timestamp,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
