import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sessionFromRequestMock = vi.hoisted(() => vi.fn());
const ensureOperatorMock = vi.hoisted(() => vi.fn());
const createUsdcTopupCheckoutMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/cookies", () => ({
  sessionFromRequest: (...a: unknown[]) => sessionFromRequestMock(...a),
}));
vi.mock("@/lib/operator", () => ({
  ensureOperator: (...a: unknown[]) => ensureOperatorMock(...a),
}));
vi.mock("@/lib/stripe", () => ({
  createUsdcTopupCheckout: (...a: unknown[]) => createUsdcTopupCheckoutMock(...a),
}));

function makeOp() {
  return { id: "op_1", email: "o@x.com", stripeCustomerId: "cus_topup" };
}

describe("POST /api/v1/account/topup — USDC credit top-up", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 without a session", async () => {
    sessionFromRequestMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/account/topup/route");
    const res = await POST(new NextRequest("http://localhost/api/v1/account/topup", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("creates a USDC checkout session and returns its url", async () => {
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp() });
    ensureOperatorMock.mockResolvedValue(makeOp());
    createUsdcTopupCheckoutMock.mockResolvedValue({ mock: false, url: "https://checkout.stripe.com/c/1" });

    const { POST } = await import("@/app/api/v1/account/topup/route");
    const req = new NextRequest("http://localhost/api/v1/account/topup", {
      method: "POST",
      body: JSON.stringify({ usd_cents: 5000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("checkout.stripe.com");
    expect(createUsdcTopupCheckoutMock).toHaveBeenCalledWith("cus_topup", 5000);
  });

  it("falls back to a mock topup when Stripe is unconfigured (dev)", async () => {
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp() });
    ensureOperatorMock.mockResolvedValue(makeOp());
    createUsdcTopupCheckoutMock.mockResolvedValue({ mock: true, url: "/?checkout=mock" });

    const { POST } = await import("@/app/api/v1/account/topup/route");
    const req = new NextRequest("http://localhost/api/v1/account/topup", {
      method: "POST",
      body: JSON.stringify({ usd_cents: 1000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mock).toBe(true);
  });

  it("rejects an invalid amount", async () => {
    sessionFromRequestMock.mockResolvedValue({ operator: makeOp() });
    ensureOperatorMock.mockResolvedValue(makeOp());

    const { POST } = await import("@/app/api/v1/account/topup/route");
    const req = new NextRequest("http://localhost/api/v1/account/topup", {
      method: "POST",
      body: JSON.stringify({ usd_cents: -5 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(createUsdcTopupCheckoutMock).not.toHaveBeenCalled();
  });
});