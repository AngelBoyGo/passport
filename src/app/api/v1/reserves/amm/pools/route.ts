import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { listPools } from "@/lib/reserves/fractional-amm";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reserves/amm/pools
 * Returns live liquidity pool reserves, oracle parity deviation, Dual-State Governor
 * regime, and the current fee schedule.
 */
export async function GET(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:amm:pools:${ip}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 120));
  }

  try {
    const pools = await listPools();
    return NextResponse.json(
      {
        success: true,
        pools: pools.map((p) => ({
          pool_id: p.poolId,
          pair_symbol: p.pairSymbol,
          commodity_symbol: p.commoditySymbol,
          angel_reserve: p.angelReserve,
          commodity_reserve: p.commodityReserve,
          spot_price_usd: p.spotPriceUsd,
          effective_price_usd: p.effectivePriceUsd,
          deviation_pct: p.deviationPct,
          regime: p.regime,
          fee_bps: p.feeBps,
          version: p.version,
          status: p.status,
        })),
        max_oracle_deviation_pct: 5.0,
        timestamp: new Date().toISOString(),
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