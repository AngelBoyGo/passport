/**
 * Shared Ed25519 signing for signed status reports (Lighthouse, Resilience).
 *
 * Signs a payload as sha256(canonicalJson(payload)) with the passport SIGNING_PRIVATE_KEY — the
 * same key as /receipts/monetary — and returns the content hash, signature, and published public
 * key so third parties can verify offline. Fails CLOSED in production when the key is absent:
 * a "signed" report that silently emits an empty signature is worse than an error.
 */

import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import "@/lib/receipt/crypto";

export interface SignedSnapshot {
  content_hash: string;
  signature: string;
  public_key: string;
}

export function signReportPayload(payload: Record<string, unknown>): SignedSnapshot {
  const contentHash = sha256Hex(canonicalJson(payload));
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  const hasKey =
    typeof privateKeyHex === "string" &&
    (privateKeyHex.length === 64 || privateKeyHex.length === 128);

  if (!hasKey && process.env.NODE_ENV === "production") {
    throw new Error(
      "SIGNING_PRIVATE_KEY is required in production to sign a report snapshot"
    );
  }

  let signature = "";
  if (hasKey) {
    const pk = hexToBytes(
      privateKeyHex!.length === 128 ? privateKeyHex!.slice(0, 64) : privateKeyHex!
    );
    signature = bytesToHex(sign(utf8ToBytes(contentHash), pk));
  }

  let publicKey = "";
  try {
    publicKey = getPublicKeyHex();
  } catch {
    publicKey = "";
  }

  return { content_hash: contentHash, signature, public_key: publicKey };
}
