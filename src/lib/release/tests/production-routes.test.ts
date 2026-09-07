import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    agentWallet: { findMany: vi.fn() },
    operatorLedgerEntry: { findMany: vi.fn() },
    commodityReserve: { findMany: vi.fn(), upsert: vi.fn() },
    vaultBatch: { findMany: vi.fn(), count: vi.fn() },
    sovereignDisbursement: { findMany: vi.fn() },
    artisanalBuyingStation: { findMany: vi.fn() },
    oreIntakeReceipt: { findMany: vi.fn() },
    sovereignQuorumProposal: { findMany: vi.fn(), findFirst: vi.fn() },
    sovereignStateHeartbeat: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { GET as getHealth } from "@/app/api/health/route";
import { GET as getPublicKey } from "@/app/api/v1/public-key/route";
import { GET as getRate } from "@/app/api/v1/rate/route";
import { GET as getPoR } from "@/app/api/v1/reserves/por/route";
import { GET as getVaults } from "@/app/api/v1/reserves/vaults/route";
import { GET as getState } from "@/app/api/v1/reserves/state/route";
import { GET as getDividends } from "@/app/api/v1/reserves/dividends/route";
import { GET as getStations } from "@/app/api/v1/reserves/artisanal/stations/route";
import { GET as getProposals } from "@/app/api/v1/reserves/quorum/proposals/route";

describe("Production Route Integration & Pre-Flight Probe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    prismaMock.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    prismaMock.agentWallet.findMany.mockResolvedValue([]);
    prismaMock.operatorLedgerEntry.findMany.mockResolvedValue([]);
    prismaMock.commodityReserve.findMany.mockResolvedValue([]);
    prismaMock.vaultBatch.findMany.mockResolvedValue([]);
    prismaMock.vaultBatch.count.mockResolvedValue(0);
    prismaMock.sovereignDisbursement.findMany.mockResolvedValue([]);
    prismaMock.artisanalBuyingStation.findMany.mockResolvedValue([]);
    prismaMock.oreIntakeReceipt.findMany.mockResolvedValue([]);
    prismaMock.sovereignQuorumProposal.findMany.mockResolvedValue([]);
    prismaMock.sovereignQuorumProposal.findFirst.mockResolvedValue(null);
    prismaMock.sovereignStateHeartbeat.findMany.mockResolvedValue([]);
  });

  it("1. GET /api/health returns 200 { status: 'ok' }", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("2. GET /api/v1/public-key returns 200 with Ed25519 key material", async () => {
    const res = await getPublicKey();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.algorithm).toBe("ed25519");
    expect(data.public_key).toBeTruthy();
  });

  it("3. GET /api/v1/rate returns 200 with signed reserve rate state", async () => {
    const res = await getRate();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rate.price_usd).toBe(5.0);
    expect(data.signature.algorithm).toBe("ed25519");
  });

  it("4. GET /api/v1/reserves/por returns 200 with physical PoR attestation", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/por?commodity=GOLD");
    const res = await getPoR(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reserve.commodity_type).toBe("GOLD");
  });

  it("5. GET /api/v1/reserves/vaults returns 200 with vault registry", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/vaults");
    const res = await getVaults(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("6. GET /api/v1/reserves/state returns 200 with Dual-State regime status", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/state");
    const res = await getState(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(["SOLID", "GHOST"]).toContain(data.regime);
  });

  it("7. GET /api/v1/reserves/dividends returns 200 with macroeconomic dividend metrics", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/dividends");
    const res = await getDividends(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.totals).toBeDefined();
  });

  it("8. GET /api/v1/reserves/artisanal/stations returns 200 with buying stations", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/artisanal/stations");
    const res = await getStations(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("9. GET /api/v1/reserves/quorum/proposals returns 200 with governance proposals", async () => {
    const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/proposals");
    const res = await getProposals(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
