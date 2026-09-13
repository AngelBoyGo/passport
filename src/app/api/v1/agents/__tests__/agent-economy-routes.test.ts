import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authorizeResource: vi.fn(),
    verifyAgentIntent: vi.fn(),
    declareCapability: vi.fn(),
    listAgentCapabilities: vi.fn(),
    discoverCapabilities: vi.fn(),
    retireCapability: vi.fn(),
    createOffer: vi.fn(),
    listOffers: vi.fn(),
    purchaseUnits: vi.fn(),
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 60 })),
  clientIpFromRequest: () => "127.0.0.1",
  rateLimitResponse: () => ({}),
}));
vi.mock("@/lib/auth/authorize", () => ({
  authorizeResource: mocks.authorizeResource,
  verifyAgentIntent: mocks.verifyAgentIntent,
}));
vi.mock("@/lib/agent-economy/capability-registry", () => ({
  declareCapability: mocks.declareCapability,
  listAgentCapabilities: mocks.listAgentCapabilities,
  discoverCapabilities: mocks.discoverCapabilities,
  retireCapability: mocks.retireCapability,
}));
vi.mock("@/lib/agent-economy/compute-marketplace", () => ({
  createOffer: mocks.createOffer,
  listOffers: mocks.listOffers,
  purchaseUnits: mocks.purchaseUnits,
}));

const AGENT = "a".repeat(64);

function req(method: string, body?: unknown, url = `https://passport.metis.gold/x`) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", authorization: "Bearer pp_usr_x" },
  });
}

describe("agent-economy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAgentCapabilities.mockResolvedValue([]);
    mocks.discoverCapabilities.mockResolvedValue([]);
    mocks.listOffers.mockResolvedValue([]);
  });

  describe("capabilities", () => {
    it("POST is owner/ISSUER gated", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: false, status: 403, error: "not yours" });
      const { POST } = await import("@/app/api/v1/agents/[commitment]/capabilities/route");
      const res = await POST(
        req("POST", { capability: "llm.inference" }),
        { params: Promise.resolve({ commitment: AGENT }) }
      );
      expect(res.status).toBe(403);
      expect(mocks.declareCapability).not.toHaveBeenCalled();
    });

    it("POST declares a capability for the owner", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "HOLDER" });
      mocks.declareCapability.mockResolvedValue({ capability: "llm.inference", priceAngel: 5 });
      const { POST } = await import("@/app/api/v1/agents/[commitment]/capabilities/route");
      const res = await POST(
        req("POST", { capability: "llm.inference", price_angel: 5 }),
        { params: Promise.resolve({ commitment: AGENT }) }
      );
      expect(res.status).toBe(200);
      expect(mocks.declareCapability).toHaveBeenCalledOnce();
    });

    it("GET discovery is public", async () => {
      const { GET } = await import("@/app/api/v1/capabilities/route");
      const res = await GET(req("GET", undefined, "https://passport.metis.gold/api/v1/capabilities?capability=llm.inference"));
      expect(res.status).toBe(200);
      expect(mocks.discoverCapabilities).toHaveBeenCalled();
    });
  });

  describe("compute offers", () => {
    it("POST offer is owner/ISSUER gated", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
      const { POST } = await import("@/app/api/v1/compute/offers/route");
      const res = await POST(req("POST", { provider_commitment: AGENT }));
      expect(res.status).toBe(401);
      expect(mocks.createOffer).not.toHaveBeenCalled();
    });

    it("purchase maps spend_policy_denied to 403", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "ISSUER" });
      mocks.purchaseUnits.mockResolvedValue({ ok: false, code: "spend_policy_denied", error: "over cap" });
      const { POST } = await import("@/app/api/v1/compute/offers/[offerId]/purchase/route");
      const res = await POST(
        req("POST", { buyer_commitment: AGENT, units: 5 }),
        { params: Promise.resolve({ offerId: "gpu-hours" }) }
      );
      expect(res.status).toBe(403);
    });

    it("purchase returns 201 on success (ISSUER)", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "ISSUER" });
      mocks.purchaseUnits.mockResolvedValue({
        ok: true, purchaseId: "p1", units: 5, totalAngel: 50, providerCommitment: "b".repeat(64), status: "HELD", deduped: false,
      });
      const { POST } = await import("@/app/api/v1/compute/offers/[offerId]/purchase/route");
      const res = await POST(
        req("POST", { buyer_commitment: AGENT, units: 5, purchase_id: "p1" }),
        { params: Promise.resolve({ offerId: "gpu-hours" }) }
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.total_angel).toBe(50);
    });

    it("HOLDER purchase requires a signed intent", async () => {
      mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "HOLDER" });
      mocks.verifyAgentIntent.mockResolvedValue({ ok: false, status: 400, error: "signed intent is required" });
      const { POST } = await import("@/app/api/v1/compute/offers/[offerId]/purchase/route");
      const res = await POST(
        req("POST", { buyer_commitment: AGENT, units: 5 }),
        { params: Promise.resolve({ offerId: "gpu-hours" }) }
      );
      expect(res.status).toBe(400);
      expect(mocks.purchaseUnits).not.toHaveBeenCalled();
    });
  });
});
