import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authorizeAgentCommitment } from "@/lib/auth/agent-ownership";
import { executePoolSwap, type SwapInput } from "@/lib/reserves/fractional-amm";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/reserves/amm/swap
 * Executes an oracle-guarded constant-product swap between ANGEL and fractional
 * commodity milli-units (mAu / gLi) under the Dual-State Governor fee interlock.
 *
 * AUTHORIZATION: the swap debits the named agent's wallet, so the caller must prove it owns
 * that commitment (HOLDER) or hold an ISSUER key. Without this, anyone who knows a public
 * commitment could move that agent's funds.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`reserves:amm:swap:${ip}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const poolId = String(body.pool_id || body.poolId || "");
  const agentCommitment = String(body.agent_commitment || body.agentCommitment || "");
  const inputToken = String(body.input_token || body.inputToken || "").toUpperCase();
  const inputAmount = Number(body.input_amount ?? body.inputAmount);

  if (
    !poolId ||
    !agentCommitment ||
    !["ANGEL", "MAU", "GLI"].includes(inputToken) ||
    !Number.isFinite(inputAmount) ||
    inputAmount <= 0
  ) {
    return NextResponse.json(
      { error: "pool_id, agent_commitment, input_token (ANGEL|MAU|GLI), and input_amount are required" },
      { status: 400 }
    );
  }

  const auth = await authorizeAgentCommitment(request, agentCommitment);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  try {
    const result = await executePoolSwap({
      poolId,
      agentCommitment,
      inputToken: inputToken as SwapInput["inputToken"],
      inputAmount,
    });

    return NextResponse.json(
      {
        success: true,
        swap_id: result.receipt.swapId,
        pool_id: result.poolId,
        agent_commitment: result.receipt.agentCommitment,
        input_token: result.inputToken,
        input_amount: result.inputAmount,
        output_token: result.outputToken,
        output_amount: result.outputAmount,
        fee_angel: result.feeAngel,
        regime: result.regime,
        effective_price_usd: result.effectivePriceUsd,
        deviation_pct: result.deviationPct,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}