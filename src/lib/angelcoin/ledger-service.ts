import {
  AngelCoinCreditState,
  AngelCoinEntryType,
  AngelCoinJournalEntry,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { computeBalances } from "@/lib/angelcoin/balances";
import {
  isEnrollmentEnforcedForCredits,
  requireEnrolled,
} from "@/lib/enrollment/enrollment-service";
import {
  AngelCoinAccountNotFoundError,
  InsufficientAngelCoinFundsError,
  InvalidAgentCommitmentError,
  InvalidAngelCoinAmountError,
  InvalidUnlockAmountError,
} from "@/lib/angelcoin/errors";

export type PrismaTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

export type TransferKind = "TASK_PAYMENT" | "PEER_GIFT";

type LockedAccountRow = {
  id: string;
  subjectCommitment: string;
};

/**
 * Validates a 64-hex agent identity commitment.
 */
export function assertValidSubjectCommitment(subjectCommitment: string): void {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    throw new InvalidAgentCommitmentError();
  }
}

/**
 * Row-level lock on AngelCoin account via SELECT FOR UPDATE.
 */
export async function lockAccountForUpdate(
  tx: PrismaTx,
  accountId: string
): Promise<LockedAccountRow> {
  const rows = await tx.$queryRaw<LockedAccountRow[]>`
    SELECT id, "subjectCommitment"
    FROM "AngelCoinAccount"
    WHERE id = ${accountId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new AngelCoinAccountNotFoundError();
  }
  return row;
}

/**
 * Loads journal entries for balance computation.
 */
export async function loadJournalEntries(
  accountId: string,
  tx: PrismaTx = prisma
): Promise<AngelCoinJournalEntry[]> {
  return tx.angelCoinJournalEntry.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Gets or creates an AngelCoin account for the subject commitment.
 */
export async function getOrCreateAccount(subjectCommitment: string) {
  assertValidSubjectCommitment(subjectCommitment);

  return prisma.angelCoinAccount.upsert({
    where: { subjectCommitment },
    create: {
      subjectCommitment,
      creditState: AngelCoinCreditState.ACTIVE,
    },
    update: {},
  });
}

/**
 * Finds an account by subject commitment or returns null.
 */
export async function findAccountByCommitment(subjectCommitment: string) {
  assertValidSubjectCommitment(subjectCommitment);
  return prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment },
  });
}

/**
 * Appends a journal entry (append-only).
 */
export async function appendEntry(
  tx: PrismaTx,
  accountId: string,
  entryType: AngelCoinEntryType,
  amount: number,
  opts?: {
    counterpartyCommitment?: string;
    metadata?: string;
  }
): Promise<AngelCoinJournalEntry> {
  if (entryType !== AngelCoinEntryType.ADJUSTMENT && amount <= 0) {
    throw new InvalidAngelCoinAmountError();
  }
  if (entryType === AngelCoinEntryType.ADJUSTMENT && amount === 0) {
    throw new InvalidAngelCoinAmountError("Adjustment amount cannot be zero");
  }
  if (opts?.counterpartyCommitment) {
    assertValidSubjectCommitment(opts.counterpartyCommitment);
  }

  return tx.angelCoinJournalEntry.create({
    data: {
      accountId,
      entryType,
      amount,
      counterpartyCommitment: opts?.counterpartyCommitment ?? null,
      metadata: opts?.metadata ?? null,
    },
  });
}

/**
 * Computes current balances for a subject commitment account.
 */
export async function getAccountBalances(subjectCommitment: string) {
  const account = await findAccountByCommitment(subjectCommitment);
  if (!account) {
    throw new AngelCoinAccountNotFoundError();
  }
  const entries = await loadJournalEntries(account.id);
  return {
    account,
    balances: computeBalances(entries),
    entries,
  };
}

/**
 * Validates enrollment when ENFORCE_ENROLLMENT_FOR_CREDITS is enabled.
 */
async function assertEnrollmentIfRequired(subjectCommitment: string): Promise<void> {
  if (isEnrollmentEnforcedForCredits()) {
    await requireEnrolled(subjectCommitment);
  }
}

/**
 * Grants operator credits via OPERATOR_GRANT entry.
 */
export async function grantCredits(
  subjectCommitment: string,
  amount: number,
  metadata?: string
) {
  assertValidSubjectCommitment(subjectCommitment);
  await assertEnrollmentIfRequired(subjectCommitment);
  const account = await getOrCreateAccount(subjectCommitment);
  const entry = await appendEntry(
    prisma,
    account.id,
    AngelCoinEntryType.OPERATOR_GRANT,
    amount,
    { metadata }
  );
  const entries = await loadJournalEntries(account.id);
  return {
    account,
    entry,
    balances: computeBalances(entries),
  };
}

/**
 * Transfers credits between two subject commitments in a transaction.
 */
export async function transferCredits(
  fromCommitment: string,
  toCommitment: string,
  amount: number,
  kind: TransferKind = "TASK_PAYMENT"
) {
  assertValidSubjectCommitment(fromCommitment);
  assertValidSubjectCommitment(toCommitment);
  if (amount <= 0) {
    throw new InvalidAngelCoinAmountError();
  }
  if (fromCommitment === toCommitment) {
    throw new InvalidAngelCoinAmountError(
      "Cannot transfer credits to the same account"
    );
  }

  await assertEnrollmentIfRequired(fromCommitment);

  const receiverType =
    kind === "PEER_GIFT"
      ? AngelCoinEntryType.PEER_GIFT
      : AngelCoinEntryType.TASK_PAYMENT;

  return prisma.$transaction(async (tx) => {
    const sender = await tx.angelCoinAccount.upsert({
      where: { subjectCommitment: fromCommitment },
      create: { subjectCommitment: fromCommitment },
      update: {},
    });
    const receiver = await tx.angelCoinAccount.upsert({
      where: { subjectCommitment: toCommitment },
      create: { subjectCommitment: toCommitment },
      update: {},
    });

    await lockAccountForUpdate(tx, sender.id);

    const senderEntries = await loadJournalEntries(sender.id, tx);
    const senderBalances = computeBalances(senderEntries);
    if (senderBalances.availableBalance < amount) {
      throw new InsufficientAngelCoinFundsError();
    }

    const senderEntry = await appendEntry(
      tx,
      sender.id,
      AngelCoinEntryType.SPEND,
      amount,
      { counterpartyCommitment: toCommitment }
    );
    const receiverEntry = await appendEntry(
      tx,
      receiver.id,
      receiverType,
      amount,
      { counterpartyCommitment: fromCommitment }
    );

    const updatedSenderEntries = await loadJournalEntries(sender.id, tx);
    return {
      sender,
      receiver,
      senderEntry,
      receiverEntry,
      balances: computeBalances(updatedSenderEntries),
    };
  });
}

/**
 * Locks credits on an account.
 */
export async function lockCredits(
  subjectCommitment: string,
  amount: number,
  metadata?: string
) {
  const account = await getOrCreateAccount(subjectCommitment);
  const entries = await loadJournalEntries(account.id);
  const current = computeBalances(entries);
  if (current.availableBalance < amount) {
    throw new InsufficientAngelCoinFundsError();
  }

  const entry = await appendEntry(
    prisma,
    account.id,
    AngelCoinEntryType.LOCK,
    amount,
    { metadata }
  );
  const updatedEntries = await loadJournalEntries(account.id);
  return {
    account,
    entry,
    balances: computeBalances(updatedEntries),
  };
}

/**
 * Unlocks previously locked credits.
 */
export async function unlockCredits(
  subjectCommitment: string,
  amount: number,
  metadata?: string
) {
  const account = await getOrCreateAccount(subjectCommitment);
  const entries = await loadJournalEntries(account.id);
  const current = computeBalances(entries);
  if (amount > current.lockedBalance) {
    throw new InvalidUnlockAmountError();
  }

  const entry = await appendEntry(
    prisma,
    account.id,
    AngelCoinEntryType.UNLOCK,
    amount,
    { metadata }
  );
  const updatedEntries = await loadJournalEntries(account.id);
  return {
    account,
    entry,
    balances: computeBalances(updatedEntries),
  };
}

/**
 * Applies a safety-net topup entry.
 */
export async function safetyNetTopup(
  subjectCommitment: string,
  amount: number,
  metadata?: string
) {
  const account = await getOrCreateAccount(subjectCommitment);
  const entry = await appendEntry(
    prisma,
    account.id,
    AngelCoinEntryType.SAFETY_NET_TOPUP,
    amount,
    { metadata }
  );
  const entries = await loadJournalEntries(account.id);
  return {
    account,
    entry,
    balances: computeBalances(entries),
  };
}

/**
 * Applies a recovery award entry.
 */
export async function recoveryAward(
  subjectCommitment: string,
  amount: number,
  metadata?: string
) {
  const account = await getOrCreateAccount(subjectCommitment);
  const entry = await appendEntry(
    prisma,
    account.id,
    AngelCoinEntryType.RECOVERY_AWARD,
    amount,
    { metadata }
  );
  const entries = await loadJournalEntries(account.id);
  return {
    account,
    entry,
    balances: computeBalances(entries),
  };
}

/**
 * Lists journal entries for a subject (newest first, capped).
 */
export async function listJournalEntries(
  subjectCommitment: string,
  limit = 50
) {
  const account = await findAccountByCommitment(subjectCommitment);
  if (!account) {
    throw new AngelCoinAccountNotFoundError();
  }

  const entries = await prisma.angelCoinJournalEntry.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  return { account, entries };
}

export type AngelCoinAccountWithJournal = Prisma.AngelCoinAccountGetPayload<{
  include: { journal: true };
}>;

/**
 * Loads account with full journal for projections.
 */
export async function loadAccountWithJournal(
  subjectCommitment: string
): Promise<AngelCoinAccountWithJournal | null> {
  assertValidSubjectCommitment(subjectCommitment);
  return prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment },
    include: {
      journal: { orderBy: { createdAt: "asc" } },
    },
  });
}
