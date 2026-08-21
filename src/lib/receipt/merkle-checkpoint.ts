import { sign, verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
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
    orderBy: { issuedAt: "asc" },
  });

  const receiptHashes = receipts.map((r) => r.contentHash);
  const merkleRoot = computeReceiptsMerkleRoot(receiptHashes);
  const checkpointId = `ckpt_${crypto.randomUUID().replace(/-/g, "")}`;
  const timestamp = new Date().toISOString();
  const publicKey = getPublicKeyHex();

  const unsigned = {
    checkpoint_id: checkpointId,
    timestamp,
    receipt_count: receipts.length,
    merkle_root: merkleRoot,
    previous_checkpoint_hash: options?.previousCheckpointHash ?? null,
  };

  const contentHash = sha256Hex(canonicalJson(unsigned as unknown as Record<string, unknown>));
  const privKey = getPrivateKeyBytes();
  const signatureBytes = await sign(utf8ToBytes(contentHash), privKey);

  return {
    ...unsigned,
    content_hash: contentHash,
    signature: bytesToHex(signatureBytes),
    algorithm: "ed25519",
    public_key: publicKey,
  };
}

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

  const pubKeyHex = publicKeyHex ?? checkpoint.public_key ?? getPublicKeyHex();
  try {
    return await verify(
      hexToBytes(checkpoint.signature),
      utf8ToBytes(checkpoint.content_hash),
      hexToBytes(pubKeyHex)
    );
  } catch {
    return false;
  }
}
