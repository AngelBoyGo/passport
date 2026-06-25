import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import "./crypto";
import {
  buildCanonicalPayload,
  computeContentHash,
  signingMessage,
} from "./canonical";
import type { ReceiptPayload } from "./types";

let cachedPublicKeyHex: string | null = null;

/**
 * Loads the verifier-held private signing key from env (write-only at API layer).
 */
function getPrivateKeyBytes(): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error(
      "SIGNING_PRIVATE_KEY must be a 32-byte (64 hex) or 64-byte (128 hex) string"
    );
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/**
 * Returns the published ed25519 public key (hex) derived from the signing key.
 */
export function getPublicKeyHex(): string {
  if (cachedPublicKeyHex) return cachedPublicKeyHex;
  const privateKey = getPrivateKeyBytes();
  const publicKey = getPublicKey(privateKey);
  cachedPublicKeyHex = bytesToHex(publicKey);
  return cachedPublicKeyHex;
}

/**
 * Signs a receipt payload with the verifier-held ed25519 key.
 * Only the issuing API should call this — agents query, verifier writes.
 */
export async function signReceipt(
  receipt: ReceiptPayload
): Promise<ReceiptPayload> {
  const canonical = buildCanonicalPayload(receipt);
  const content_hash = computeContentHash(canonical);
  const privateKey = getPrivateKeyBytes();
  const signatureBytes = await sign(signingMessage(content_hash), privateKey);
  return {
    ...canonical,
    content_hash,
    signature: bytesToHex(signatureBytes),
  };
}
