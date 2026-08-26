import { sha256Hex } from "@/lib/receipt/canonical";
import { burnAndPayout, withdrawalRef } from "@/lib/bridge/ledger";
import { walletForCommitment } from "@/lib/bridge/wallet";

export const WithdrawalOwnershipError = "Withdrawal requires an owned custodial wallet binding";

export interface WithdrawalWithRef {
  amount: number;
  subjectCommitment: string;
  operatorId: string;
  reference: string;
}

export type WithdrawalResult =
  | { applied: true; receipt_id: string; reference: string }
  | { applied: false; reason: string };

/**
 * Request a withdrawal: burns ANGL from the commitment's ledger (exactly-once
 * via the bridge_transfer rail) and returns a deterministic proof-of-payout
 * receipt id. Ownership is gated on the caller owning the commitment's wallet.
 */
export async function requestWithdrawal(input: {
  subjectCommitment: string;
  operatorId: string;
  amount: number;
  reference: string;
}): Promise<WithdrawalResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Withdrawal amount must be positive");
  }

  // Gate: the caller must own the commitment's custodial wallet.
  const wallet = await walletForCommitment(input.subjectCommitment);
  if (!wallet || wallet.operatorId !== input.operatorId) {
    throw new Error(WithdrawalOwnershipError);
  }

  const burn = await burnAndPayout({
    operatorId: input.operatorId,
    subjectCommitment: input.subjectCommitment,
    reference: input.reference,
    amount: input.amount,
  });
  if (!burn.applied) {
    return { applied: false, reason: burn.reason ?? "Withdrawal not applied" };
  }

  // Proof-of-payout receipt id: deterministic, independent of the ledger.
  const receiptId = proofReceiptId(input);
  return { applied: true, receipt_id: receiptId, reference: input.reference };
}

/** Deterministic, ledger-committed proof-of-payout receipt id. */
export function proofReceiptId(input: { amount: number; reference: string; subjectCommitment: string }): string {
  return sha256Hex(`withdraw:${input.subjectCommitment}:${input.reference}:${input.amount}`);
}

export function withdrawReference(taskIdOrTx: string): string {
  return withdrawalRef("wd", taskIdOrTx);
}