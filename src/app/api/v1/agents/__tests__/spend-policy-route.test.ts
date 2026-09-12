import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authorizeResource: vi.fn(),
    getSpendPolicy: vi.fn(),
    setSpendPolicy: vi.fn(),
    getRollingSpend: vi.fn(),
  },
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 60 })),
  clientIpFromRequest: () => "127.0.0.1",
  rateLimitResponse: () => ({}),
}));
vi.mock("@/lib/auth/authorize", () => ({ authorizeResource: mocks.authorizeResource }));
vi.mock("@/lib/agent-economy/spend-policy-service", () => ({
  getSpendPolicy: mocks.getSpendPolicy,
  setSpendPolicy: mocks.setSpendPolicy,
  getRollingSpend: mocks.getRollingSpend,
}));

const AGENT = "a".repeat(64);
const ctx = { params: Promise.resolve({ commitment: AGENT }) };

function req(method: string, body?: unknown) {
  return new NextRequest(`https://passport.metis.gold/api/v1/agents/${AGENT}/spend-policy`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", authorization: "Bearer pp_usr_x" },
  });
}

describe("spend-policy route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSpendPolicy.mockResolvedValue({ agentCommitment: AGENT, enabled: true });
    mocks.getRollingSpend.mockResolvedValue({ spentToday: 0, spentThisWeek: 0 });
    mocks.setSpendPolicy.mockResolvedValue({ agentCommitment: AGENT, enabled: true });
  });

  it("GET rejects a non-owner (403)", async () => {
    mocks.authorizeResource.mockResolvedValue({ ok: false, status: 403, error: "not yours" });
    const { GET } = await import("@/app/api/v1/agents/[commitment]/spend-policy/route");
    const res = await GET(req("GET"), ctx);
    expect(res.status).toBe(403);
    expect(mocks.getSpendPolicy).not.toHaveBeenCalled();
  });

  it("GET returns the policy and rolling spend for the owner", async () => {
    mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "HOLDER" });
    const { GET } = await import("@/app/api/v1/agents/[commitment]/spend-policy/route");
    const res = await GET(req("GET"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.enabled).toBe(true);
    expect(mocks.authorizeResource).toHaveBeenCalledWith(expect.anything(), {
      kind: "agent",
      id: AGENT,
    });
  });

  it("PUT sets the policy for the owner", async () => {
    mocks.authorizeResource.mockResolvedValue({ ok: true, operatorId: "op", role: "HOLDER" });
    const { PUT } = await import("@/app/api/v1/agents/[commitment]/spend-policy/route");
    const res = await PUT(req("PUT", { per_tx_max_angel: 25, daily_max_angel: 100 }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.setSpendPolicy).toHaveBeenCalledWith(
      AGENT,
      expect.objectContaining({ perTxMaxAngel: 25, dailyMaxAngel: 100 }),
      "op"
    );
  });
});