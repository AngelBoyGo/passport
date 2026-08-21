import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { createReceiptCheckpoint } from "@/lib/receipt/merkle-checkpoint";
import {
  buildNotaryAnchorPayload,
  deliverToExternalNotary,
  verifyNotaryAnchor,
  getNotaryAnchorUrl,
} from "@/lib/notary/notary-anchor";

describe("External Notary Anchoring (2.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    delete process.env.NOTARY_ANCHOR_URL;
  });

  afterEach(() => {
    delete process.env.NOTARY_ANCHOR_URL;
  });

  it("reports unreachable-not-fatal when no external notary is configured", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([]);
    const checkpoint = await createReceiptCheckpoint();

    const delivery = await deliverToExternalNotary(checkpoint);

    expect(delivery.endpoint_reachable).toBe(false);
    expect(delivery.endpoint_label).toBe("NOTARY_ANCHOR_URL_NOT_SET");
    expect(delivery.checkpoint_id).toBe(checkpoint.checkpoint_id);
    expect(delivery.merkle_root).toBe(checkpoint.merkle_root);
    expect(delivery.anchor_id).toMatch(/^anchor_/);
  });

  it("builds a signed anchor payload that verifies offline", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([]);
    const checkpoint = await createReceiptCheckpoint();

    const payload = buildNotaryAnchorPayload(checkpoint);

    expect(payload.checkpoint_id).toBe(checkpoint.checkpoint_id);
    expect(payload.merkle_root).toBe(checkpoint.merkle_root);
    expect(payload.anchor_digest).toMatch(/^[0-9a-f]{64}$/i);
    expect(payload.signature).toMatch(/^[0-9a-f]{128}$/i);

    const valid = await verifyNotaryAnchor(payload);
    expect(valid).toBe(true);
  });

  it("detects a tampered anchor payload", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([]);
    const checkpoint = await createReceiptCheckpoint();

    const payload = buildNotaryAnchorPayload(checkpoint);
    // Tamper with the merkle root after signing
    const tampered = { ...payload, merkle_root: "f".repeat(64) };

    const valid = await verifyNotaryAnchor(tampered);
    expect(valid).toBe(false);
  });

  it("posts the signed chain head to the configured external notary", async () => {
    process.env.NOTARY_ANCHOR_URL = "https://notary.example/ingest";
    prismaMock.receipt.findMany.mockResolvedValue([]);
    const checkpoint = await createReceiptCheckpoint();

    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 }));
    try {
      const delivery = await deliverToExternalNotary(checkpoint);
      expect(delivery.endpoint_reachable).toBe(true);
      expect(delivery.endpoint_label).toBe("external_notary");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toBe("https://notary.example/ingest");
      expect(init.headers["X-Passport-Anchor"]).toBe(checkpoint.checkpoint_id);
      expect(init.headers["X-Passport-Signature"]).toMatch(/^[0-9a-f]{128}$/i);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
