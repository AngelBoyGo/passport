import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieveMock = vi.fn();
const createCustomerMock = vi.fn();

vi.mock("stripe", () => ({
  default: class MockStripe {
    customers = { retrieve: retrieveMock, create: createCustomerMock };
    checkout = { sessions: { create: vi.fn() } };
    webhooks = { constructEvent: vi.fn() };
  },
}));

import { resolveStripeCustomerId } from "@/lib/stripe";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});

describe("resolveStripeCustomerId — repair stale/fake ids", () => {
  it("returns the id unchanged when the customer exists", async () => {
    retrieveMock.mockResolvedValue({ id: "cus_live_1", deleted: false });
    expect(await resolveStripeCustomerId("cus_live_1", "a@b.com")).toBe("cus_live_1");
    expect(createCustomerMock).not.toHaveBeenCalled();
  });

  it("recreates the customer when the id is resource_missing (fake signup id)", async () => {
    retrieveMock.mockRejectedValue(Object.assign(new Error("No such customer"), { code: "resource_missing" }));
    createCustomerMock.mockResolvedValue({ id: "cus_new_live" });
    expect(await resolveStripeCustomerId("cus_deadbeef", "a@b.com")).toBe("cus_new_live");
    expect(createCustomerMock).toHaveBeenCalledWith({ email: "a@b.com" });
  });

  it("recreates when the customer was deleted", async () => {
    retrieveMock.mockResolvedValue({ id: "cus_del", deleted: true });
    createCustomerMock.mockResolvedValue({ id: "cus_fresh" });
    expect(await resolveStripeCustomerId("cus_del", null)).toBe("cus_fresh");
  });

  it("surfaces a real Stripe error instead of masking it", async () => {
    retrieveMock.mockRejectedValue(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
    await expect(resolveStripeCustomerId("cus_x", "a@b.com")).rejects.toThrow(/rate limited/);
    expect(createCustomerMock).not.toHaveBeenCalled();
  });
});
