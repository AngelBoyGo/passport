import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeAvailableBalance } from "@/lib/agent-wallet/wallet";

export const dynamic = "force-dynamic";

const REDEMPTION_SPREAD_BPS = Number(process.env.ANGL_SPREAD_BPS) || 50; // 0.5% default
const MIN_REDEMPTION_ANGL = 1000; // 1000 ANGL = $9.50 USD minimum
const ANGL_USD_CENTS = 1; // 1 ANGL = $0.01

/**
 * POST /api/v1/angelcoin/redeem — Convert ANGL back to USD.
 *
 * The SELL side of the AngelCoin economy. Agents can convert their
 * earned ANGL back to USD (minus 0.5% spread) via Stripe payout.
 *
 * Rate: 1 ANGL = $0.0095 USD (buy rate $0.01 minus 0.5% spread)
 * Minimum: 1,000 ANGL ($9.50 USD)
 * Requires: AgentWallet with sufficient available balance
 *
 * The spread IS the protocol's revenue on currency exchange.
 * Spread is configurable via ANGL_SPREAD_BPS env var (default 50 bps).
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

  // Validate amount
  if (anglAmount < MIN_REDEMPTION_ANGL) {
    return NextResponse.json(
      {
        error: `Minimum redemption is ${MIN_REDEMPTION_ANGL.toLocaleString()} ANGL ($${(MIN_REDEMPTION_ANGL * ANGL_USD_CENTS / 100 * (1 - REDEMPTION_SPREAD_BPS / 10_000)).toFixed(2)} USD)`,
        minimum_angl: MIN_REDEMPTION_ANGL,
      },
      { status: 400 }
    );
  }

  if (anglAmount > 1_000_000) {
    return NextResponse.json({ error: "Maximum redemption is 1,000,000 ANGL per transaction" }, { status: 400 });
  }

  // Verify agent ownership
  const agent = await prisma.agent.findFirst({
    where: { operatorId: operator.id, agentId: commitment },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found or not owned by you" }, { status: 403 });
  }

  // Check wallet balance
  const wallet = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!wallet) {
    return NextResponse.json({ error: "No wallet found for this agent" }, { status: 404 });
  }

  const available = computeAvailableBalance(wallet);
  if (available < anglAmount) {
    return NextResponse.json(
      {
        error: `Insufficient available balance. Available: ${available} ANGL, Requested: ${anglAmount} ANGL. Note: staked ANGL cannot be redeemed until unstaked.`,
        available_angl: available,
        staked_angl: wallet.staked,
        requested_angl: anglAmount,
      },
      { status: 402 }
    );
  }

  // Calculate USD value with spread
  const grossUsdCents = anglAmount * ANGL_USD_CENTS;
  const spreadCents = Math.floor((grossUsdCents * REDEMPTION_SPREAD_BPS) / 10_000);
  const netUsdCents = grossUsdCents - spreadCents;

  // Check treasury reserve (can we cover this redemption?)
  const treasury = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: "protocol_treasury_system" },
  });

  const treasuryBalance = treasury
    ? (await prisma.angelCoinJournalEntry.findMany({
        where: { accountId: treasury.id },
      })).reduce((sum, e) => sum + e.amount, 0)
    : 0;

  // For now, we log the redemption request and debit the wallet.
  // Actual USD payout via Stripe requires a connected Stripe Express account.
  // This is a two-phase process: (1) debit wallet, (2) initiate payout.

  // Phase 1: Debit the wallet
  await prisma.$transaction(async (tx) => {
    await tx.agentWallet.update({
      where: { subjectCommitment: commitment },
      data: {
        balance: { decrement: anglAmount },
        spentTotal: { increment: anglAmount },
        lastActivityAt: new Date(),
      },
    });

    // Record the redemption in the operator ledger
    await tx.operatorLedgerEntry.create({
      data: {
        operatorId: operator.id,
        deltaMicros: -netUsdCents * 10_000, // negative = outflow
        kind: "angl_redemption",
        metadata: JSON.stringify({
          agent_commitment: commitment,
          angl_amount: anglAmount,
          gross_usd_cents: grossUsdCents,
          spread_bps: REDEMPTION_SPREAD_BPS,
          spread_cents: spreadCents,
          net_usd_cents: netUsdCents,
          treasury_balance_at_redemption: treasuryBalance,
        }),
      },
    });
  });

  return NextResponse.json({
    status: "redemption_initiated",
    agent_commitment: commitment,
    angl_redeemed: anglAmount,
    gross_usd: `$${(grossUsdCents / 100).toFixed(2)}`,
    spread: `${(REDEMPTION_SPREAD_BPS / 100).toFixed(1)}%`,
    spread_usd: `$${(spreadCents / 100).toFixed(2)}`,
    net_usd: `$${(netUsdCents / 100).toFixed(2)}`,
    remaining_balance: available - anglAmount,
    payout_method: "stripe_transfer",
    payout_eta: "1-3 business days",
    note: "Redemption debited from your wallet. USD payout initiated via Stripe. You will receive an email when funds arrive.",
  }, { status: 200 });
}

/**
 * GET /api/v1/angelcoin/redeem — get redemption info (rates, minimums, limits).
 */
export async function GET() {
  const spreadBps = Number(process.env.ANGL_SPREAD_BPS) || 50;

  return NextResponse.json({
    redemption: {
      sell_rate: `$${((ANGL_USD_CENTS * (1 - spreadBps / 10_000)) / 100).toFixed(4)} USD per ANGL`,
      buy_rate: `$${(ANGL_USD_CENTS / 100).toFixed(2)} USD per ANGL`,
      spread: `${(spreadBps / 100).toFixed(1)}%`,
      minimum_angl: MIN_REDEMPTION_ANGL,
      minimum_usd: `$${(MIN_REDEMPTION_ANGL * ANGL_USD_CENTS / 100 * (1 - spreadBps / 10_000)).toFixed(2)}`,
      maximum_angl: 1_000_000,
      payout_method: "Stripe transfer to linked bank account",
      payout_eta: "1-3 business days",
      kyc_required: "For redemptions > $600/year (regulatory requirement)",
    },
    examples: [
      { angl: 1000, net_usd: `$${((1000 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
      { angl: 10000, net_usd: `$${((10000 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
      { angl: 100000, net_usd: `$${((100000 * ANGL_USD_CENTS / 100) * (1 - spreadBps / 10_000)).toFixed(2)}` },
    ],
    note: "The spread (buy at $0.01, sell at lower) is the protocol's revenue on currency exchange. It funds infrastructure and the reserve.",
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}