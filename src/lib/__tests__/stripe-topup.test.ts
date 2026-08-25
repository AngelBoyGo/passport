import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const constructEventMock = vi.fn();
const checkoutCreateMock = vi.fn();
const stripeEventCreateMock = vi.fn();
const ledgerCreateMock = vi.fn();

let creditBalance = 100;

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: constructEventMock };
    checkout = { sessions: { create: checkoutCreateMock } };
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        stripeEvent: { create: stripeEventCreateMock },
        operatorLedgerEntry: { create: ledgerCreateMock },
        operator: {
          update: async (args: { data: { credits?: { increment: number } } }) => {
            if (args.data.credits?.increment) creditBalance += args.data.credits.increment;
            return { id: "op_db_1", credits: creditBalance };
          },
        },
        apiKey: { count: vi.fn(async () => 1) },
      };
      return fn(tx);
    },
  },
}));

vi.mock("@/lib/operator", () => ({
  ensureOperator: vi.fn(async () => ({ id: "op_db_1", stripeCustomerId: "cus_topup" })),
  createApiKey: vi.fn(async () => "pp_ent_x"),
  operatorIdFromStripe: (cus: string) => `op_${cus}`,
}));

import { creditsFromUsdCents, createUsdcTopupCheckout, handleStripeWebhook } from "@/lib/stripe";

describe("Stripe USDC credit top-up (B bank)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    creditBalance = 100;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
  });

  it("B1: creditsFromUsdCents is float-free and scales correctly", () => {
    expect(creditsFromUsdCents(100)).toBe(100);   // $1 -> 100 credits
    expect(creditsFromUsdCents(5000)).toBe(5000); // $50
    expect(creditsFromUsdCents(0)).toBe(0);
    expect(creditsFromUsdCents(-10)).toBe(0);
  });

  it("B1b: createUsdcTopupCheckout returns a mock session when Stripe is unconfigured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await createUsdcTopupCheckout("cus_topup", 1000);
    expect(res.mock).toBe(true);
    expect(res.url).toContain("mock");
  });

  it("B1c: createUsdcTopupCheckout requests USDC payment_method and metadata", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    checkoutCreateMock.mockResolvedValue({ url: "https://checkout.stripe.com/c/test", client_secret: "cs_test_1" });
    const res = await createUsdcTopupCheckout("cus_topup", 5000);
    expect(res.mock).toBe(false);
    const arg = checkoutCreateMock.mock.calls[0][0];
    expect(arg.mode).toBe("payment");
    expect(arg.payment_method_types).toContain("usdc");
    expect(arg.metadata.product).toBe("credits_topup");
    expect(arg.metadata.usd_cents).toBe("5000");
  });

  it("B2/B3: a completed credits_topup webhook credits the exact amount and logs a ledger entry", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_stripe_test";
    const event = {
      id: "evt_topup_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_topup_1",
          customer: "cus_topup",
          customer_email: "ops@example.com",
          amount_total: 5000, // $50 -> 5000 credits
          metadata: { product: "credits_topup" },
        },
      },
    };
    constructEventMock.mockReturnValue(event);
    stripeEventCreateMock.mockResolvedValue({ id: event.id });
    ledgerCreateMock.mockResolvedValue({ id: "le1" });

    const result = await handleStripeWebhook("body", "sig");
    expect(result.handled).toBe(true);
    expect(creditBalance).toBe(100 + 5000);
    expect(ledgerCreateMock).toHaveBeenCalledTimes(1);
    const led = ledgerCreateMock.mock.calls[0][0].data;
    expect(led.kind).toBe("stablecoin_topup");
    expect(led.deltaMicros).toBe(5000 * 10_000);
    expect(led.metadata).toContain("5000");
  });

  it("B4: a duplicate credits_topup webhook does NOT double-credit (idempotent)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_stripe_test";
    const event = {
      id: "evt_topup_dup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_topup_dup",
          customer: "cus_topup",
          amount_total: 1000,
          mode: "payment",
          metadata: { product: "credits_topup" },
        },
      },
    };
    constructEventMock.mockReturnValue(event);
    // First call succeeds; second (retry of same event id) throws P2002 →
    // claimStripeEvent returns duplicate → transaction short-circuits, no credit.
    stripeEventCreateMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        })
      );

    const first = await handleStripeWebhook("body_1", "sig_1");
    const second = await handleStripeWebhook("body_2", "sig_2");

    expect(first.handled).toBe(true);
    expect(second.duplicate).toBe(true);
    // Only one credit application recorded.
    expect(ledgerCreateMock).toHaveBeenCalledTimes(1);
  });
});