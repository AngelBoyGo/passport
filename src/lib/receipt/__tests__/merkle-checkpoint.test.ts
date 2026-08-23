import { describe, it, expect, vi, beforeEach } from "vitest";
import { hexToBytes as h } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  computeReceiptsMerkleRoot,
  createReceiptCheckpoint,
  verifyReceiptCheckpoint,
} from "@/lib/receipt/merkle-checkpoint";

describe("Receipt Merkle Root & External Chain Anchoring (Section 2.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  });

  it("computes deterministic binary Merkle tree root from receipt content hashes", () => {
    const hashes = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)];
    const root1 = computeReceiptsMerkleRoot(hashes);
    const root2 = computeReceiptsMerkleRoot(hashes);

    expect(root1).toBe(root2);
    expect(root1).toMatch(/^[0-9a-f]{64}$/i);
    expect(root1).not.toBe(hashes[0]);
  });

  it("handles empty hash lists safely with a genesis root", () => {
    const root = computeReceiptsMerkleRoot([]);
    expect(root).toBe("0".repeat(64));
  });

  it("creates an Ed25519-signed Merkle checkpoint over finalized receipts", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      { receiptId: "rcpt_1", contentHash: "1".repeat(64), issuedAt: new Date() },
      { receiptId: "rcpt_2", contentHash: "2".repeat(64), issuedAt: new Date() },
    ]);

    const checkpoint = await createReceiptCheckpoint();

    expect(checkpoint.checkpoint_id).toMatch(/^ckpt_/);
    expect(checkpoint.receipt_count).toBe(2);
    expect(checkpoint.merkle_root).toMatch(/^[0-9a-f]{64}$/i);
    expect(checkpoint.signature).toMatch(/^[0-9a-f]{128}$/i);

    // Verify cryptographic validity of the checkpoint
    const isValid = await verifyReceiptCheckpoint(checkpoint);
    expect(isValid).toBe(true);
  });

  it("rejects tampered Merkle checkpoint data", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      { receiptId: "rcpt_1", contentHash: "1".repeat(64), issuedAt: new Date() },
    ]);

    const checkpoint = await createReceiptCheckpoint();
    const tampered = { ...checkpoint, receipt_count: 999 };

    const isValid = await verifyReceiptCheckpoint(tampered);
    expect(isValid).toBe(false);
  });

  it("rejects a self-signed checkpoint whose embedded key is NOT pinned (C2)", async () => {
    // An attacker fabricates a checkpoint using their own key and embeds their
    // public key in the payload. verifyReceiptCheckpoint with NO pinned key
    // passed must NOT trust the embedded key — it must fail.
    const { sign, getPublicKey } = await import("@noble/ed25519");
    const { sha256Hex, canonicalJson } = await import("@/lib/receipt/canonical");
    const { hexToBytes: h2b, utf8ToBytes: u2b, bytesToHex: b2h } = await import("@noble/hashes/utils.js");

    const attackerSeed = "7".repeat(64);
    const attackerPub = b2h(await getPublicKey(h(attackerSeed)));
    const forged = {
      checkpoint_id: "ckpt_forged",
      timestamp: new Date().toISOString(),
      receipt_count: 1,
      merkle_root: "deadbeef".repeat(8),
      previous_checkpoint_hash: null,
    };
    const contentHash = sha256Hex(canonicalJson(forged as unknown as Record<string, unknown>));
    const signature = b2h(await sign(u2b(contentHash), h(attackerSeed)));

    const forgeCkpt = {
      ...forged,
      content_hash: contentHash,
      signature,
      algorithm: "ed25519",
      public_key: attackerPub,
    };

    // No pinned key supplied → must use only transparency-log pinned key → fail.
    const isValid = await verifyReceiptCheckpoint(forgeCkpt as any);
    expect(isValid).toBe(false);
  });
});
