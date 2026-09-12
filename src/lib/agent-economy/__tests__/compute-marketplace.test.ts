import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, spendMock } = vi.hoisted(() => ({
  prismaMock: {
    computeOffer: { findUnique: vi.fn(), updateMany: vi.fn() },
    computePurchase: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  spendMock: { checkSpendPolicy: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../spend-policy-service", () => ({ checkSpendPolicy: spendMock.checkSpendPolicy }));

import {
  quotePurchase,
  normalizeOfferInput,
  purchaseUnits,
  type CreateOfferInput,
} from "../compute-marketplace";

const BUYER = "a".repeat(64);
const PROVIDER = "b".repeat(64);

const OFFER = {
  id: "o1",
  offerId: "gpu-hours",
  providerCommitment: PROVIDER,
  capability: "llm.inference",
  description: null,
  unit: "1k_tokens",
  priceAngelPerUnit: 10,
  capacityUnits: 100,
  remainingUnits: 50,
  status: "ACTIVE",
};

function txMock(overrides: Record<string, unknown> = {}) {
  const tx = {
    computePurchase: { create: vi.fn().mockResolvedValue({ id: "p1" }) },
    agentWallet: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    computeOffer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  };
  return tx;
}

describe("compute marketplace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.computeOffer.findUnique.mockResolvedValue(OFFER);
    prismaMock.computeOffer.updateMany.mockResolvedValue({ count: 0 });
    spendMock.checkSpendPolicy.mockResolvedValue({ allowed: true });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txMock())
    );
  });

  it("quotePurchase multiplies price by units", () => {
    expect(quotePurchase(10, 5)).toEqual({ ok: true, totalAngel: 50 });
    expect(quotePurchase(10, 0).ok).toBe(false);
  });

  it("normalizeOfferInput validates the shape", () => {
    const good: CreateOfferInput = {
      offerId: "gpu-hours",
      providerCommitment: PROVIDER,
      capability: "llm.inference",
      priceAngelPerUnit: 10,
      capacityUnits: 100,
    };
    expect(normalizeOfferInput(good).ok).toBe(true);
    expect(normalizeOfferInput({ ...good, priceAngelPerUnit: 0 }).ok).toBe(false);
    expect(normalizeOfferInput({ ...good, capacityUnits: -1 }).ok).toBe(false);
    expect(normalizeOfferInput({ ...good, providerCommitment: "nope" }).ok).toBe(false);
  });

  it("rejects purchase of an unknown offer", async () => {
    prismaMock.computeOffer.findUnique.mockResolvedValue(null);
    const r = await purchaseUnits({ offerId: "x", buyerCommitment: BUYER, units: 1, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: false, code: "offer_not_found" });
  });

  it("rejects self-purchase", async () => {
    prismaMock.computeOffer.findUnique.mockResolvedValue({ ...OFFER, providerCommitment: BUYER });
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 1, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: false, code: "self_purchase" });
  });

  it("respects offer capacity", async () => {
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 999, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: false, code: "insufficient_capacity" });
  });

  it("enforces the buyer's spend policy", async () => {
    spendMock.checkSpendPolicy.mockResolvedValue({ allowed: false, reason: "over daily cap" });
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 2, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: false, code: "spend_policy_denied" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("settles a valid purchase atomically", async () => {
    const tx = txMock();
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 3, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: true, units: 3, totalAngel: 30, providerCommitment: PROVIDER, deduped: false });
    expect(tx.agentWallet.updateMany).toHaveBeenCalled();
    expect(tx.agentWallet.upsert).toHaveBeenCalled();
    expect(tx.computeOffer.updateMany).toHaveBeenCalled();
  });

  it("returns insufficient_balance when the debit matches no wallet", async () => {
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(txMock({ agentWallet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn() } }))
    );
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 3, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: false, code: "insufficient_balance" });
  });

  it("is idempotent: a duplicate purchaseId returns the original", async () => {
    const dupErr = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
      fn(txMock({ computePurchase: { create: vi.fn().mockRejectedValue(dupErr) } }))
    );
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      units: 3,
      totalAngel: 30,
      providerCommitment: PROVIDER,
    });
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 3, purchaseId: "p1" });
    expect(r).toMatchObject({ ok: true, deduped: true, units: 3, totalAngel: 30 });
  });
});