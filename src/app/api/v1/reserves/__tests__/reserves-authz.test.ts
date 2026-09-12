import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authenticateApiKey: vi.fn(),
    agentFindFirst: vi.fn(),
    executePoolSwap: vi.fn(),
    fractionalizeVaultBatch: vi.fn(),
    createCommodityEscrow: vi.fn(),
    releaseEscrowOnAssay: vi.fn(),
    refundEscrowOnTimeout: vi.fn(),
    getEscrow: vi.fn(),
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 60 })),
  clientIpFromRequest: () => "127.0.0.1",
  rateLimitResponse: (_r: unknown, n: number) => ({ "Retry-After": String(n) }),
}));
vi.mock("@/lib/operator", () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock("@/lib/db", () => ({ prisma: { agent: { findFirst: mocks.agentFindFirst } } }));
vi.mock("@/lib/reserves/fractional-amm", () => ({
  executePoolSwap: mocks.executePoolSwap,
  fractionalizeVaultBatch: mocks.fractionalizeVaultBatch,
}));
vi.mock("@/lib/reserves/rwa-escrow", () => ({
  createCommodityEscrow: mocks.createCommodityEscrow,
  releaseEscrowOnAssay: mocks.releaseEscrowOnAssay,
  refundEscrowOnTimeout: mocks.refundEscrowOnTimeout,
  getEscrow: mocks.getEscrow,
}));

const COMMITMENT = "a".repeat(64);

function post(path: string, body: unknown, auth?: string) {
  return new NextRequest(`https://passport.metis.gold${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: auth } : {}),
    },
  });
}

describe("reserves value-route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    mocks.agentFindFirst.mockResolvedValue(null);
  });

  describe("AMM swap", () => {
    it("rejects an unauthenticated caller", async () => {
      const { POST } = await import("@/app/api/v1/reserves/amm/swap/route");
      mocks.authenticateApiKey.mockResolvedValue(null);
      const res = await POST(
        post("/api/v1/reserves/amm/swap", {
          pool_id: "POOL-ANGEL-MAU-GOLD",
          agent_commitment: COMMITMENT,
          input_token: "ANGEL",
          input_amount: 10,
        })
      );
      expect(res.status).toBe(401);
      expect(mocks.executePoolSwap).not.toHaveBeenCalled();
    });

    it("rejects a HOLDER acting on a commitment it does not own", async () => {
      const { POST } = await import("@/app/api/v1/reserves/amm/swap/route");
      const res = await POST(
        post("/api/v1/reserves/amm/swap", {
          pool_id: "POOL-ANGEL-MAU-GOLD",
          agent_commitment: COMMITMENT,
          input_token: "ANGEL",
          input_amount: 10,
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(403);
      expect(mocks.executePoolSwap).not.toHaveBeenCalled();
    });

    it("allows a HOLDER that owns the commitment", async () => {
      const { POST } = await import("@/app/api/v1/reserves/amm/swap/route");
      mocks.agentFindFirst.mockResolvedValue({ id: "agent_1" });
      mocks.executePoolSwap.mockResolvedValue({
        receipt: { swapId: "sw_1", agentCommitment: COMMITMENT },
        poolId: "POOL-ANGEL-MAU-GOLD",
        inputToken: "ANGEL",
        inputAmount: 10,
        outputToken: "MAU",
        outputAmount: 100,
        feeAngel: 1,
        regime: "SOLID",
        effectivePriceUsd: 75,
        deviationPct: 0,
      });
      const res = await POST(
        post("/api/v1/reserves/amm/swap", {
          pool_id: "POOL-ANGEL-MAU-GOLD",
          agent_commitment: COMMITMENT,
          input_token: "ANGEL",
          input_amount: 10,
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(200);
      expect(mocks.executePoolSwap).toHaveBeenCalledOnce();
    });

    it("allows an ISSUER key without an ownership lookup", async () => {
      const { POST } = await import("@/app/api/v1/reserves/amm/swap/route");
      mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "ISSUER" });
      mocks.executePoolSwap.mockResolvedValue({
        receipt: { swapId: "sw_1", agentCommitment: COMMITMENT },
        poolId: "p", inputToken: "ANGEL", inputAmount: 10,
        outputToken: "MAU", outputAmount: 100, feeAngel: 1,
        regime: "SOLID", effectivePriceUsd: 75, deviationPct: 0,
      });
      const res = await POST(
        post("/api/v1/reserves/amm/swap", {
          pool_id: "POOL-ANGEL-MAU-GOLD",
          agent_commitment: COMMITMENT,
          input_token: "ANGEL",
          input_amount: 10,
        }, "Bearer pp_ent_x")
      );
      expect(res.status).toBe(200);
      expect(mocks.agentFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("AMM fractionalize", () => {
    it("rejects a HOLDER acting on a commitment it does not own", async () => {
      const { POST } = await import("@/app/api/v1/reserves/amm/fractionalize/route");
      const res = await POST(
        post("/api/v1/reserves/amm/fractionalize", {
          batch_number: "BATCH-1",
          depositor_commitment: COMMITMENT,
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(403);
      expect(mocks.fractionalizeVaultBatch).not.toHaveBeenCalled();
    });
  });

  describe("escrow", () => {
    it("rejects a HOLDER creating an escrow funded by someone else", async () => {
      const { POST } = await import("@/app/api/v1/reserves/escrow/route");
      const res = await POST(
        post("/api/v1/reserves/escrow", {
          action: "create",
          escrow_id: "e1",
          buyer_commitment: COMMITMENT,
          seller_commitment: "b".repeat(64),
          batch_number: "BATCH-1",
          fine_grams: 100,
          unit_price_usd: 75,
          locked_angel: 1000,
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(403);
      expect(mocks.createCommodityEscrow).not.toHaveBeenCalled();
    });

    it("rejects a HOLDER releasing an escrow it is not a party to", async () => {
      const { POST } = await import("@/app/api/v1/reserves/escrow/route");
      mocks.getEscrow.mockResolvedValue({
        escrowId: "e1",
        buyerCommitment: "c".repeat(64),
        sellerCommitment: "d".repeat(64),
      });
      const res = await POST(
        post("/api/v1/reserves/escrow", {
          action: "release",
          escrow_id: "e1",
          assay_certification_number: "ASSAY-1",
          release_signature: "not-empty",
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(403);
      expect(mocks.releaseEscrowOnAssay).not.toHaveBeenCalled();
    });

    it("allows an ISSUER to release any escrow", async () => {
      const { POST } = await import("@/app/api/v1/reserves/escrow/route");
      mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "ISSUER" });
      mocks.releaseEscrowOnAssay.mockResolvedValue({ escrowId: "e1", status: "RELEASED" });
      const res = await POST(
        post("/api/v1/reserves/escrow", {
          action: "release",
          escrow_id: "e1",
          assay_certification_number: "ASSAY-1",
          release_signature: "x",
        }, "Bearer pp_ent_x")
      );
      expect(res.status).toBe(200);
      expect(mocks.releaseEscrowOnAssay).toHaveBeenCalledOnce();
    });
  });

  describe("assays ingestion", () => {
    it("rejects a HOLDER (only ISSUER may ingest assay certifications)", async () => {
      const { POST } = await import("@/app/api/v1/reserves/assays/route");
      const res = await POST(
        post("/api/v1/reserves/assays", {
          certification_number: "A1",
          assayer_name: "Lab",
          assayer_public_key: COMMITMENT,
          batch_number: "BATCH-1",
          purity_fineness: 0.99,
          gross_grams: 100,
          sample_signature: "sig",
        }, "Bearer pp_usr_x")
      );
      expect(res.status).toBe(401);
    });
  });
});
