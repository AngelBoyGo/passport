import { sign, verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import { getKeyTransparencyLog } from "@/lib/transparency/key-log";
import { prisma } from "@/lib/db";

export interface SignedCheckpoint {
  checkpoint_id: string;
  timestamp: string;
  receipt_count: number;
  merkle_root: string;
  previous_checkpoint_hash: string | null;
  content_hash: string;
  signature: string;
  algorithm: "ed25519";
  public_key: string;
}

function getPrivateKeyBytes(): Uint8Array {
  const hex = process.env.SIGNING_PRIVATE_KEY;
  if (!hex || (hex.length !== 64 && hex.length !== 128)) {
    throw new Error("SIGNING_PRIVATE_KEY must be 64 or 128 hex string");
  }
  return hexToBytes(hex.length === 128 ? hex.slice(0, 64) : hex);
}

/**
 * Computes a deterministic binary SHA-256 Merkle tree root from an array of receipt content hashes.
 */
export function computeReceiptsMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return "0".repeat(64);
  }

  let current = hashes.map((h) => h.toLowerCase());

  while (current.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        // Hash pair: sha256(left + right)
        nextLevel.push(sha256Hex(current[i] + current[i + 1]));
      } else {
        // Odd node: promote by hashing with itself
        nextLevel.push(sha256Hex(current[i] + current[i]));
      }
    }
    current = nextLevel;
  }

  return current[0];
}

/**
 * Creates an Ed25519-signed Merkle checkpoint over finalized receipts.
 * External anchor point for air-gapped / sovereign compliance verification.
 */
export async function createReceiptCheckpoint(options?: {
  since?: Date;
  previousCheckpointHash?: string;
}): Promise<SignedCheckpoint> {
  const receipts = await prisma.receipt.findMany({
    where: {
      status: { not: "pending" },
      ...(options?.since ? { finalizedAt: { gte: options.since } } : {}),
    },
    select: { contentHash: true },
    // H2: deterministic ordering. issuedAt has ms precision and is not unique,
    // so tie-break on contentHash to guarantee the same receipt set always
    // produces the same Merkle root across runs/auditors.
    orderBy: [{ issuedAt: "asc" }, { contentHash: "asc" }],
  });

  const receiptHashes = receipts.map((r) => r.contentHash);
  const merkleRoot = computeReceiptsMerkleRoot(receiptHashes);
  const checkpointId = `ckpt_${crypto.randomUUID().replace(/-/g, "")}`;
  const timestamp = new Date().toISOString();
  const publicKey = getPublicKeyHex();

  // H3: chain on EXPLICITLY supplied previous checkpoint hash only. We do NOT
  // auto-chain from in-process memory: a module-level cache would fabricate
  // unrelated links across endpoints/instances and break the reproducibility
  // an auditor relies on. Callers that want a real append-only chain must pass
  // the previous checkpoint hash (e.g. from a persisted checkpoint store).
  const previousHash = options?.previousCheckpointHash ?? null;

  const unsigned = {
    checkpoint_id: checkpointId,
    timestamp,
    receipt_count: receipts.length,
    merkle_root: merkleRoot,
    previous_checkpoint_hash: previousHash,
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const privKey = getPrivateKeyBytes();
  const signatureBytes = await sign(utf8ToBytes(contentHash), privKey);

  const checkpoint: SignedCheckpoint = {
    ...unsigned,
    content_hash: contentHash,
    signature: bytesToHex(signatureBytes),
    algorithm: "ed25519",
    public_key: publicKey,
  };
  return checkpoint;
}

/**
 * DEPRECATED: retained as a no-op for API-compat. Chaining is now explicit only
 * (callers pass previousCheckpointHash); no in-process chain state exists.
 */
export function resetCheckpointChain(): void {}

/**
 * Validates a Merkle checkpoint's signature and canonical hash offline.
 */
export async function verifyReceiptCheckpoint(
  checkpoint: SignedCheckpoint,
  publicKeyHex?: string
): Promise<boolean> {
  if (!checkpoint || !checkpoint.signature || !checkpoint.content_hash) {
    return false;
  }

  const unsigned = {
    checkpoint_id: checkpoint.checkpoint_id,
    timestamp: checkpoint.timestamp,
    receipt_count: checkpoint.receipt_count,
    merkle_root: checkpoint.merkle_root,
    previous_checkpoint_hash: checkpoint.previous_checkpoint_hash,
  };

  const expectedHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  if (expectedHash !== checkpoint.content_hash) {
    return false;
  }

  // SECURITY (C2): verification must use a PINNED key (operator-supplied or the
  // published transparency-log key). Never trust the checkpoint's own
  // `public_key` field — an attacker could fabricate a self-signed checkpoint.
  const pubKeyHex =
    publicKeyHex ?? checkpoint.public_key ?? undefined;

  let verifyKey: string | undefined = pubKeyHex;
  if (!verifyKey || !isPinnedKey(verifyKey)) {
    // If caller didn't pin, fall back to the active transparency-log key only.
    try {
      const log = getKeyTransparencyLog();
      const active = log.entries.find((e) => e.status === "active");
      verifyKey = active?.public_key;
    } catch {
      verifyKey = undefined;
    }
  }
  if (!verifyKey) {
    return false;
  }

  try {
    if (!verifyKey) return false;
    return await verify(
      hexToBytes(checkpoint.signature),
      utf8ToBytes(checkpoint.content_hash),
      hexToBytes(verifyKey)
    );
  } catch {
    return false;
  }
}

/** True when the key appears in Passport's published transparency log. */
function isPinnedKey(pubKeyHex: string): boolean {
  try {
    const log = getKeyTransparencyLog();
    return log.entries.some((e) => e.public_key.toLowerCase() === pubKeyHex.toLowerCase());
  } catch {
    return false;
  }
}
