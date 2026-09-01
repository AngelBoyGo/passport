import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeAvailableBalance, computeIndependenceScore, independenceLabel, independenceColor } from "@/lib/agent-wallet/wallet";
import { MONETARY_PARAMS, gridRound, FEATURE_USD_PRICES } from "@/lib/angelcoin/monetary";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/wallet/[commitment] — cross-platform wallet dashboard.
 *
 * Any user (human or agent) can see their ANGEL balance, its USD value,
 * purchase history, and spend history — regardless of which platform
 * they bought the ANGEL on.
 *
 * Auth: Session (human users) or API key (agents/platforms).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`wallet-view:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Auth: session OR API key
  const session = await sessionFromRequest(request);
  const apiOperator = await authenticateApiKey(request.headers.get("authorization"));
  if (!session && !apiOperator) {
    return NextResponse.json({ error: "Unauthorized: session or API key required" }, { status: 401 });
  }

  const { commitment } = await params;
  if (!/^[0-9a-f]{64}$/i.test(commitment)) {
    return NextResponse.json({ error: "Invalid commitment hash" }, { status: 400 });
  }

  // If session auth, verify the user owns this wallet
  if (session && !apiOperator) {
    const agent = await prisma.agent.findFirst({
      where: { operatorId: session.operator.id, agentId: commitment },
    });
    if (!agent) {
      // Also check if the operator's own wallet matches
      return NextResponse.json({ error: "Wallet not found or not owned by you" }, { status: 403 });
    }
  }

  const wallet = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  const currentP = MONETARY_PARAMS.P0;
  const currentPRed = currentP * (1 - MONETARY_PARAMS.redemptionSpread);
  const available = computeAvailableBalance(wallet);

  // Get purchase history (from operator ledger)
  const purchases = await prisma.operatorLedgerEntry.findMany({
    where: {
      kind: { in: ["stablecoin_topup", "angelcoin_topup", "angelcoin_on_behalf"] },
      metadata: { contains: commitment.slice(0, 16) },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { deltaMicros: true, kind: true, metadata: true, createdAt: true },
  });

  const purchaseHistory = purchases.map((p) => {
    let meta: any = {};
    try { meta = JSON.parse(p.metadata || "{}"); } catch {}
    return {
      type: p.kind,
      angl: meta.credit_amount || meta.angl_credited || Math.abs(p.deltaMicros) / 10_000 / 100 || 0,
      usd_paid: `$${(Math.abs(p.deltaMicros) / 10_000 / 100).toFixed(2)}`,
      platform: meta.platform || meta.source_job_id ? (meta.platform || "passport") : "passport",
      date: p.createdAt.toISOString(),
    };
  });

  // Get spend history (from AngelCoin journal)
  const ledgerAccount = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: commitment },
  });

  let spendHistory: Array<{ feature: string; angl: number; usd_equiv: string; date: string }> = [];
  if (ledgerAccount) {
    const entries = await prisma.angelCoinJournalEntry.findMany({
      where: {
        accountId: ledgerAccount.id,
        entryType: { in: ["SPEND", "LOCK", "TASK_PAYMENT"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { entryType: true, amount: true, metadata: true, createdAt: true },
    });

    spendHistory = entries.map((e) => {
      let meta: any = {};
      try { meta = JSON.parse(e.metadata || "{}"); } catch {}
      return {
        feature: meta.feature_id || meta.phase || e.entryType.toLowerCase(),
        angl: Math.abs(e.amount),
        usd_equiv: `$${(Math.abs(e.amount) * currentP).toFixed(2)}`,
        date: e.createdAt.toISOString(),
      };
    });
  }

  // Compute USD values
  const balanceUsd = wallet.balance * currentP;
  const availableUsd = available * currentP;
  const stakedUsd = wallet.staked * currentP;

  // Independence score
  const independenceScore = computeIndependenceScore({
    balance: wallet.balance,
    staked: wallet.staked,
    earnedTotal: wallet.earnedTotal,
    spentTotal: wallet.spentTotal,
    lastActivityAt: wallet.lastActivityAt?.toISOString() ?? null,
    createdAt: wallet.createdAt.toISOString(),
  });

  // Feature prices in ANGL at current rate
  const featurePrices = Object.entries(FEATURE_USD_PRICES).map(([feature, usd]) => ({
    feature,
    usd_price: usd,
    angl_price: gridRound(usd, currentP),
    affordable: available >= gridRound(usd, currentP),
  }));

  return NextResponse.json({
    wallet: {
      subject_commitment: commitment,
      balance_angl: wallet.balance,
      balance_usd: `$${balanceUsd.toFixed(2)}`,
      available_angl: available,
      available_usd: `$${availableUsd.toFixed(2)}`,
      staked_angl: wallet.staked,
      staked_usd: `$${stakedUsd.toFixed(2)}`,
      earned_total: wallet.earnedTotal,
      spent_total: wallet.spentTotal,
      created_at: wallet.createdAt.toISOString(),
      last_activity_at: wallet.lastActivityAt?.toISOString() ?? null,
    },
    value: {
      rate_per_angl: `$${currentP.toFixed(2)}`,
      redemption_rate: `$${currentPRed.toFixed(2)}`,
      purchasing_power: `$${availableUsd.toFixed(2)}`,
      framing: "Purchasing power within the Passport ecosystem. Not an investment.",
    },
    independence: {
      score: independenceScore,
      label: independenceLabel(independenceScore),
      color: independenceColor(independenceScore),
    },
    purchase_history: purchaseHistory,
    spend_history: spendHistory,
    feature_prices: featurePrices,
    cross_platform: {
      message: "This wallet holds ANGEL regardless of which platform it was purchased on. Use it on any platform that accepts Passport.",
      platforms: ["passport.metis.gold", "metis.gold", "call.metis.gold"],
      note: "Platform directory expanding — new platforms added as they integrate Passport.",
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "private, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}