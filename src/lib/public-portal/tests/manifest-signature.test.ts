import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    evidenceReceiptLink: { findFirst: vi.fn() },
    receipt: { findUnique: vi.fn(), findMany: vi.fn() },
    operator: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getReceiptPublicManifest } from "@/lib/public-portal/portal-service";

describe("getReceiptPublicManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockReceiptRow(overrides: Record<string, unknown> = {}) {
    return {
      receiptId: "rcpt_test_1",
      issuedAt: new Date(),
      operatorId: "op-1",
      agentId: "agent-1",
      agentRecordId: "agent-rec-1",
      receiptType: "custody",
      status: "success",
      inputDigest: "a".repeat(64),
      authorityScope: "test.scope",
      expiry: new Date(Date.now() + 86400_000),
      revocationStatus: "active",
      outputHash: null,
      refusalReason: null,
      terminalReason: null,
      prevReceiptHash: null,
      contentHash: "b".repeat(64),
      signature:
        "e5564300c126e7f04f98e48d0e8b8f84b0b1f5a3f5c5e4d3c2b1a9b8c7d6e5f4" +
        "0000000000000000000000000000000000000000000000000000000000000000",
      finalizedAt: new Date(),
      domain: null,
      domainCommitment: null,
      blindSalt: null,
      errorTranche: null,
      operator: {
        stripeCustomerId: "cus_test_1",
        email: "test@example.com",
      },
      agent: { id: "agent-rec-1" },
      ...overrides,
    };
  }

  it("includes the signature field for offline verification", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(mockReceiptRow());
    prismaMock.receipt.findMany.mockResolvedValue([]);
    prismaMock.evidenceReceiptLink.findFirst.mockResolvedValue(null);

    const manifest = await getReceiptPublicManifest("rcpt_test_1");
    expect(manifest).not.toBeNull();
    expect(manifest).toHaveProperty("signature");
    expect(manifest!.signature).toBe(
      mockReceiptRow().signature
    );
  });

  it("sets signature to null when the receipt has no signature", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(
      mockReceiptRow({ signature: null })
    );
    prismaMock.receipt.findMany.mockResolvedValue([]);
    prismaMock.evidenceReceiptLink.findFirst.mockResolvedValue(null);

    const manifest = await getReceiptPublicManifest("rcpt_test_1");
    expect(manifest).not.toBeNull();
    expect(manifest!.signature).toBeNull();
  });
});