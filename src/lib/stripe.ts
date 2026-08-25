import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import type { PrismaTx } from "./operator";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "./escrow/constants";

let stripeClient: Stripe | null = null;

/**
 * Returns a Stripe client or null when keys are not configured (dev mock mode).
 */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export const FREE_CREDITS = 100;
export const PRO_CREDITS = 10_000;
export const PRO_PRICE_USD = 49;

/**
 * Creates a Stripe customer in test/live mode, or a dev id when Stripe is not configured.
 */
export async function getOrCreateStripeCustomer(
  email?: string | null
): Promise<string> {
  const stripe = getStripe();
  if (!stripe) {
    return `cus_dev_${Date.now()}`;
  }
  const customer = await stripe.customers.create({
    email: email ?? undefined,
  });
  return customer.id;
}

/**
 * Creates a Stripe Checkout session for Pro subscription or credit top-up.
 */
export async function createCheckoutSession(
  stripeCustomerId: string,
  _operatorEmail: string | null,
  mode: "subscription" | "payment" = "subscription"
) {
  const stripe = getStripe();
  if (!stripe) {
    return { mock: true, url: "/?checkout=mock" };
  }

  const priceId = process.env.STRIPE_PRICE_PRO;
  if (!priceId && mode === "subscription") {
    throw new Error("STRIPE_PRICE_PRO not configured");
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode,
    line_items: [
      {
        price: priceId!,
        quantity: 1,
      },
    ],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/?success=1`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/?canceled=1`,
    metadata: { product: "passport_pro" },
  });

  return { mock: false, url: session.url };
}

/** 1 credit = $0.01; stablecoin topups use micro-fidelity. */
export const CREDITS_PER_DOLLAR = 100;
export const MICROS_PER_CREDIT = 100_000;

/** Convert a USD-cents amount into whole credits (float-free). */
export function creditsFromUsdCents(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) return 0;
  return Math.floor((cents * CREDITS_PER_DOLLAR) / 100);
}

/**
 * Creates a one-time Stripe Checkout session that accepts USDC (stablecoin
 * payments) and credits the operator's account by the order amount.
 */
export async function createUsdcTopupCheckout(
  stripeCustomerId: string,
  usdCents: number
): Promise<{ mock: boolean; url?: string; clientSecret?: string }> {
  const stripe = getStripe();
  if (!stripe) {
    // Dev/mock path (no STRIPE_SECRET_KEY).
    return { mock: true, url: "/?checkout=mock", clientSecret: "mock_secret" };
  }
  const amount = Math.max(usdCents, 50); // Stripe min for payments
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "AngelCoin credit top-up" },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    payment_method_types: ["usdc" as Stripe.Checkout.SessionCreateParams.PaymentMethodType],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/?success=1`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/?canceled=1`,
    metadata: { product: "credits_topup", usd_cents: String(amount) },
  });
  return { mock: false, url: session.url ?? undefined, clientSecret: session.client_secret ?? undefined };
}

type WebhookResult = {
  mock: boolean;
  handled: boolean;
  duplicate?: boolean;
  operatorId?: string;
};

/**
 * Records a Stripe event for idempotency; returns true if this is a duplicate.
 */
async function claimStripeEvent(
  tx: PrismaTx,
  eventId: string,
  eventType: string
): Promise<boolean> {
  try {
    await tx.stripeEvent.create({
      data: { id: eventId, type: eventType },
    });
    return false;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return true;
    }
    throw err;
  }
}

/**
 * Provisions operator credits and API key after a successful payment event.
 */
async function provisionOperatorPayment(
  tx: PrismaTx,
  customerId: string,
  email: string | null | undefined,
  mode: "subscription" | "payment"
) {
  const { ensureOperator, createApiKey } = await import("./operator");

  const operator = await ensureOperator(customerId, email, tx);

  if (mode === "subscription") {
    await tx.operator.update({
      where: { id: operator.id },
      data: {
        tier: "pro",
        credits: { increment: PRO_CREDITS },
        stakeBalanceCents: Math.max(
          operator.stakeBalanceCents ?? 0,
          MINIMUM_ESCROW_FLOOR_CENTS
        ),
      },
    });
  } else {
    await tx.operator.update({
      where: { id: operator.id },
      data: { credits: { increment: 1000 } },
    });
  }

  const existingKeys = await tx.apiKey.count({
    where: { operatorId: operator.id },
  });
  if (existingKeys === 0) {
    await createApiKey(operator.id, "default", tx);
  }

  return operator;
}

