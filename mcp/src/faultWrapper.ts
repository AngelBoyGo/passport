import type { PassportClient } from "@passport/sdk";
import { mapErrorToTranche } from "./mappings.js";

/**
 * Runs fn and finalizes the receipt with a mapped tranche on throw, then rethrows.
 */
export async function withFaultCapture<T>(
  client: PassportClient,
  receiptId: string,
  fn: () => Promise<T> | T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const errorTranche = mapErrorToTranche(err);
    const terminalReason =
      err instanceof Error ? err.message : "Unhandled tool failure";
    await client.finalizeReceipt(receiptId, {
      status: "failure_tombstone",
      error_tranche: errorTranche,
      terminal_reason: terminalReason,
    });
    throw err;
  }
}
