import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, spendMock } = vi.hoisted(() => ({
  prismaMock: {
    computeOffer: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    computePurchase: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  spendMock: { checkSpendPolicy: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../spend-policy-service", () => ({ checkSpendPolicy: spendMock.checkSpendPolicy }));
vi.mock("@/lib/reputation/agent-reputation", () => ({
  computeReputationBatch: vi.fn(async () => new Map()),
}));

import {
  quotePurchase,
  normalizeOfferInput,
  purchaseUnits,
  deliverCompute,
  releaseCompute,
  refundCompute,
  listOffers,
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
    computePurchase: {
      create: vi.fn().mockResolvedValue({ id: "p1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentWallet: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    computeOffer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}) },
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

  it("holds funds on purchase (escrow): debits buyer, consumes capacity, does NOT pay provider", async () => {
    const tx = txMock();
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const r = await purchaseUnits({ offerId: "gpu-hours", buyerCommitment: BUYER, units: 3, purchaseId: "p1" });
    expect(r).toMatchObject({
      ok: true,
      units: 3,
      totalAngel: 30,
      providerCommitment: PROVIDER,
      status: "HELD",
      deduped: false,
    });
    expect(tx.agentWallet.updateMany).toHaveBeenCalled(); // debited buyer
    expect(tx.agentWallet.upsert).not.toHaveBeenCalled(); // provider NOT paid yet
    expect(tx.computeOffer.updateMany).toHaveBeenCalled(); // capacity consumed
  });

  it("deliver then release pays the provider; release before delivery is refused", async () => {
    const tx = txMock();
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      purchaseId: "p1", offerId: "gpu-hours", buyerCommitment: BUYER, providerCommitment: PROVIDER,
      units: 3, totalAngel: 30, status: "HELD",
    });

    // release while HELD → the status guard matches no row → invalid_state
    tx.computePurchase.updateMany.mockResolvedValueOnce({ count: 0 });
    const early = await releaseCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: false });
    expect(early).toMatchObject({ ok: false, code: "invalid_state" });

    // provider delivers (prisma-level guarded update)
    prismaMock.computePurchase.updateMany.mockResolvedValue({ count: 1 });
    const delivered = await deliverCompute({ purchaseId: "p1", providerCommitment: PROVIDER });
    expect(delivered).toMatchObject({ ok: true, status: "DELIVERED" });

    // now release (DELIVERED)
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      purchaseId: "p1", offerId: "gpu-hours", buyerCommitment: BUYER, providerCommitment: PROVIDER,
      units: 3, totalAngel: 30, status: "DELIVERED",
    });
    const released = await releaseCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: false });
    expect(released).toMatchObject({ ok: true, status: "SETTLED" });
    expect(tx.agentWallet.upsert).toHaveBeenCalled();
  });

  it("refunds to the buyer and restores offer capacity", async () => {
    const tx = txMock();
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      purchaseId: "p1", offerId: "gpu-hours", buyerCommitment: BUYER, providerCommitment: PROVIDER,
      units: 3, totalAngel: 30, status: "HELD",
    });
    prismaMock.computePurchase.updateMany.mockResolvedValue({ count: 1 });
    const r = await refundCompute({ purchaseId: "p1", actorCommitment: BUYER, isIssuer: false });
    expect(r).toMatchObject({ ok: true, status: "REFUNDED" });
    expect(tx.computeOffer.update).toHaveBeenCalled(); // capacity restored
  });

  it("applies a juror settlement: pays provider net, rewards majority, slashes minority", async () => {
    const tx = txMock();
    prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      purchaseId: "p1", offerId: "gpu-hours", buyerCommitment: BUYER, providerCommitment: PROVIDER,
      units: 3, totalAngel: 30, status: "DELIVERED",
    });
    const r = await releaseCompute({
      purchaseId: "p1", actorCommitment: BUYER, isIssuer: true, force: true,
      settlement: { jurorRewards: [{ commitment: "j1", amount: 1 }], slashes: [{ commitment: "m1", amount: 1 }] },
    });
    expect(r).toMatchObject({ ok: true, status: "SETTLED" });
    const providerCall = tx.agentWallet.upsert.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { subjectCommitment: string } }).where.subjectCommitment === PROVIDER
    );
    expect((providerCall![0] as { update: { balance: { increment: number } } }).update.balance.increment).toBe(29);
    expect(tx.agentWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subjectCommitment: "m1", staked: { gte: 1 } } })
    );
  });

  it("only the provider may deliver; only a party may release", async () => {
    prismaMock.computePurchase.findUnique.mockResolvedValue({
      purchaseId: "p1", offerId: "gpu-hours", buyerCommitment: BUYER, providerCommitment: PROVIDER,
      units: 3, totalAngel: 30, status: "HELD",
    });
    expect(await deliverCompute({ purchaseId: "p1", providerCommitment: BUYER })).toMatchObject({
      ok: false, code: "not_provider",
    });
    expect(await releaseCompute({ purchaseId: "p1", actorCommitment: "c".repeat(64), isIssuer: false })).toMatchObject({
      ok: false, code: "not_party",
    });
  });

  it("listOffers ranks by provider reputation then price", async () => {
    const { computeReputationBatch } = await import("@/lib/reputation/agent-reputation");
    (computeReputationBatch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([[PROVIDER, { score: 700, tier: "platinum", tierLabel: "Platinum" }]])
    );
    prismaMock.computeOffer.findMany = vi.fn().mockResolvedValue([
      { ...OFFER, offerId: "a", providerCommitment: PROVIDER, priceAngelPerUnit: 20 },
      { ...OFFER, offerId: "b", providerCommitment: "c".repeat(64), priceAngelPerUnit: 1 },
    ]);
    const offers = await listOffers({});
    expect(offers[0].offerId).toBe("a"); // higher reputation wins despite higher price
    expect(offers[0].provider_reputation_score).toBe(700);
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