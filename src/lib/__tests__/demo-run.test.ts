import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/gate/verifyGatePass", () => ({
  verifyGatePass: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    operator: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    receipt: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/operator", () => ({
  ensureOperator: vi.fn(),
  ensureAgent: vi.fn(),
  operatorIdFromStripe: vi.fn((id: string) => `op_${id}`),
}));

vi.mock("@/lib/receipt-service", () => ({
  dbReceiptToPayload: vi.fn((row) => row),
  issueReceipt: vi.fn(),
  finalizeReceipt: vi.fn(),
}));

vi.mock("@/lib/receipt/verify", () => ({
  verifyReceipt: vi.fn(),
}));

import { verifyGatePass } from "@/lib/gate/verifyGatePass";
import { prisma } from "@/lib/db";
import { ensureAgent, ensureOperator } from "@/lib/operator";
import { finalizeReceipt, issueReceipt } from "@/lib/receipt-service";
import { verifyReceipt } from "@/lib/receipt/verify";
import {
  DEMO_DOMAIN,
  DEMO_ESCROW_CENTS,
  ensureDemoEscrowBond,
  ensureDemoGateHistory,
  pruneInvalidDemoReceipts,
  runPublicDemo,
} from "@/lib/demo/runPublicDemo";

const verifyGatePassMock = verifyGatePass as unknown as ReturnType<typeof vi.fn>;
const operatorFindUniqueMock = prisma.operator.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const operatorUpdateMock = prisma.operator.update as unknown as ReturnType<
  typeof vi.fn
>;
const countMock = prisma.receipt.count as unknown as ReturnType<typeof vi.fn>;
const createMock = prisma.receipt.create as unknown as ReturnType<typeof vi.fn>;
const findFirstMock = prisma.receipt.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const findManyMock = prisma.receipt.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const deleteManyMock = prisma.receipt.deleteMany as unknown as ReturnType<
  typeof vi.fn
>;
const ensureOperatorMock = ensureOperator as unknown as ReturnType<typeof vi.fn>;
const ensureAgentMock = ensureAgent as unknown as ReturnType<typeof vi.fn>;
const issueReceiptMock = issueReceipt as unknown as ReturnType<typeof vi.fn>;
const finalizeReceiptMock = finalizeReceipt as unknown as ReturnType<
  typeof vi.fn
>;
const verifyReceiptMock = verifyReceipt as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDemoEscrowBond", () => {
  it("tops up demo operator when below enterprise floor", async () => {
    operatorFindUniqueMock.mockResolvedValue({ stakeBalanceCents: 0 });

    await ensureDemoEscrowBond("op-db-1");

    expect(operatorUpdateMock).toHaveBeenCalledWith({
      where: { id: "op-db-1" },
      data: {
        stakeBalanceCents: DEMO_ESCROW_CENTS,
        accountStatus: "ACTIVE",
      },
    });
  });

  it("skips update when escrow already meets floor", async () => {
    operatorFindUniqueMock.mockResolvedValue({ stakeBalanceCents: DEMO_ESCROW_CENTS });

    await ensureDemoEscrowBond("op-db-1");

    expect(operatorUpdateMock).not.toHaveBeenCalled();
  });
});

describe("ensureDemoGateHistory", () => {
  it("seeds receipts when gate returns ZERO_TENANCY_REJECT", async () => {
    verifyGatePassMock.mockResolvedValue({
      allow_invocation: false,
      reason: "ZERO_TENANCY_REJECT",
    });
    countMock.mockResolvedValue(0);
    ensureAgentMock.mockResolvedValue({ id: "agent-row-1" });
    createMock.mockResolvedValue({});

    await ensureDemoGateHistory("op-db-1");

    expect(createMock).toHaveBeenCalledTimes(5);
    expect(ensureAgentMock).toHaveBeenCalledWith(
      "op-db-1",
      "demo-agent-1",
      "site.demo"
    );
  });

  it("does nothing when gate already allows invocation", async () => {
    verifyGatePassMock.mockResolvedValue({ allow_invocation: true });

    await ensureDemoGateHistory("op-db-1");

    expect(countMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("pruneInvalidDemoReceipts", () => {
  it("deletes demo receipts that fail verification", async () => {
    findManyMock.mockResolvedValue([
      { receiptId: "rcpt_bad" },
      { receiptId: "rcpt_good" },
    ]);
    verifyReceiptMock
      .mockResolvedValueOnce({ valid: false })
      .mockResolvedValueOnce({ valid: true });

    await pruneInvalidDemoReceipts("op-db-1");

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { receiptId: { in: ["rcpt_bad"] } },
    });
  });
});

describe("runPublicDemo", () => {
  it("issues and finalizes a demo receipt", async () => {
    ensureOperatorMock.mockResolvedValue({ id: "op-db-1" });
    operatorFindUniqueMock.mockResolvedValue({ stakeBalanceCents: DEMO_ESCROW_CENTS });
    verifyGatePassMock.mockResolvedValue({ allow_invocation: true });
    findManyMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    issueReceiptMock.mockResolvedValue({
      signed: { receipt_id: "rcpt_demo_pending" },
    });
    finalizeReceiptMock.mockResolvedValue({
      signed: { receipt_id: "rcpt_demo_final" },
    });

    const result = await runPublicDemo();

    expect(result).toEqual({ receipt_id: "rcpt_demo_final" });
    expect(issueReceiptMock).toHaveBeenCalledWith(
      "op-db-1",
      expect.objectContaining({
        agent_id: "demo-agent-1",
        domain: DEMO_DOMAIN,
      })
    );
    expect(finalizeReceiptMock).toHaveBeenCalledWith(
      "op-db-1",
      "rcpt_demo_pending",
      expect.objectContaining({ status: "success" })
    );
  });
});
