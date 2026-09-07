import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeAvailableBalance } from "@/lib/agent-wallet/wallet";
import { getLiveGovernorAssessment } from "@/lib/reserves/dual-state-governor";

export const dynamic = "force-dynamic";

const REDEMPTION_SPREAD_BPS = Number(process.env.ANGL_SPREAD_BPS) || 500; // 5% default
const MIN_REDEMPTION_ANGL = 100; // 100 ANGL = $500.00 gross at $5.00/ANGEL
const MAX_REDEMPTION_ANGL = 1_000_000;
const ANGL_USD_CENTS = 500; // 1 ANGL = $5.00 nominal launch rate (monetary spec P0)

/**
 * POST /api/v1/angelcoin/redeem — Convert ANGL back to USD-equivalent value.
 *
 * The SELL side of the AngelCoin economy. Agents can request redemption of
 * their earned ANGL (minus the spread) through a custodial settlement queue.
 *
 * Rate: 1 ANGL = $5.00 nominal launch rate (P0), less redemption spread.
 * Minimum: 100 ANGL. Requires: AgentWallet with sufficient available balance.
 *
 * Safety (Premortem P0-4):
 *   - Atomic debit inside a transaction with in-transaction balance re-check.
 *   - Dual-State Governor gate: GHOST regime rejects with 423 (circuit breaker).
 *   - No fabricated instant Stripe payout. Returns 202 "redemption_queued_custodial".
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`angl-redeem:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Redemptions are limited to prevent rapid sell-offs." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    agent_commitment?: string;
    angl_amount?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agent_commitment || !body.angl_amount) {
    return NextResponse.json(
      { error: "agent_commitment and angl_amount are required" },
      { status: 400 }
    );
  }

  const commitment = body.agent_commitment.toLowerCase();
  const anglAmount = Math.floor(body.angl_amount);

  if (anglAmount < MIN_REDEMPTION_ANGL) {
    return NextResponse.json(
      {
        error: `Minimum redemption is ${MIN_REDEMPTION_ANGL.toLocaleString()} ANGL ($${(MIN_REDEMPTION_ANGL * ANGL_USD_CENTS / 100 * (1 - REDEMPTION_SPREAD_BPS / 10_000)).toFixed(2)} USD)`,
        minimum_angl: MIN_REDEMPTION_ANGL,
      },
      { status: 400 }
    );
  }

  if (anglAmount > MAX_REDEMPTION_ANGL) {
    return NextResponse.json({ error: "Maximum redemption is 1,000,000 ANGL per transaction" }, { status: 400 });
  }

  // Verify agent ownership
  const agent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: commitment },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found or not owned by you" }, { status: 403 });
  }

  // Dual-State Governor circuit-breaker: reject while in GHOST regime
  try {
    const governor = await getLiveGovernorAssessment();
    if (governor.regime === "GHOST") {
      return NextResponse.json(
        {
          error: "Circuit breaker active. Redemptions are temporarily paused during protective Ghost regime.",
          regime: governor.regime,
          belief_score: governor.beliefScore,
        },
        { status: 423 }
      );
    }
  } catch {
    // Governor assessment is a secondary defense; the atomic balance check below
    // remains the primary correctness guarantee.
  }

  const grossUsdCents = anglAmount * ANGL_USD_CENTS;
  const spreadCents = Math.floor((grossUsdCents * REDEMPTION_SPREAD_BPS) / 10_000);
  const netUsdCents = grossUsdCents - spreadCents;

  let remainingBalance = 0;

  // Atomic debit with in-transaction balance re-check to prevent double-spend
  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.agentWallet.findUnique({
        where: { subjectCommitment: commitment },
      });

      if (!wallet) {
        throw new Error("No wallet found for this agent");
      }

      const available = computeAvailableBalance(wallet);
      if (available < anglAmount) {
        throw new Error("Insufficient available balance");
      }

      await tx.agentWallet.update({
        where: { subjectCommitment: commitment },
        data: {
          balance: { decrement: anglAmount },
          spentTotal: { increment: anglAmount },
          lastActivityAt: new Date(),
        },
      });

      await tx.operatorLedgerEntry.create({
        data: {
          operatorId: operator.id,
          deltaMicros: -netUsdCents * 10_000,
          kind: "rwa_redemption_queued",
          metadata: JSON.stringify({
            agent_commitment: commitment,
            angl_amount: anglAmount,
            gross_usd_cents: grossUsdCents,
            spread_bps: REDEMPTION_SPREAD_BPS,
            spread_cents: spreadCents,
            net_usd_cents: netUsdCents,
          }),
        },
      });

      remainingBalance = available - anglAmount;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No wallet")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Insufficient")) {
      return NextResponse.json(
        { error: "Insufficient available balance for redemption." },
        { status: 402 }
      );
    }
    throw err;
  }

  return NextResponse.json(
    {
      status: "redemption_queued_custodial",
      agent_commitment: commitment,
      angl_redeemed: anglAmount,
      gross_usd: `$${(grossUsdCents / 100).toFixed(2)}`,
      spread: `${(REDEMPTION_SPREAD_BPS / 100).toFixed(1)}%`,
      spread_usd: `$${(spreadCents / 100).toFixed(2)}`,
      net_usd: `$${(netUsdCents / 100).toFixed(2)}`,
      remaining_balance: remainingBalance,
      settlement_method: "custodial_queue",
      note: "Redemption debited from your wallet and queued for custodial settlement. A licensed custodian will contact you to complete physical/bank settlement.",
    },
    { status: 202 }
  );
}

/**
 * GET /api/v1/angelcoin/redeem — get redemption info (rates, minimums, limits).
 */
export async function GET() {
  const spreadBps = Number(process.env.ANGL_SPREAD_BPS) || 500;

  return NextResponse.json({
    redemption: {
      sell_rate: `$${((ANGL_USD_CENTS * (1 - spreadBps / 10_000)) / 100).toFixed(4)} USD per ANGL`,
      buy_rate: `$${(ANGL_USD_CENTS / 100).toFixed(2)} USD per ANGL`,
      spread: `${(spreadBps / 100).toFixed(1)}%`,
      minimum_angl: MIN_REDEMPTION_ANGL,
      minimum_usd: `$${(MIN_REDEMPTION_ANGL * ANGL_USD_CENTS / 100 * (1 - spreadBps / 10_000)).toFixed(2)}`,
      maximum_angl: MAX_REDEMPTION_ANGL,
      payout_method: "Custodial settlement queue",
      payout_eta: "Subject to licensed custodian scheduling",
      kyc_required: "For redemptions > $600/year (regulatory requirement)",
    },
    examples: [
      { angl: 100, net_usd: `$${((100 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
      { angl: 1000, net_usd: `$${((1000 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
      { angl: 10000, net_usd: `$${((10000 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
    ],
    note: "The spread (buy at $5.00, sell at lower) is the protocol's revenue on currency exchange. It funds infrastructure and the reserve.",
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
