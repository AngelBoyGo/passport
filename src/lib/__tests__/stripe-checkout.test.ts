import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const customersCreateMock = vi.fn();
const sessionsCreateMock = vi.fn();

vi.mock("stripe", () => ({
  default: class MockStripe {
    customers = { create: customersCreateMock };
    checkout = { sessions: { create: sessionsCreateMock } };
  },
}));

const ensureOperatorMock = vi.fn();
const getSessionFromTokenMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  ensureOperator: (...args: unknown[]) => ensureOperatorMock(...args),
}));

vi.mock("@/lib/auth/auth-service", () => ({
  getSessionFromToken: (...args: unknown[]) => getSessionFromTokenMock(...args),
}));

beforeEach(async () => {
  vi.resetModules();
  customersCreateMock.mockReset();
  sessionsCreateMock.mockReset();
  ensureOperatorMock.mockReset();
  getSessionFromTokenMock.mockReset();
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  process.env.STRIPE_PRICE_PRO = "price_test_pro";
  process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
});

describe("getOrCreateStripeCustomer", () => {
  it("creates a real Stripe customer and returns cus_ id", async () => {
    customersCreateMock.mockResolvedValue({ id: "cus_real_abc123" });
    const { getOrCreateStripeCustomer } = await import("@/lib/stripe");
    const id = await getOrCreateStripeCustomer("buyer@example.com");
    expect(id).toBe("cus_real_abc123");
    expect(customersCreateMock).toHaveBeenCalledWith({
      email: "buyer@example.com",
    });
    expect(id).not.toMatch(/^cus_pending_/);
  });
});

describe("createCheckoutSession", () => {
  it("passes real customer id to sessions.create, never cus_pending", async () => {
    sessionsCreateMock.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/test",
    });
    const { createCheckoutSession } = await import("@/lib/stripe");
    await createCheckoutSession("cus_real_abc123", "buyer@example.com");
    expect(sessionsCreateMock).toHaveBeenCalledOnce();
    const params = sessionsCreateMock.mock.calls[0][0];
    expect(params.customer).toBe("cus_real_abc123");
    expect(params.customer).not.toMatch(/^cus_pending_/);
    expect(params).not.toHaveProperty("customer_email");
  });
});

describe("POST /api/stripe/checkout", () => {
  it("creates Stripe customer before session when stripe_customer_id omitted", async () => {
    customersCreateMock.mockResolvedValue({ id: "cus_new_from_route" });
    sessionsCreateMock.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/test",
    });
    ensureOperatorMock.mockResolvedValue({
      stripeCustomerId: "cus_new_from_route",
      email: "buyer@example.com",
    });
    getSessionFromTokenMock.mockResolvedValue({
      operator: { stripeCustomerId: "cus_new_from_route", email: "buyer@example.com" },
    });

    const { POST } = await import("@/app/api/stripe/checkout/route");
    const request = new NextRequest("http://localhost/api/stripe/checkout", {
      method: "POST",
      headers: { Cookie: "session_token=sess_test" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(customersCreateMock).not.toHaveBeenCalled();
    expect(ensureOperatorMock).toHaveBeenCalledWith(
      "cus_new_from_route",
      "buyer@example.com"
    );
    expect(sessionsCreateMock).toHaveBeenCalledOnce();
    const sessionParams = sessionsCreateMock.mock.calls[0][0];
    expect(sessionParams.customer).toBe("cus_new_from_route");
    expect(sessionParams.customer).not.toMatch(/^cus_pending_/);
    expect(body).toEqual({
      mock: false,
      url: "https://checkout.stripe.com/c/pay/test",
    });
  });

  it("reuses supplied stripe_customer_id without calling customers.create", async () => {
    sessionsCreateMock.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/existing",
    });
    ensureOperatorMock.mockResolvedValue({
      stripeCustomerId: "cus_existing_xyz",
      email: "returning@example.com",
    });
    getSessionFromTokenMock.mockResolvedValue({
      operator: { stripeCustomerId: "cus_existing_xyz", email: "returning@example.com" },
    });

    const { POST } = await import("@/app/api/stripe/checkout/route");
    const request = new NextRequest("http://localhost/api/stripe/checkout", {
      method: "POST",
      headers: { Cookie: "session_token=sess_test" },
    });

    await POST(request);

    expect(customersCreateMock).not.toHaveBeenCalled();
    expect(ensureOperatorMock).toHaveBeenCalledWith(
      "cus_existing_xyz",
      "returning@example.com"
    );
    expect(sessionsCreateMock.mock.calls[0][0].customer).toBe("cus_existing_xyz");
  });

  it("rejects logged-out checkout attempts", async () => {
    getSessionFromTokenMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/stripe/checkout/route");
    const response = await POST(new NextRequest("http://localhost/api/stripe/checkout", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication required to start a subscription",
    });
  });
});
