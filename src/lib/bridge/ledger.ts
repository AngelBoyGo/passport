import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/receipt/canonical";
import { computeBalances } from "@/lib/angelcoin/balances";
import { loadJournalEntries } from "@/lib/angelcoin/ledger-service";

/**
 * Bridge <-> AngelCoin ledger support.
 * Deposit mints credits (journal OPERATOR_GRANT); withdrawal burns.
 * Both are idempotent on the existing unique (rail, reference) of
 * ExternalSettlement to survive webhook replays.
 */

const ISSUANCE_RAIL = "bridge_issuance";
const TRANSFER_RAIL = "bridge_transfer";

function ref(prefix: string, bridgeTransferId: string): string {
  return `${prefix}_${bridgeTransferId}`;
}

/** External reference for a withdrawal/burn (rail bridge_transfer). */
export function withdrawalRef(prefix: string, id: string): string {
  return `${prefix}_${id}`;
}

/** A5: idempotently apply a confirmed deposit → mint ANGL credits. */
export async function applyBridgeDeposit(opts: {
  operatorId: string;
  subjectCommitment: string;
  bridgeTransferId: string;
  amount: number; // integer credits (micro-units reserved elsewhere)
}): Promise<{ applied: boolean; reason?: string; transferId?: string }> {
  const reference = ref("bridge", opts.bridgeTransferId);
  try {
    await prisma.$transaction(async (tx) => {
      // Insert-once guard (unique rail+reference).
      await tx.externalSettlement.create({
        data: {
          rail: ISSUANCE_RAIL,
          reference,
          operatorId: opts.operatorId,
          creditCredits: opts.amount,
          label: `angelcoin deposit ${opts.bridgeTransferId}`,
        },
      });
      const account = await tx.angelCoinAccount.upsert({
        where: { subjectCommitment: opts.subjectCommitment },
        create: { subjectCommitment: opts.subjectCommitment, ownerOperatorId: opts.operatorId },
        update: { ownerOperatorId: opts.operatorId },
      });
      await tx.angelCoinJournalEntry.create({
        data: {
          accountId: account.id,
          entryType: "OPERATOR_GRANT",
          amount: opts.amount,
          metadata: JSON.stringify({ rail: ISSUANCE_RAIL, bridgeRef: reference, txHash: null }),
        },
      });
      await tx.capabilityLedgerEntry.create({
        data: {
          operatorId: opts.operatorId,
          eventType: `settlement:${ISSUANCE_RAIL}`,
          metadata: JSON.stringify({ reference, amount: opts.amount }),
        },
      });
    });
    return { applied: true, transferId: reference };
  } catch (err) {
    if (isUniqueViolation(err)) return { applied: false, reason: "Duplicate deposit (already applied)" };
    return { applied: false, reason: err instanceof Error ? err.message : "Deposit failed" };
  }
}

/** A6: idempotently burn + mark payout for a withdrawal. */
export async function burnAndPayout(opts: {
  operatorId: string;
  subjectCommitment: string;
  reference: string;
  amount: number;
}): Promise<{ applied: boolean; reason?: string }> {
  if (!Number.isInteger(opts.amount) || opts.amount <= 0) {
    return { applied: false, reason: "Amount must be a positive integer" };
  }

  // M1: reserve/backing guard — never burn more ANGL than the commitment's
  // available balance (real deposited credits), so no mint-on-paper withdraws.
  const account = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: opts.subjectCommitment },
    select: { id: true, ownerOperatorId: true },
  });
  if (!account) {
    return { applied: false, reason: "No AngelCoin account backing this commitment" };
  }
  const entries = await loadJournalEntries(account.id);
  const available = computeBalances(entries).availableBalance;
  if (available < opts.amount) {
    return { applied: false, reason: "Withdrawal exceeds available (backed) balance" };
  }

  // Explicit duplicate guard (fast fail + used by the A6 test).
  const existing = await prisma.externalSettlement.findFirst({
    where: { rail: TRANSFER_RAIL, reference: opts.reference, operatorId: opts.operatorId },
    select: { id: true },
  });
  if (existing) {
    return { applied: false, reason: "Duplicate burn/payout (already applied)" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.externalSettlement.create({
        data: {
          rail: TRANSFER_RAIL,
          reference: opts.reference,
          operatorId: opts.operatorId,
          creditCredits: opts.amount,
          label: `angelcoin withdrawal ${opts.reference}`,
        },
      });
      const account = await tx.angelCoinAccount.upsert({
        where: { subjectCommitment: opts.subjectCommitment },
        create: { subjectCommitment: opts.subjectCommitment, ownerOperatorId: opts.operatorId },
        update: { ownerOperatorId: opts.operatorId },
      });
      await tx.angelCoinJournalEntry.create({
        data: {
          accountId: account.id,
          entryType: "SPEND",
          amount: opts.amount,
          metadata: JSON.stringify({ rail: TRANSFER_RAIL, bridgeRef: opts.reference }),
        },
      });
      await tx.capabilityLedgerEntry.create({
        data: {
          operatorId: opts.operatorId,
          eventType: `settlement:${TRANSFER_RAIL}`,
          metadata: JSON.stringify({ reference: opts.reference, amount: opts.amount }),
        },
      });
    });
    return { applied: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { applied: false, reason: "Duplicate burn/payout (already applied)" };
    return { applied: false, reason: err instanceof Error ? err.message : "Burn failed" };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

export function bridgeIssuanceRef(bridgeTransferId: string): string {
  return sha256Hex(`bridge_issuance:${bridgeTransferId}`);
}