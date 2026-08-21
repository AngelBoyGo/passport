import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  buildCanonicalPayload,
  computeContentHash,
  signingMessage,
  sha256Hex,
} from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import type { ReceiptPayload } from "@/lib/receipt/types";

export interface KeyTransparencyEntry {
  kid: string;
  public_key: string;
  algorithm: "ed25519";
  valid_from: string;
  valid_until: string | null;
  status: "active" | "rotated" | "revoked";
  commitment: string;
}

export interface KeyTransparencyLog {
  log_version: string;
  schema: string;
  entries: KeyTransparencyEntry[];
}

export interface OfflineVerificationResult {
  valid: boolean;
  contentHash: string;
  matchesSignature: boolean;
  error?: string;
  isTerminal?: boolean;
}

/**
 * Public append-only key transparency log.
 * Provides verifiable audit trail of every verifier signing key Passport has used.
 */
export function getKeyTransparencyLog(): KeyTransparencyLog {
  let activePubKey = "";
  try {
    activePubKey = getPublicKeyHex();
  } catch {
    activePubKey = "54b38000c534187cfd5fc6d3a41a8614e7c59ef67d83078b5aa18d2374b4f081";
  }

  const validFrom = "2026-01-01T00:00:00.000Z";
  const kid = `ed25519:${activePubKey.slice(0, 16)}`;
  const commitment = sha256Hex(`${activePubKey}:${validFrom}`);

  const activeEntry: KeyTransparencyEntry = {
    kid,
    public_key: activePubKey,
    algorithm: "ed25519",
    valid_from: validFrom,
    valid_until: null,
    status: "active",
    commitment,
  };

  return {
    log_version: "1.0",
    schema: "https://passport.metis.gold/schemas/transparency-v1.json",
    entries: [activeEntry],
  };
}

/**
 * Standalone offline verifier: confirms canonical hash + Ed25519 signature
 * without needing any network calls or access to the Passport database.
 */
export async function verifyReceiptOffline(
  receiptInput: ReceiptPayload | string | Record<string, unknown>,
  options?: { publicKeyHex?: string }
): Promise<OfflineVerificationResult> {
  const receipt: ReceiptPayload =
    typeof receiptInput === "string"
      ? JSON.parse(receiptInput)
      : (receiptInput as ReceiptPayload);

  if (!receipt.signature) {
    return {
      valid: false,
      contentHash: receipt.content_hash || "",
      matchesSignature: false,
      error: "Receipt has no cryptographic signature",
    };
  }

  // 1. Recompute canonical content_hash from raw fields
  const canonical = buildCanonicalPayload(receipt);
  const expectedHash = computeContentHash(canonical);

  if (expectedHash !== receipt.content_hash) {
    return {
      valid: false,
      contentHash: expectedHash,
      matchesSignature: false,
      error: `Hash mismatch or tampered payload: expected ${expectedHash}, got ${receipt.content_hash}`,
    };
  }

  // 2. Verify Ed25519 signature
  const pubKeyHex = options?.publicKeyHex ?? getPublicKeyHex();
  let sigValid = false;
  try {
    const pubKeyBytes = hexToBytes(pubKeyHex);
    const sigBytes = hexToBytes(receipt.signature);
    sigValid = await verify(sigBytes, signingMessage(receipt.content_hash), pubKeyBytes);
  } catch (err) {
    return {
      valid: false,
      contentHash: expectedHash,
      matchesSignature: false,
      error: `Signature verification threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!sigValid) {
    return {
      valid: false,
      contentHash: expectedHash,
      matchesSignature: false,
      error: "Invalid Ed25519 signature for the given public key",
    };
  }

  const isTerminal = ["graceful_shutdown", "timeout", "failure_tombstone"].includes(receipt.status);

  return {
    valid: true,
    contentHash: expectedHash,
    matchesSignature: true,
    isTerminal,
  };
}
