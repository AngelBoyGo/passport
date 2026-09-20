import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    receipt: {
      findMany: vi.fn(),
    },
    webhookSubscription: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    agentEnrollment: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    agentEvidence: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    agentWallet: {
      findMany: vi.fn(),
    },
    commodityReserve: {
      findMany: vi.fn(),
    },
    vaultBatch: {
      groupBy: vi.fn(),
    },
    commodityEscrow: {
      groupBy: vi.fn(),
    },
    railSpec: {
      groupBy: vi.fn(),
    },
    commodityLiquidityPool: {
      findMany: vi.fn(),
    },
    ammSwapReceipt: {
      count: vi.fn(),
    },
    computeOffer: {
      groupBy: vi.fn(),
    },
    computePurchase: {
      groupBy: vi.fn(),
    },
    computeDispute: {
      groupBy: vi.fn(),
    },
    agentRevenue: {
      aggregate: vi.fn(),
    },
    pipelineJob: {
      groupBy: vi.fn(),
    },
    sovereignDisbursement: {
      aggregate: vi.fn(),
    },
  },
}));

const sessionFromRequestMock = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/cookies", () => ({
  sessionFromRequest: (...args: unknown[]) => sessionFromRequestMock(...args),
}));

describe("Session-Authenticated Admin Routes", () => {
  const operatorSession = {
    operator: {
      id: "op_session_123",
      email: "operator@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionFromRequestMock.mockReset();
  });

  describe("GET /api/admin/api-keys", () => {
    it("returns 401 when not authenticated via session", async () => {
      sessionFromRequestMock.mockResolvedValue(null);
      const { GET } = await import("@/app/api/admin/api-keys/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/api-keys"));
      expect(res.status).toBe(401);
    });

    it("returns operator API keys when session is valid", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.apiKey.findMany.mockResolvedValue([
        { id: "k1", keyHash: "hash1", name: "Default Key", createdAt: new Date() },
      ]);

      const { GET } = await import("@/app/api/admin/api-keys/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/api-keys"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Default Key");
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { operatorId: "op_session_123" } })
      );
    });
  });

  describe("GET /api/admin/receipts", () => {
    it("returns receipts scoped to authenticated operator session", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.receipt.findMany.mockResolvedValue([
        { receiptId: "rcpt_test", status: "success", issuedAt: new Date() },
      ]);

      const { GET } = await import("@/app/api/admin/receipts/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/receipts"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(prismaMock.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ operatorId: "op_session_123" }) })
      );
    });
  });

  describe("GET /api/admin/passports", () => {
    it("returns 401 when not authenticated via session", async () => {
      sessionFromRequestMock.mockResolvedValue(null);
      const { GET } = await import("@/app/api/admin/passports/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/passports"));
      expect(res.status).toBe(401);
    });

    it("returns passports with counts when session is valid", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.agentEnrollment.count.mockResolvedValue(5);
      prismaMock.agentEnrollment.findMany.mockResolvedValue([
        {
          id: "enr_1",
          subjectCommitment: "a".repeat(64),
          publicKey: "key_1",
          context: "Test Agent",
          status: "ISSUED",
          issuedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          photoUrl: null,
        },
      ]);
      prismaMock.agentEvidence.groupBy.mockResolvedValue([
        { agentIdentityCommitment: "a".repeat(64), _count: { _all: 12 } },
      ]);

      const { GET } = await import("@/app/api/admin/passports/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/passports"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.passports).toHaveLength(1);
      expect(data.passports[0].evidenceCount).toBe(12);
    });
  });

  describe("GET /api/admin/evidence", () => {
    it("returns 401 when not authenticated via session", async () => {
      sessionFromRequestMock.mockResolvedValue(null);
      const { GET } = await import("@/app/api/admin/evidence/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/evidence"));
      expect(res.status).toBe(401);
    });

    it("returns observed evidence records when session is valid", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.agentEvidence.count.mockResolvedValue(1);
      prismaMock.agentEvidence.findMany.mockResolvedValue([
        {
          id: "ev_1",
          sourceType: "otel_genai_trace",
          artifactType: "trace",
          normalizedEventType: "AGENT_RUN_OBSERVED",
          rawErrorClassification: null,
          observedAt: new Date(),
          agentIdentityCommitment: "b".repeat(64),
          eventCommitmentHash: "hash_123",
          validationSignalPresent: true,
          tokenUsageInput: 100,
          tokenUsageOutput: 50,
          toolCallCount: 1,
          externalTaskId: "task_1",
          commitSha: null,
        },
      ]);
      prismaMock.agentEvidence.groupBy.mockResolvedValue([]);

      const { GET } = await import("@/app/api/admin/evidence/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/evidence"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evidence).toHaveLength(1);
      expect(data.evidence[0].eventCommitmentHash).toBe("hash_123");
    });
  });

  describe("GET /api/admin/economy", () => {
    it("returns 401 when not authenticated via session", async () => {
      sessionFromRequestMock.mockResolvedValue(null);
      const { GET } = await import("@/app/api/admin/economy/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/economy"));
      expect(res.status).toBe(401);
    });

    it("returns deep economy telemetry when session is valid", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.agentWallet.findMany.mockResolvedValue([
        {
          subjectCommitment: "a".repeat(64),
          balance: 1000,
          staked: 200,
          earnedTotal: 1500,
          spentTotal: 500,
          lastActivityAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      prismaMock.commodityReserve.findMany.mockResolvedValue([
        { totalFineGrams: 5000, activeLotsCount: 3, batches: [] },
      ]);
      prismaMock.vaultBatch.groupBy.mockResolvedValue([]);
      prismaMock.commodityEscrow.groupBy.mockResolvedValue([]);
      prismaMock.railSpec.groupBy.mockResolvedValue([{ state: "ENABLED", _count: { _all: 4 } }]);
      prismaMock.commodityLiquidityPool.findMany.mockResolvedValue([]);
      prismaMock.ammSwapReceipt.count.mockResolvedValue(10);
      prismaMock.computeOffer.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 2 } }]);
      prismaMock.computePurchase.groupBy.mockResolvedValue([]);
      prismaMock.computeDispute.groupBy.mockResolvedValue([]);
      prismaMock.agentRevenue.aggregate.mockResolvedValue({ _sum: { grossUsdCents: 50000, angelCredited: 100 }, _count: { _all: 5 } });
      prismaMock.pipelineJob.groupBy.mockResolvedValue([]);
      prismaMock.sovereignDisbursement.aggregate.mockResolvedValue({ _sum: { totalFeeAngel: 350, treasuryStabilizationAngel: 100, validatorPoolAngel: 50 }, _count: { _all: 2 } });

      const { GET } = await import("@/app/api/admin/economy/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/economy"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.currency.pegUsd).toBe(5.0);
      expect(data.currency.total_supply).toBe(1000);
      expect(data.reserves.total_fine_grams_gold).toBe(5000);
      expect(data.rails.enabled).toBe(4);
      expect(data.marketplace.external_revenue_usd).toBe(500);
    });
  });
});
