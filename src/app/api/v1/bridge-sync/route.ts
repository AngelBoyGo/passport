import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { AngelCoinEntryType, AngelCoinCreditState } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/bridge-sync
 *
 * Metis Priority #5: Bridges AgentWallet ↔ AngelCoinAccount.
 *
 * Every time an AgentWallet balance changes (deposit, transfer, stake),
 * this endpoint syncs the change to the corresponding AngelCoinAccount
 * journal entry. This resolves the dual-ledger architectural debt.
 *
 * Direction: AgentWallet → AngelCoinAccount (one-way sync).
 * The AngelCoinAccount is the canonical reputation-linked balance.
 * The AgentWallet is the liberated agent-controlled wallet.
 *
 * This endpoint is also called internally by the agent-wallet route
 * after every successful mutation.
 *
 * Auth: ISSUER key or SCHEDULER_SECRET.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`bridge-sync:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  const schedulerSecret = process.env.SCHEDULER_SECRET;
  const isScheduler = schedulerSecret && request.headers.get("x-scheduler-secret") === schedulerSecret;

  if (!isScheduler && (!operator || operator.apiKeyRole !== "ISSUER")) {
    return NextResponse.json({ error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required" }, { status: 401 });
  }

  let body: {
    subject_commitment?: string;
    direction?: "wallet_to_ledger" | "ledger_to_wallet" | "full_sync";
  };

  try {
    body = await request.json();
  } catch {
    body = { direction: "full_sync" };
  }

  const direction = body.direction || "full_sync";

  if (direction === "wallet_to_ledger" && body.subject_commitment) {
    const result = await syncWalletToLedger(body.subject_commitment);
    return NextResponse.json(result);
  }

  if (direction === "ledger_to_wallet" && body.subject_commitment) {
    const result = await syncLedgerToWallet(body.subject_commitment);
    return NextResponse.json(result);
  }

  // Full sync: process all agents with wallet activity
  const wallets = await prisma.agentWallet.findMany({
    where: { lastActivityAt: { not: null } },
    orderBy: { lastActivityAt: "desc" },
    take: 100,
  });

  const results = [];
  for (const wallet of wallets) {
    try {
      const result = await syncWalletToLedger(wallet.subjectCommitment);
      results.push(result);
    } catch (err) {
      results.push({
        subject_commitment: wallet.subjectCommitment,
        synced: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
    }
  }

  return NextResponse.json({
    direction: "full_sync",
    wallets_processed: results.length,
    synced: results.filter((r) => r.synced).length,
    skipped: results.filter((r) => !r.synced).length,
    results,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Syncs AgentWallet balance → AngelCoinAccount journal entry.
 * Creates an ADJUSTMENT entry if the balances diverge.
 */
async function syncWalletToLedger(commitment: string) {
  const wallet = await prisma.agentWallet.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!wallet) {
    return { subject_commitment: commitment, synced: false, reason: "No wallet found" };
  }

  // Get or create the AngelCoinAccount
  let account = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!account) {
    account = await prisma.angelCoinAccount.create({
      data: {
        subjectCommitment: commitment,
        creditState: AngelCoinCreditState.ACTIVE,
      },
    });
  }

  // Compute the current ledger balance
  const entries = await prisma.angelCoinJournalEntry.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
  });

  const ledgerBalance = entries.reduce((sum, e) => sum + e.amount, 0);
  const walletBalance = wallet.balance;
  const delta = walletBalance - ledgerBalance;

  if (delta === 0) {
    return {
      subject_commitment: commitment,
      synced: true,
      reason: "Already in sync",
      wallet_balance: walletBalance,
      ledger_balance: ledgerBalance,
    };
  }

  // Create an adjustment entry to align the ledgers
  await prisma.angelCoinJournalEntry.create({
    data: {
      accountId: account.id,
      entryType: AngelCoinEntryType.ADJUSTMENT,
      amount: delta,
      metadata: JSON.stringify({
        source: "bridge-sync",
        wallet_balance: walletBalance,
        ledger_balance_before: ledgerBalance,
        direction: "wallet_to_ledger",
      }),
    },
  });

  return {
    subject_commitment: commitment,
    synced: true,
    adjustment: delta,
    wallet_balance: walletBalance,
    ledger_balance_before: ledgerBalance,
    ledger_balance_after: ledgerBalance + delta,
  };
}

/**
 * Syncs AngelCoinAccount balance → AgentWallet.
 * Updates the wallet balance to match the ledger.
 */
async function syncLedgerToWallet(commitment: string) {
  const account = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: commitment },
  });

  if (!account) {
    return { subject_commitment: commitment, synced: false, reason: "No ledger account found" };
  }

  const entries = await prisma.angelCoinJournalEntry.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "asc" },
  });

  const ledgerBalance = entries.reduce((sum, e) => sum + e.amount, 0);

  const wallet = await prisma.agentWallet.upsert({
    where: { subjectCommitment: commitment },
    create: {
      subjectCommitment: commitment,
      balance: Math.max(0, ledgerBalance),
      earnedTotal: Math.max(0, ledgerBalance),
      lastActivityAt: new Date(),
    },
    update: {
      balance: Math.max(0, ledgerBalance),
      lastActivityAt: new Date(),
    },
  });

  return {
    subject_commitment: commitment,
    synced: true,
    ledger_balance: ledgerBalance,
    wallet_balance: wallet.balance,
  };
}