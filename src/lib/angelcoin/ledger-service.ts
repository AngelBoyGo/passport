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
 * H5: the operator who first touches a subject claims ownership of the account
 * (`ownerOperatorId`), so later transfers can be attribution-checked.
 */
export async function getOrCreateAccount(subjectCommitment: string, ownerOperatorId?: string) {
  assertValidSubjectCommitment(subjectCommitment);

  return prisma.angelCoinAccount.upsert({
    where: { subjectCommitment },
    create: {
      subjectCommitment,
      creditState: AngelCoinCreditState.ACTIVE,
      ownerOperatorId: ownerOperatorId ?? null,
    },
    update: {},
  });
}

/**
 * H5: verifies the authenticated operator owns (created) the subject account.
 * Executive admins may act on the system account. Returns true when allowed.
 */
export async function assertCanTransferFrom(
  operatorId: string,
  fromCommitment: string,
  executiveAdmin: boolean
): Promise<boolean> {
  if (executiveAdmin) return true;
  const account = await prisma.angelCoinAccount.findUnique({
    where: { subjectCommitment: fromCommitment },
    select: { ownerOperatorId: true },
  });
  if (!account) return false; // can't send from an account that doesn't exist
  if (account.ownerOperatorId && account.ownerOperatorId !== operatorId) return false;
  if (!account.ownerOperatorId) return false;
  return true;
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
 * Releases locked escrow to a worker in one atomic transaction.
 * Hard gate: locked balance must cover amount before UNLOCK + SPEND + TASK_PAYMENT.
 */
export async function releaseEscrowToWorker(
  hirerCommitment: string,
  workerCommitment: string,
  amount: number,
  metadata?: string
) {
  assertValidSubjectCommitment(hirerCommitment);
  assertValidSubjectCommitment(workerCommitment);
  if (amount <= 0) {
    throw new InvalidAngelCoinAmountError();
  }
  if (hirerCommitment === workerCommitment) {
    throw new InvalidAngelCoinAmountError(
      "Cannot release escrow to the same account"
    );
  }

  await assertEnrollmentIfRequired(hirerCommitment);

  return prisma.$transaction(async (tx) => {
    const sender = await tx.angelCoinAccount.upsert({
      where: { subjectCommitment: hirerCommitment },
      create: { subjectCommitment: hirerCommitment },
      update: {},
    });
    const receiver = await tx.angelCoinAccount.upsert({
      where: { subjectCommitment: workerCommitment },
      create: { subjectCommitment: workerCommitment },
      update: {},
    });

    await lockAccountForUpdate(tx, sender.id);

    const senderEntries = await loadJournalEntries(sender.id, tx);
    const senderBalances = computeBalances(senderEntries);
    if (senderBalances.lockedBalance < amount) {
      throw new InsufficientAngelCoinFundsError(
        "Insufficient locked escrow balance"
      );
    }

    const unlockEntry = await appendEntry(
      tx,
      sender.id,
      AngelCoinEntryType.UNLOCK,
      amount,
      { metadata }
    );

    const afterUnlockEntries = await loadJournalEntries(sender.id, tx);
    const afterUnlockBalances = computeBalances(afterUnlockEntries);
    if (afterUnlockBalances.availableBalance < amount) {
      throw new InsufficientAngelCoinFundsError();
    }

    const spendEntry = await appendEntry(
      tx,
      sender.id,
      AngelCoinEntryType.SPEND,
      amount,
      { counterpartyCommitment: workerCommitment, metadata }
    );
    const paymentEntry = await appendEntry(
      tx,
      receiver.id,
      AngelCoinEntryType.TASK_PAYMENT,
      amount,
      { counterpartyCommitment: hirerCommitment, metadata }
    );

    const finalSenderEntries = await loadJournalEntries(sender.id, tx);
    return {
      sender,
      receiver,
      unlockEntry,
      spendEntry,
      paymentEntry,
      balances: computeBalances(finalSenderEntries),
    };
  });
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
