import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentSpendPolicy: { findUnique: vi.fn(), upsert: vi.fn() },
    engagement: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  getSpendPolicy,
  setSpendPolicy,
  getRollingSpend,
  checkSpendPolicy,
} from "../spend-policy-service";

const AGENT = "a".repeat(64);

describe("spend-policy service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a permissive default when no policy row exists", async () => {
    prismaMock.agentSpendPolicy.findUnique.mockResolvedValue(null);
    const p = await getSpendPolicy(AGENT);
    expect(p.agentCommitment).toBe(AGENT);
    expect(p.enabled).toBe(true);
    expect(p.perTxMaxAngel).toBe(0);
  });

  it("normalizes a stored policy row", async () => {
    prismaMock.agentSpendPolicy.findUnique.mockResolvedValue({
      agentCommitment: AGENT,
      enabled: true,
      perTxMaxAngel: 50,
      dailyMaxAngel: 100,
      weeklyMaxAngel: 500,
      counterpartyAllowlist: ["b".repeat(64)],
      domainAllowlist: ["CODE_GENERATION"],
    });
    const p = await getSpendPolicy(AGENT);
    expect(p.perTxMaxAngel).toBe(50);
    expect(p.counterpartyAllowlist).toEqual(["b".repeat(64)]);
  });

  it("upserts a normalized policy on set", async () => {
    prismaMock.agentSpendPolicy.upsert.mockImplementation(
      async (args: { create: unknown }) => args.create
    );
    const p = await setSpendPolicy(
      AGENT,
      { perTxMaxAngel: 25, dailyMaxAngel: 100, domainAllowlist: ["CODE_GENERATION"] },
      "op_1"
    );
    expect(p.perTxMaxAngel).toBe(25);
    const call = prismaMock.agentSpendPolicy.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ agentCommitment: AGENT });
    expect(call.create.updatedBy).toBe("op_1");
  });

  it("derives rolling spend from engagement rows (today vs week)", async () => {
    const now = new Date("2026-06-17T12:00:00.000Z");
    prismaMock.engagement.findMany.mockResolvedValue([
      { amount: 30, createdAt: new Date("2026-06-17T09:00:00.000Z") }, // today
      { amount: 70, createdAt: new Date("2026-06-15T09:00:00.000Z") }, // this week, not today
    ]);
    const spend = await getRollingSpend(AGENT, now);
    expect(spend.spentToday).toBe(30);
    expect(spend.spentThisWeek).toBe(100);
  });

  it("checkSpendPolicy denies when the rolling daily cap is exceeded", async () => {
    prismaMock.agentSpendPolicy.findUnique.mockResolvedValue({
      agentCommitment: AGENT,
      enabled: true,
      perTxMaxAngel: 0,
      dailyMaxAngel: 100,
      weeklyMaxAngel: 0,
      counterpartyAllowlist: null,
      domainAllowlist: null,
    });
    prismaMock.engagement.findMany.mockResolvedValue([
      { amount: 90, createdAt: new Date() },
    ]);
    const d = await checkSpendPolicy({ agentCommitment: AGENT, amount: 20 });
    expect(d).toMatchObject({ allowed: false, code: "daily_exceeded" });
  });

  it("checkSpendPolicy allows a spend within caps", async () => {
    prismaMock.agentSpendPolicy.findUnique.mockResolvedValue({
      agentCommitment: AGENT,
      enabled: true,
      perTxMaxAngel: 100,
      dailyMaxAngel: 100,
      weeklyMaxAngel: 0,
      counterpartyAllowlist: null,
      domainAllowlist: null,
    });
    prismaMock.engagement.findMany.mockResolvedValue([]);
    const d = await checkSpendPolicy({ agentCommitment: AGENT, amount: 50 });
    expect(d.allowed).toBe(true);
  });
});
