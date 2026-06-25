import type { Prisma } from "@prisma/client";
import { ErrorTranche, OperatorAccountStatus } from "@prisma/client";
import { getPenaltyForTranche } from "./penalties";

export type PrismaTx = Prisma.TransactionClient;

export interface LockedOperatorRow {
  id: string;
  stakeBalanceCents: number;
  accountStatus: OperatorAccountStatus;
}

export interface SlashingResult {
  deductedCents: number;
  fullPenaltyCents: number;
  insolvent: boolean;
  ledgerEntryId?: string;
}

/**
 * Row-level lock on operator stake balance via SELECT FOR UPDATE.
 */
export async function lockOperatorForUpdate(
  tx: PrismaTx,
  operatorId: string
): Promise<LockedOperatorRow> {
  const rows = await tx.$queryRaw<LockedOperatorRow[]>`
    SELECT id, "stakeBalanceCents", "accountStatus"
    FROM "Operator"
    WHERE id = ${operatorId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Operator not found");
  }
  return row;
}

/**
 * Applies variable liability slashing inside an open transaction.
 */
export async function applySlashingInTransaction(
  tx: PrismaTx,
  operatorId: string,
  receiptId: string,
  tranche: ErrorTranche
): Promise<SlashingResult> {
  const fullPenaltyCents = getPenaltyForTranche(tranche);
  const locked = await lockOperatorForUpdate(tx, operatorId);

  const deductedCents = Math.min(fullPenaltyCents, locked.stakeBalanceCents);
  const insolvent = fullPenaltyCents > locked.stakeBalanceCents;
  const newBalance = locked.stakeBalanceCents - deductedCents;

  const ledgerEntry = await tx.slashingLedger.create({
    data: {
      operatorId,
      receiptId,
      penaltyCents: deductedCents,
      tranche,
    },
  });

  if (deductedCents > 0 || insolvent) {
    await tx.operator.update({
      where: { id: operatorId },
      data: {
        stakeBalanceCents: newBalance,
        ...(insolvent
          ? { accountStatus: OperatorAccountStatus.ESCROW_INSOLVENT_BLOCKED }
          : {}),
      },
    });
  }

  return {
    deductedCents,
    fullPenaltyCents,
    insolvent,
    ledgerEntryId: ledgerEntry.id,
  };
}
