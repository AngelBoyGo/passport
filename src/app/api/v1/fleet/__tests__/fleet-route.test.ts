import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, schedAuthMock, mintMock, stopMock, rehydrateMock, listMock, statusMock } =
  vi.hoisted(() => ({
    authenticateMock: vi.fn(),
    schedAuthMock: vi.fn(),
    mintMock: vi.fn(),
    stopMock: vi.fn(),
    rehydrateMock: vi.fn(),
    listMock: vi.fn(),
    statusMock: vi.fn(),
  }));

vi.mock("@/lib/operator", () => ({ authenticateApiKey: authenticateMock }));
vi.mock("@/lib/scheduler/auth", () => ({ isSchedulerAuthorized: schedAuthMock }));
vi.mock("@/lib/fleet/fleet-service", () => ({
  mintFleetAgent: mintMock,
  stopFleetAgent: stopMock,
  rehydrateFleetAgent: rehydrateMock,
  listFleet: listMock,
  getFleetStatus: statusMock,
  fleetHalted: vi.fn(() => false),
  moneyMintEnabled: vi.fn(() => false),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  clientIpFromRequest: vi.fn(() => "127.0.0.1"),
  rateLimitResponse: vi.fn(),
}));

const { GET, POST } = await import("@/app/api/v1/fleet/route");

beforeEach(() => {
  authenticateMock.mockReset();
  schedAuthMock.mockReset();
  listMock.mockReset();
  statusMock.mockReset();
  statusMock.mockResolvedValue({ byStatus: {}, byTier: {}, total: 0, cap: 25, moneyMintEnabled: false });
});

const ISSUER = { apiKeyRole: "ISSUER" };
const req = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init));

describe("fleet route — authorization (fail-closed)", () => {
  it("anonymous → 403 (HOLDER keys included)", async () => {
    authenticateMock.mockResolvedValue(null);
    schedAuthMock.mockReturnValue(false);
    const res = await POST(
      new NextRequest("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "mint", capability: "x", llm_tier: "neuron" }),
        headers: { "content-type": "application/json", authorization: "Bearer pp_flt_holder" },
      })
    );
    expect(res.status).toBe(403);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("a HOLDER (agent) key → 403 — agents cannot drive the fleet", async () => {
    authenticateMock.mockResolvedValue({ apiKeyRole: "HOLDER" });
    schedAuthMock.mockReturnValue(false);
    const res = await POST(
      new NextRequest("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "mint", capability: "x", llm_tier: "neuron" }),
        headers: { "content-type": "application/json", authorization: "Bearer pp_flt_holder" },
      })
    );
    expect(res.status).toBe(403);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("scheduler secret authorizes", async () => {
    authenticateMock.mockResolvedValue(null);
    schedAuthMock.mockReturnValue(true);
    const res = await GET(req("https://passport.test/api/v1/fleet"));
    expect(res.status).toBe(200);
  });
});

describe("fleet route — actions", () => {
  beforeEach(() => {
    authenticateMock.mockResolvedValue(ISSUER);
    schedAuthMock.mockReturnValue(false);
    mintMock.mockReset();
    mintMock.mockClear();
    stopMock.mockReset();
    rehydrateMock.mockReset();
  });

  it("mint (single) → 201 with the agent summary", async () => {
    mintMock.mockResolvedValue({
      commitment: "a".repeat(64),
      instanceId: "inst1",
      tier: "neuron",
      resolvedModel: "deepseek-v4-flash",
    });
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "mint", capability: "locum_job_search", llm_tier: "neuron" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.minted).toBe(1);
    expect(body.agents[0].model).toBe("deepseek-v4-flash");
  });

  it("mint batch stop-on-first-error is reported honestly", async () => {
    mintMock.mockResolvedValueOnce({
      commitment: "b".repeat(64),
      instanceId: "i1",
      tier: "neuron",
      resolvedModel: "deepseek-v4-flash",
    });
    mintMock.mockRejectedValueOnce(new Error("fleet_cap_reached:25/25"));
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "mint", capability: "x", llm_tier: "neuron", count: 3 }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();
    expect(body.minted).toBe(1);
    expect(body.errors[0]).toBe("fleet_cap_reached:25/25");
  });

  it("unsupported action → 400 with the supported list", async () => {
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "renovate" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.supported).toContain("mint");
  });

  it("malformed commitment → 400", async () => {
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "stop", commitment: "not-a-commitment" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("rehydrate passes new_tier through and returns resolved model", async () => {
    rehydrateMock.mockResolvedValue({
      capsule: { version: 3 },
      tier: "money",
      resolvedModel: "deepseek-v4-pro",
      upgraded: true,
    });
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "rehydrate", commitment: "c".repeat(64), new_tier: "money" }),
        headers: { "content-type": "application/json" },
      })
    );
    const body = await res.json();
    expect(rehydrateMock).toHaveBeenCalledWith("c".repeat(64), "money");
    expect(body.resolved_model).toBe("deepseek-v4-pro");
    expect(body.upgraded).toBe(true);
  });

  it("unknown tier in mint body → 400, no service call", async () => {
    const res = await POST(
      req("https://passport.test/api/v1/fleet", {
        method: "POST",
        body: JSON.stringify({ action: "mint", capability: "x", llm_tier: "gpt-4o-mini" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(mintMock).not.toHaveBeenCalled();
  });
});
