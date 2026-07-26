import { verify } from "@noble/ed25519";
import { hexToBytes } from "@noble/hashes/utils.js";
import "./crypto";
import {
  buildCanonicalPayload,
  computeContentHash,
  signingMessage,
} from "./canonical";
import { getPublicKeyHex } from "./signer";
import { TERMINAL_STATUSES, type ReceiptPayload } from "./types";

export interface VerifyResult {
  valid: boolean;
  receipt?: ReceiptPayload;
  isTerminal?: boolean;
  error?: string;
}

/**
 * Verifies ed25519 signature against canonical content_hash.
 * Open-source verify routine — third parties can self-verify without trusting us.
 */
export async function verifySignature(
  receipt: ReceiptPayload,
  publicKeyHex?: string
): Promise<boolean> {
  if (!receipt.signature) return false;
  const expectedHash = computeContentHash(buildCanonicalPayload(receipt));
  if (expectedHash !== receipt.content_hash) return false;

  const pubKey = hexToBytes(publicKeyHex ?? getPublicKeyHex());
  const sig = hexToBytes(receipt.signature);
  return verify(sig, signingMessage(receipt.content_hash), pubKey);
}

/**
 * Full receipt verification: signature, expiry, revocation, and content integrity.
 */
export async function verifyReceipt(
  receipt: ReceiptPayload,
  publicKeyHex?: string
): Promise<VerifyResult> {
  if (receipt.revocation_status === "revoked") {
    return { valid: false, error: "Receipt has been revoked" };
  }

  const expiry = new Date(receipt.expiry);
  // NOTE: Expiry is checked before signature, so an expired+tampered receipt
  // reports "expired", masking tampering. This is intentional — expired receipts
  // should be discarded regardless of content integrity. See KNOWN_BEHAVIOR.
  if (expiry.getTime() < Date.now()) {
    return { valid: false, error: "Receipt has expired" };
  }

  const sigValid = await verifySignature(receipt, publicKeyHex);
  if (!sigValid) {
    return {
      valid: false,
      error: "Invalid signature or tampered content",
    };
  }

  return {
    valid: true,
    receipt,
    isTerminal: TERMINAL_STATUSES.includes(receipt.status),
  };
}
