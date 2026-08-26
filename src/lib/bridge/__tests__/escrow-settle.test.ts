import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    externalSettlement: { create: vi.fn(), findFirst: vi.fn() },
    bridgeWallet: { findFirst: vi.fn() },
    capabilityLedgerEntry: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => fn(prismaMock)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { enqueueWorkerTransfer } from "@/lib/bridge/escrow-settle";

describe("Optional on-chain escrow settlement — test bank D", () => {
  const taskId = "task-accept-1";
  const worker = "b".repeat(64);

  beforeEach(() => {
    prismaMock.externalSettlement.findFirst.mockReset();
    prismaMock.externalSettlement.create.mockReset();
    prismaMock.bridgeWallet.findFirst.mockReset();
    prismaMock.capabilityLedgerEntry.create.mockReset();
    // defaults
    prismaMock.externalSettlement.findFirst.mockResolvedValue(null);
    prismaMock.capabilityLedgerEntry.create.mockResolvedValue({ id: "ce" });
  });

  it("D1: enqueueWorkerTransfer records an exactly-once bridge_transfer reservation", async () => {
    prismaMock.bridgeWallet.findFirst.mockResolvedValue({
      id: "bw_worker",
      operatorId: "op_worker",
      chainAddress: "0xworker",
      subjectCommitment: worker,
      bridgeExternalId: null,
      upstream: "bridge",
    });
    prismaMock.externalSettlement.create.mockResolvedValue({ id: "ss" });

    const result = await enqueueWorkerTransfer({ taskId, workerCommitment: worker, amount: 2500 });

    expect(result.enqueued).toBe(true);
    expect(prismaMock.externalSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rail: "bridge_transfer",
          reference: `escrow_${taskId}`,
          creditCredits: 2500,
        }),
      })
    );
  });

  it("D2: a duplicate enqueue (same task) is refused — exactly once", async () => {
    // A prior settlement row already exists → findFirst returns it → refuse.
    prismaMock.externalSettlement.findFirst.mockResolvedValue({ id: "existing" });

    const result = await enqueueWorkerTransfer({ taskId, workerCommitment: worker, amount: 2500 });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/already|duplicate/i);
    expect(prismaMock.externalSettlement.create).not.toHaveBeenCalled();
  });

  it("D3: resolves the worker wallet and returns it in the confirmation", async () => {
    prismaMock.bridgeWallet.findFirst.mockResolvedValue({
      id: "bw_worker",
      operatorId: "op_worker",
      chainAddress: "0xworker",
      subjectCommitment: worker,
      bridgeExternalId: null,
      upstream: "bridge",
    });
    prismaMock.externalSettlement.create.mockResolvedValue({ id: "ss" });

    const result = await enqueueWorkerTransfer({ taskId, workerCommitment: worker, amount: 1000 });

    expect(result.workerChainAddress).toBe("0xworker");
  });

  it("D4: still records the reservation when no wallet exists yet (settles later)", async () => {
    prismaMock.bridgeWallet.findFirst.mockResolvedValue(null);
    prismaMock.externalSettlement.create.mockResolvedValue({ id: "ss" });

    const result = await enqueueWorkerTransfer({ taskId, workerCommitment: worker, amount: 1000 });

    expect(result.enqueued).toBe(true);
    expect(result.workerChainAddress).toBeNull();
    expect(prismaMock.externalSettlement.create).toHaveBeenCalled();
  });
});