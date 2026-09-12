import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agent: { findFirst: vi.fn() },
    agentRevenue: { findUnique: vi.fn(), create: vi.fn() },
    agentWallet: { upsert: vi.fn() },
    operatorLedgerEntry: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  usdCentsToAngel,
  computeRevenueSignature,
  verifyRevenueSignature,
  creditExternalRevenue,
} from "../revenue-bridge";

const AGENT = "a".repeat(64);

describe("external revenue bridge", () => {
  const fields = { agentCommitment: AGENT, source: "data_pipeline", externalRef: "inv_1", grossUsdCents: 500 };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.agent.findFirst.mockResolvedValue({ operatorId: "op_1" });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        agentRevenue: { create: vi.fn().mockResolvedValue({ id: "rev_1", grossUsdCents: 500, angelCredited: 1 }) },
        agentWallet: { upsert: vi.fn() },
        operatorLedgerEntry: { create: vi.fn() },
      })
    );
    delete process.env.REVENUE_BRIDGE_SECRET;
  });

  it("converts USD cents to whole ANGEL at parity", () => {
    expect(usdCentsToAngel(500)).toBe(1); // $5 = 1 ANGEL at $5 parity
    expect(usdCentsToAngel(499)).toBe(0);
    expect(usdCentsToAngel(1500)).toBe(3);
  });

  it("computes and verifies a signature over the canonical fields", () => {
    const sig = computeRevenueSignature(fields, "secret");
    expect(verifyRevenueSignature(fields, sig, "secret")).toBe(true);
    expect(verifyRevenueSignature({ ...fields, grossUsdCents: 999 }, sig, "secret")).toBe(false);
    expect(verifyRevenueSignature(fields, sig, "other-secret")).toBe(false);
  });

  it("credits an agent when trusted (ISSUER), recording reserve inflow", async () => {
    const r = await creditExternalRevenue(fields, { trusted: true });
    expect(r).toMatchObject({ ok: true, angelCredited: 1, grossUsdCents: 500, deduped: false });
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("requires the secret and a valid signature when not trusted", async () => {
    const noSecret = await creditExternalRevenue(fields, { trusted: false });
    expect(noSecret).toMatchObject({ ok: false, code: "not_configured" });

    process.env.REVENUE_BRIDGE_SECRET = "secret";
    const bad = await creditExternalRevenue({ ...fields, signature: "00" }, { trusted: false });
    expect(bad).toMatchObject({ ok: false, code: "invalid_signature" });

    const good = await creditExternalRevenue(
      { ...fields, signature: computeRevenueSignature(fields, "secret") },
      { trusted: false }
    );
    expect(good).toMatchObject({ ok: true });
  });

  it("is idempotent: a duplicate external_ref returns the original", async () => {
    const dup = Object.assign(new Error("Unique"), { code: "P2002" });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ agentRevenue: { create: vi.fn().mockRejectedValue(dup) }, agentWallet: { upsert: vi.fn() }, operatorLedgerEntry: { create: vi.fn() } })
    );
    prismaMock.agentRevenue.findUnique.mockResolvedValue({ id: "rev_1", grossUsdCents: 500, angelCredited: 1 });
    const r = await creditExternalRevenue(fields, { trusted: true });
    expect(r).toMatchObject({ ok: true, deduped: true, angelCredited: 1 });
  });

  it("rejects revenue below the 1 ANGEL floor", async () => {
    const r = await creditExternalRevenue({ ...fields, grossUsdCents: 100 }, { trusted: true });
    expect(r).toMatchObject({ ok: false, code: "below_floor" });
  });
});
