import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: { findUnique: vi.fn(), update: vi.fn() },
    bridgeWallet: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  ensureOperatorWallet,
  ensureAgentWallet,
  KYC_GATE_NEEDS_APPROVED,
} from "@/lib/bridge/wallet";

describe("Bridge wallet mapping — test bank C", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRIDGE_ENV = "sandbox";
    delete process.env.ANGL_WITHDRAW_KYC_ONLY;
  });

  // ---- C1 ----
  it("C1: ensureOperatorWallet is idempotent — returns the existing wallet", async () => {
    prismaMock.bridgeWallet.findUnique.mockResolvedValue({
      id: "bw_1",
      operatorId: "op_1",
      chainAddress: "0xabc",
      subjectCommitment: null,
    });

    const wallet = await ensureOperatorWallet("op_1");
    expect(wallet.id).toBe("bw_1");
    expect(prismaMock.bridgeWallet.findUnique).toHaveBeenCalled();
    expect(prismaMock.bridgeWallet.upsert).not.toHaveBeenCalled();
  });

  it("C1b: ensureOperatorWallet creates a wallet on first touch and binds operator", async () => {
    prismaMock.bridgeWallet.findUnique.mockResolvedValue(null);
    prismaMock.bridgeWallet.upsert.mockResolvedValue({
      id: "bw_new",
      operatorId: "op_1",
      chainAddress: "0xnew",
    });

    const wallet = await ensureOperatorWallet("op_1");
    expect(prismaMock.bridgeWallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operatorId: "op_1" },
        create: expect.objectContaining({
          operatorId: "op_1",
          upstream: "bridge",
        }),
      })
    );
  });

  // ---- C2 ----
  it("C2: ensureAgentWallet fails for a commitment not bound to a KYC-approved operator", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ id: "op_1", kycStatus: "PENDING" });

    await expect(ensureAgentWallet("c".repeat(64), "op_1")).rejects.toThrow(KYC_GATE_NEEDS_APPROVED);
  });

  it("C2b: ensureAgentWallet binds the commitment when the operator is KYC-approved", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ id: "op_1", kycStatus: "APPROVED" });
    prismaMock.bridgeWallet.findUnique.mockResolvedValue(null);
    prismaMock.bridgeWallet.upsert.mockResolvedValue({
      id: "bw_1",
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
    });

    const wallet = await ensureAgentWallet("c".repeat(64), "op_1");
    expect(wallet.subjectCommitment).toBe("c".repeat(64));
  });

  // ---- C3 ----
  it("C3: KYC-only withdrawals are enforced when ANGL_WITHDRAW_KYC_ONLY=true", async () => {
    process.env.ANGL_WITHDRAW_KYC_ONLY = "true";
    prismaMock.operator.findUnique.mockResolvedValue({ id: "op_1", kycStatus: "PENDING" });

    await expect(ensureAgentWallet("c".repeat(64), "op_1")).rejects.toThrow(KYC_GATE_NEEDS_APPROVED);
  });

  it("C3b: sandbox defaults to NOT_REQUIRED and allows wallet binding without approval", async () => {
    prismaMock.operator.findUnique.mockResolvedValue({ id: "op_1", kycStatus: "NOT_REQUIRED" });
    prismaMock.bridgeWallet.findUnique.mockResolvedValue(null);
    prismaMock.bridgeWallet.upsert.mockResolvedValue({
      id: "bw_1",
      operatorId: "op_1",
      subjectCommitment: "c".repeat(64),
    });

    const wallet = await ensureAgentWallet("c".repeat(64), "op_1");
    expect(wallet.subjectCommitment).toBe("c".repeat(64));
  });
});