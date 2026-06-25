import type { ReceiptPayload } from "./types";

export interface ChainValidationResult {
  valid: boolean;
  gapAt?: number;
  error?: string;
}

/**
 * Validates that a sequence of receipts forms a continuous hash chain.
 */
export function validateChain(receipts: ReceiptPayload[]): ChainValidationResult {
  if (receipts.length <= 1) return { valid: true };

  for (let i = 1; i < receipts.length; i++) {
    const prev = receipts[i - 1];
    const curr = receipts[i];
    if (curr.prev_receipt_hash !== prev.content_hash) {
      return {
        valid: false,
        gapAt: i,
        error: `Chain gap at index ${i}: expected prev_receipt_hash ${prev.content_hash}, got ${curr.prev_receipt_hash}`,
      };
    }
  }

  return { valid: true };
}
