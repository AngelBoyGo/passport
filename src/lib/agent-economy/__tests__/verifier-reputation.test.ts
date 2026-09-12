import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { computePurchase: { findMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { computeVerifierStats } from "../verifier-reputation";

const V = "c".repeat(64);

describe("verifier reputation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null accuracy with no history and treats the verifier as reliable", async () => {
    prismaMock.computePurchase.findMany.mockResolvedValue([]);
    const s = await computeVerifierStats(V);
    expect(s).toMatchObject({ verdicts: 0, resolved: 0, accuracy: null, reliable: true });
  });

  it("computes accuracy from verdict/outcome agreement", async () => {
    prismaMock.computePurchase.findMany.mockResolvedValue([
      { verificationVerdict: "APPROVE", status: "SETTLED" },
      { verificationVerdict: "APPROVE", status: "SETTLED" },
      { verificationVerdict: "REJECT", status: "REFUNDED" },
      { verificationVerdict: "REJECT", status: "REFUNDED" },
      { verificationVerdict: "APPROVE", status: "SETTLED" },
    ]);
    const s = await computeVerifierStats(V);
    expect(s).toMatchObject({ verdicts: 5, resolved: 5, correct: 5, accuracy: 1, reliable: true });
  });

  it("flags a poor track record as unreliable once past the sample threshold", async () => {
    prismaMock.computePurchase.findMany.mockResolvedValue([
      { verificationVerdict: "APPROVE", status: "REFUNDED" }, // wrong
      { verificationVerdict: "APPROVE", status: "REFUNDED" }, // wrong
      { verificationVerdict: "APPROVE", status: "REFUNDED" }, // wrong
      { verificationVerdict: "REJECT", status: "SETTLED" }, // wrong
      { verificationVerdict: "APPROVE", status: "SETTLED" }, // correct
    ]);
    const s = await computeVerifierStats(V);
    expect(s.accuracy).toBeCloseTo(0.2, 5);
    expect(s.reliable).toBe(false);
  });

  it("does not penalize a verifier below the sample threshold", async () => {
    prismaMock.computePurchase.findMany.mockResolvedValue([
      { verificationVerdict: "APPROVE", status: "REFUNDED" },
      { verificationVerdict: "APPROVE", status: "REFUNDED" },
    ]);
    const s = await computeVerifierStats(V);
    expect(s.accuracy).toBe(0);
    expect(s.reliable).toBe(true); // only 2 resolved < MIN_VERIFIER_SAMPLE
  });
});
