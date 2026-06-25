import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { FREE_CREDITS, PRO_CREDITS } from "@/lib/stripe";

const stripeEventCreateMock = vi.fn();
const ensureOperatorMock = vi.fn();
const createApiKeyMock = vi.fn();
const operatorUpdateMock = vi.fn();
const apiKeyCountMock = vi.fn();
const operatorFindUniqueMock = vi.fn();
const apiKeyFindManyMock = vi.fn();
const stripeEventDeleteManyMock = vi.fn();
const apiKeyDeleteManyMock = vi.fn();
const agentDeleteManyMock = vi.fn();
const receiptDeleteManyMock = vi.fn();
const capabilityDeleteManyMock = vi.fn();
const matchDeleteManyMock = vi.fn();
const operatorDeleteMock = vi.fn();

function makeTx() {
  return {
    stripeEvent: {
      create: stripeEventCreateMock,
      deleteMany: stripeEventDeleteManyMock,
    },
    operator: {
      update: operatorUpdateMock,
      findUnique: operatorFindUniqueMock,
      delete: operatorDeleteMock,
    },
    apiKey: {
      count: apiKeyCountMock,
      findMany: apiKeyFindManyMock,
      deleteMany: apiKeyDeleteManyMock,
    },
    agent: { deleteMany: agentDeleteManyMock },
    receipt: { deleteMany: receiptDeleteManyMock },
    capabilityLedgerEntry: { deleteMany: capabilityDeleteManyMock },
    matchLedgerEntry: { deleteMany: matchDeleteManyMock },
  };
}

vi.mock("@/lib/operator", () => ({
  ensureOperator: (...args: unknown[]) => ensureOperatorMock(...args),
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
  operatorIdFromStripe: (cus: string) => `op_${cus}`,
}));

import {
  buildAuditCheckoutEvent,
  generateAuditCustomerId,
  provisionAuditCheckout,
  assertAuditProvisioning,
  purgeAuditOperator,
} from "@/lib/billing-audit";

beforeEach(() => {
  vi.clearAllMocks();
  ensureOperatorMock.mockResolvedValue({ id: "op_db_audit", credits: FREE_CREDITS });
  operatorUpdateMock.mockResolvedValue({
    id: "op_db_audit",
    credits: FREE_CREDITS + PRO_CREDITS,
    tier: "pro",
  });
  apiKeyCountMock.mockResolvedValue(0);
  createApiKeyMock.mockResolvedValue("pp_aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899");
  operatorFindUniqueMock.mockResolvedValue({
    id: "op_db_audit",
    stripeCustomerId: "cus_live_audit_abc123",
    credits: FREE_CREDITS + PRO_CREDITS,
    tier: "pro",
  });
  apiKeyFindManyMock.mockResolvedValue([{ id: "key_1", keyHash: "abc" }]);
});

describe("buildAuditCheckoutEvent", () => {
  it("builds live-format checkout.session.completed payload", () => {
    const event = buildAuditCheckoutEvent("cus_live_audit_xyz", "evt_audit_1");
    expect(event.type).toBe("checkout.session.completed");
    expect(event.id).toBe("evt_audit_1");
    expect(event.data.object.customer).toBe("cus_live_audit_xyz");
    expect(event.data.object.mode).toBe("subscription");
  });
});

describe("generateAuditCustomerId", () => {
  it("uses cus_live_audit_ prefix with random suffix", () => {
    const id = generateAuditCustomerId();
    expect(id).toMatch(/^cus_live_audit_[a-z0-9]+$/);
  });
});

describe("provisionAuditCheckout", () => {
  it("ASSERTION A: maps billing token to Operator with Sybil anchor op_cus_*", async () => {
    const tx = makeTx();
    const customerId = "cus_live_audit_test01";

    const result = await provisionAuditCheckout(
      tx as unknown as Prisma.TransactionClient,
      customerId,
      "audit@passport.test",
      "evt_audit_a"
    );

    expect(ensureOperatorMock).toHaveBeenCalledWith(
      customerId,
      "audit@passport.test",
      tx
    );
    expect(result.operatorId).toBe(`op_${customerId}`);
  });

  it("ASSERTION B: provisions Pro credits and pp_ API key", async () => {
    const tx = makeTx();
    const customerId = "cus_live_audit_test02";

    const result = await provisionAuditCheckout(
      tx as unknown as Prisma.TransactionClient,
      customerId,
      "audit@passport.test",
      "evt_audit_b"
    );

    expect(operatorUpdateMock).toHaveBeenCalledWith({
      where: { id: "op_db_audit" },
      data: {
        tier: "pro",
        credits: { increment: PRO_CREDITS },
        stakeBalanceCents: 5000,
      },
    });
    expect(createApiKeyMock).toHaveBeenCalledWith("op_db_audit", "default", tx);
    expect(result.apiKey).toMatch(/^pp_[0-9a-f]{64}$/);
    expect(result.expectedCredits).toBe(FREE_CREDITS + PRO_CREDITS);
  });

  it("treats duplicate stripe events as idempotent", async () => {
    const tx = makeTx();
    stripeEventCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const result = await provisionAuditCheckout(
      tx as unknown as Prisma.TransactionClient,
      "cus_live_audit_dup",
      "audit@passport.test",
      "evt_audit_dup"
    );

    expect(result.duplicate).toBe(true);
    expect(ensureOperatorMock).not.toHaveBeenCalled();
  });
});

describe("assertAuditProvisioning", () => {
  it("validates operator credits tier and API key presence", async () => {
    const tx = makeTx();
    await assertAuditProvisioning(
      tx as unknown as Prisma.TransactionClient,
      "cus_live_audit_test01"
    );

    expect(operatorFindUniqueMock).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_live_audit_test01" },
    });
    expect(apiKeyFindManyMock).toHaveBeenCalled();
  });

  it("throws when operator missing after provision", async () => {
    operatorFindUniqueMock.mockResolvedValueOnce(null);
    const tx = makeTx();
    await expect(
      assertAuditProvisioning(
        tx as unknown as Prisma.TransactionClient,
        "cus_live_audit_missing"
      )
    ).rejects.toThrow(/Operator not found/);
  });
});

describe("purgeAuditOperator", () => {
  it("forensically removes audit operator and stripe event rows", async () => {
    const tx = makeTx();
    await purgeAuditOperator(
      tx as unknown as Prisma.TransactionClient,
      "cus_live_audit_teardown",
      ["evt_audit_teardown"]
    );

    expect(receiptDeleteManyMock).toHaveBeenCalled();
    expect(apiKeyDeleteManyMock).toHaveBeenCalled();
    expect(stripeEventDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["evt_audit_teardown"] } },
    });
    expect(operatorDeleteMock).toHaveBeenCalledWith({
      where: { id: "op_db_audit" },
    });
  });
});
