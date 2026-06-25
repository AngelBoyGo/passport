import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const constructEventMock = vi.fn();
const stripeEventCreateMock = vi.fn();
const ensureOperatorMock = vi.fn();
const createApiKeyMock = vi.fn();
const apiKeyCountMock = vi.fn();

let creditBalance = 100;

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: constructEventMock };
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stripeEvent: { create: stripeEventCreateMock },
        operator: {
          update: async (args: {
            data: { credits?: { increment: number }; tier?: string };
          }) => {
            if (args.data.credits?.increment) {
              creditBalance += args.data.credits.increment;
            }
            return { id: "op_db_1", credits: creditBalance };
          },
        },
        apiKey: { count: apiKeyCountMock },
      };
      return fn(tx);
    },
  },
}));

vi.mock("@/lib/operator", () => ({
  ensureOperator: (...args: unknown[]) => ensureOperatorMock(...args),
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
  operatorIdFromStripe: (cus: string) => `op_${cus}`,
}));

const CUSTOMER_ID = "cus_webhook_double_test";

function checkoutCompletedEvent(eventId: string) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        customer: CUSTOMER_ID,
        customer_email: "pro@example.com",
        mode: "subscription",
      },
    },
  };
}

function invoicePaymentSucceededEvent(
  eventId: string,
  billingReason: string
) {
  return {
    id: eventId,
    type: "invoice.payment_succeeded",
    data: {
      object: {
        customer: CUSTOMER_ID,
        customer_email: "pro@example.com",
        billing_reason: billingReason,
      },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  creditBalance = 100;
  constructEventMock.mockReset();
  stripeEventCreateMock.mockReset();
  ensureOperatorMock.mockReset();
  createApiKeyMock.mockReset();
  apiKeyCountMock.mockReset();

  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_mock";

  ensureOperatorMock.mockResolvedValue({ id: "op_db_1", stakeBalanceCents: 0 });
  apiKeyCountMock.mockResolvedValue(1);
  stripeEventCreateMock.mockResolvedValue({});
});

describe("handleStripeWebhook credit provisioning", () => {
  it("does not double-increment credits when checkout and invoice events both arrive", async () => {
    constructEventMock
      .mockReturnValueOnce(checkoutCompletedEvent("evt_checkout_001"))
      .mockReturnValueOnce(
        invoicePaymentSucceededEvent("evt_invoice_001", "subscription_create")
      );

    const { handleStripeWebhook } = await import("@/lib/stripe");

    const checkoutResult = await handleStripeWebhook("{}", "sig_checkout");
    expect(checkoutResult.handled).toBe(true);
    expect(creditBalance).toBe(10_100);

    const invoiceResult = await handleStripeWebhook("{}", "sig_invoice");
    expect(invoiceResult.handled).toBe(true);
    expect(creditBalance).toBe(10_100);
  });

  it("increments credits on subscription_cycle renewal invoice", async () => {
    creditBalance = 10_100;
    constructEventMock.mockReturnValueOnce(
      invoicePaymentSucceededEvent("evt_renewal_001", "subscription_cycle")
    );

    const { handleStripeWebhook } = await import("@/lib/stripe");
    const result = await handleStripeWebhook("{}", "sig_renewal");

    expect(result.handled).toBe(true);
    expect(creditBalance).toBe(20_100);
  });

  it("treats duplicate stripe events as idempotent without extra credits", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent("evt_dup_001"));
    stripeEventCreateMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        })
      );

    const { handleStripeWebhook } = await import("@/lib/stripe");

    await handleStripeWebhook("{}", "sig1");
    expect(creditBalance).toBe(10_100);

    const duplicate = await handleStripeWebhook("{}", "sig2");
    expect(duplicate.duplicate).toBe(true);
    expect(creditBalance).toBe(10_100);
  });
});
