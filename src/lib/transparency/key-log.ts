import { verify, getPublicKey } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  buildCanonicalPayload,
  computeContentHash,
  signingMessage,
  sha256Hex,
} from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { prisma } from "@/lib/db";
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

const VALID_FROM = "2026-01-01T00:00:00.000Z";

/**
 * Collects the active signing key plus any rotation-window previous key
 * (SIGNING_PRIVATE_KEY_PREVIOUS, 64-hex). This lets an operator run a rotation
 * where artifacts signed under the old key still verify before revocation.
 */
function collectKeys(): { key: string; status: "active" | "rotated" }[] {
  const keys: { key: string; status: "active" | "rotated" }[] = [];
  try {
    keys.push({ key: getPublicKeyHex().toLowerCase(), status: "active" });
  } catch {
    keys.push({
      key: "54b38000c534187cfd5fc6d3a41a8614e7c59ef67d83078b5aa18d2374b4f081",
      status: "active",
    });
  }
  const previous = process.env.SIGNING_PRIVATE_KEY_PREVIOUS?.trim();
  if (previous && /^[0-9a-f]{64}$/i.test(previous)) {
    const seed = hexToBytes(previous.length === 128 ? previous.slice(0, 64) : previous);
    try {
      keys.push({ key: bytesToHex(getPublicKey(seed)).toLowerCase(), status: "rotated" });
    } catch {
      keys.push({ key: previous.toLowerCase(), status: "rotated" });
    }
  }
  return keys;
}

/**
 * Public append-only key transparency log.
 * Includes the active key plus any rotation-window key (SIGNING_PRIVATE_KEY_PREVIOUS)
 * so verifiers can accept artifacts from both the current and immediately-prior
 * key. Use syncKeyTransparencyLog() to persist entries for durability.
 */
export function getKeyTransparencyLog(): KeyTransparencyLog {
  const entries: KeyTransparencyEntry[] = collectKeys().map(({ key, status }) => {
    const kid = `ed25519:${key.slice(0, 16)}`;
    return {
      kid,
      public_key: key,
      algorithm: "ed25519",
      valid_from: VALID_FROM,
      valid_until: status === "rotated" ? new Date().toISOString() : null,
      status,
      commitment: sha256Hex(`${key}:${VALID_FROM}`),
    };
  });

  return {
    log_version: "1.0",
    schema: "https://passport.metis.gold/schemas/transparency-v1.json",
    entries,
  };
}

/**
 * Persists the current (and any rotation-previous) signing keys into the
 * KeyLogEntry table so the transparency trail survives restarts. Idempotent on
 * kid. Call once at startup and after a key rotation.
 */
export async function syncKeyTransparencyLog(): Promise<void> {
  for (const { key, status } of collectKeys()) {
    const kid = `ed25519:${key.slice(0, 16)}`;
    try {
      await prisma.keyLogEntry.upsert({
        where: { kid },
        create: {
          kid,
          publicKeyHex: key,
          algorithm: "ed25519",
          status,
          validFrom: new Date(VALID_FROM),
          validUntil: status === "rotated" ? new Date() : null,
        },
        update: {},
      });
    } catch {
      // non-fatal: if the table/migration isn't applied, the in-process log still works
    }
  }
}

/**
 * DB-backed lookup: is this verifying key one Passport has published? Used by
 * async verifiers so a rotated-and-retired key still resolves without relying
 * on env. Gracefully falls back to the in-process log when the table is absent.
 */
export async function findKeyInTransparencyLog(publicKeyHex: string): Promise<boolean> {
  const clean = publicKeyHex.toLowerCase();
  if (getKeyTransparencyLog().entries.some((e) => e.public_key === clean)) return true;
  try {
    const found = await prisma.keyLogEntry.findFirst({
      where: { publicKeyHex: clean },
      select: { id: true },
    });
    return !!found;
  } catch {
    return false;
  }
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