/**
 * Handles Stripe webhook events for operator provisioning and credits.
 */
export async function handleStripeWebhook(
  body: string,
  signature: string | null
): Promise<WebhookResult> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return { mock: true, handled: false };
  }

  const event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);

  const { ensureOperator, operatorIdFromStripe } = await import("./operator");
  const { prisma } = await import("./db");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (!customerId) {
        return { mock: false, handled: false };
      }

      const result = await prisma.$transaction(async (tx) => {
        const duplicate = await claimStripeEvent(tx, event.id, event.type);
        if (duplicate) {
          return { handled: false, duplicate: true as const };
        }

        // USDC/stablecoin credit top-up: credit by the exact order amount and
        // record an append-only operator ledger entry.
        if (session.metadata?.product === "credits_topup") {
          const { ensureOperator } = await import("./operator");
          const operator = await ensureOperator(customerId, session.customer_email, tx);
          const amountTotal = session.amount_total ?? 0;
          const credits = creditsFromUsdCents(amountTotal);
          await tx.operator.update({
            where: { id: operator.id },
            data: { credits: { increment: credits } },
          });
          await tx.operatorLedgerEntry.create({
            data: {
              operatorId: operator.id,
              deltaMicros: amountTotal * 10_000, // cents -> micro-dollars
              kind: "stablecoin_topup",
              metadata: JSON.stringify({ session_id: session.id, usd_cents: amountTotal, credits }),
            },
          });
          return {
            handled: true,
            duplicate: false as const,
            operatorId: operatorIdFromStripe(customerId),
          };
        }

        await provisionOperatorPayment(
          tx,
          customerId,
          session.customer_email,
          session.mode === "payment" ? "payment" : "subscription"
        );

        return {
          handled: true,
          duplicate: false as const,
          operatorId: operatorIdFromStripe(customerId),
        };
      });

      return { mock: false, ...result };
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId) {
        return { mock: false, handled: false };
      }

      const result = await prisma.$transaction(async (tx) => {
        const duplicate = await claimStripeEvent(tx, event.id, event.type);
        if (duplicate) {
          return { handled: false, duplicate: true as const };
        }

        // Initial Pro grant is on checkout.session.completed; only renewals add credits.
        if (invoice.billing_reason === "subscription_cycle") {
          await provisionOperatorPayment(
            tx,
            customerId,
            invoice.customer_email,
            "subscription"
          );
        }

        return {
          handled: true,
          duplicate: false as const,
          operatorId: operatorIdFromStripe(customerId),
        };
      });

      return { mock: false, ...result };
    }
    case "customer.created": {
      const customer = event.data.object as Stripe.Customer;

      const result = await prisma.$transaction(async (tx) => {
        const duplicate = await claimStripeEvent(tx, event.id, event.type);
        if (duplicate) {
          return { handled: false, duplicate: true as const };
        }

        await ensureOperator(customer.id, customer.email, tx);
        return { handled: true, duplicate: false as const };
      });

      return { mock: false, ...result };
    }
    default:
      return { mock: false, handled: false };
  }
}

/**
 * Dev-only mock checkout that provisions an operator without Stripe.
 */
export async function mockDevCheckout(email?: string) {
  const mockCustomerId = `cus_dev_${Date.now()}`;
  const { ensureOperator, createApiKey, operatorIdFromStripe } = await import(
    "./operator"
  );
  const operator = await ensureOperator(mockCustomerId, email ?? "dev@passport.local");
  const apiKey = await createApiKey(operator.id, "dev");
  return {
    operatorId: operatorIdFromStripe(mockCustomerId),
    operatorDbId: operator.id,
    apiKey,
    credits: operator.credits,
  };
}
