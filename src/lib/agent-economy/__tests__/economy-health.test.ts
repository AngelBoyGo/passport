import { describe, it, expect, vi, beforeEach } from "vitest";
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentWallet: { findMany: vi.fn() },
    operatorLedgerEntry: { findMany: vi.fn() },
    agentRevenue: { findMany: vi.fn() },
    computePurchase: { findMany: vi.fn() },
    engagement: { findMany: vi.fn() },
    computeDispute: { findMany: vi.fn() },
    agentCapability: { findMany: vi.fn() },
    computeOffer: { findMany: vi.fn() },
    pipelineJob: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { computeEconomyHealth, buildEconomyHealth, type EconomyHealthInput } from "../economy-health";
import { canonicalJson, sha256Hex } from "../../receipt/canonical";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const recent = new Date(NOW.getTime() - 5 * 86400000);

function empty(): EconomyHealthInput {
  return { wallets: [], reserveEntries: [], revenue: [], purchases: [], engagements: [], disputes: [], capabilities: [], offers: [], jobs: [] };
}

describe("economy health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes supply, reserve, coverage, external share and velocity", () => {
    const input = empty();
    input.wallets = [{ balance: 100, staked: 20 }, { balance: 50, staked: 0 }];
    input.reserveEntries = [{ deltaMicros: 500_000_000 }, { deltaMicros: 250_000_000 }]; // $500 + $250
    input.revenue = [{ grossUsdCents: 10_000 }, { grossUsdCents: 5_000 }]; // $100 + $50
    input.purchases = [{ totalAngel: 30, status: "SETTLED", createdAt: recent, verificationVerdict: "APPROVE" }];
    input.engagements = [{ amount: 20, createdAt: recent, status: "PAID" }];

    const h = computeEconomyHealth(input, NOW);
    expect(h.supply_angel).toBe(150);
    expect(h.staked_angel).toBe(20);
    expect(h.reserve_usd).toBe(750);
    expect(h.coverage_ratio).toBe(1); // 750 / (150*5)
    expect(h.external_revenue_usd).toBe(150);
    expect(h.external_reserve_share).toBe(0.2); // 150/750
    expect(h.settled_volume_angel_30d).toBe(50); // 30 + 20
    expect(h.velocity_30d).toBeCloseTo(0.3333, 3);
    expect(h.verifications).toBe(1);
  });

  it("counts disputes, capabilities, offers and pipeline jobs", () => {
    const input = empty();
    input.disputes = [{ status: "OPEN" }, { status: "RESOLVED" }, { status: "RESOLVED" }];
    input.capabilities = [{ active: true, verified: true }, { active: true, verified: false }, { active: false, verified: true }];
    input.offers = [{ status: "ACTIVE", remainingUnits: 5 }, { status: "ACTIVE", remainingUnits: 0 }, { status: "EXHAUSTED", remainingUnits: 0 }];
    input.jobs = [{ status: "SUBMITTED" }, { status: "SOLD" }, { status: "SOLD" }];
    const h = computeEconomyHealth(input, NOW);
    expect(h.disputes).toEqual({ open: 1, resolved: 2 });
    expect(h.capabilities).toEqual({ declared: 2, verified: 1 });
    expect(h.compute_offers_active).toBe(1);
    expect(h.pipeline_jobs).toEqual({ submitted: 1, sold: 2 });
  });

  it("signs the health report and verifies offline", async () => {
    for (const model of Object.values(prismaMock)) model.findMany.mockResolvedValue([]);
    const res = await buildEconomyHealth(NOW);
    const { snapshot, ...signed } = res;
    const recomputed = sha256Hex(canonicalJson(signed as unknown as Record<string, unknown>));
    expect(recomputed).toBe(snapshot.content_hash);
    const valid = verify(hexToBytes(snapshot.signature), utf8ToBytes(recomputed), hexToBytes(snapshot.public_key));
    expect(valid).toBe(true);
  });

  it("degrades gracefully when a table read fails", async () => {
    for (const model of Object.values(prismaMock)) model.findMany.mockResolvedValue([]);
    prismaMock.agentWallet.findMany.mockRejectedValue(new Error("db down"));
    const res = await buildEconomyHealth(NOW);
    expect(res.degraded).toBe(true);
    expect(res.degraded_reasons.join(" ")).toContain("agentWallet: db down");
  });
});