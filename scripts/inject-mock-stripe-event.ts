/**
 * Offline mock Stripe webhook injector for container verification.
 * Uses generateTestHeaderString — no live keys or network calls to Stripe.
 */
import Stripe from "stripe";

const APP_URL = process.env.VERIFY_APP_URL ?? "http://localhost:3000";
const WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_verify_test_secret";
const EVENT_ID = process.env.VERIFY_EVENT_ID ?? "evt_verify_container_001";
const CUSTOMER_ID = "cus_verify_container_test";

const stripe = new Stripe("sk_test_verify_fake");

const checkoutEvent = {
  id: EVENT_ID,
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_verify_test",
      object: "checkout.session",
      customer: CUSTOMER_ID,
      customer_email: "verify@container.test",
      mode: "subscription",
    },
  },
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
};

const invoiceCreateEvent = {
  id: `${EVENT_ID}_invoice_create`,
  object: "event",
  api_version: "2024-11-20.acacia",
  created: Math.floor(Date.now() / 1000),
  type: "invoice.payment_succeeded",
  data: {
    object: {
      id: "in_verify_test_create",
      object: "invoice",
      customer: CUSTOMER_ID,
      customer_email: "verify@container.test",
      billing_reason: "subscription_create",
    },
  },
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
};

async function postWebhook(payload: string): Promise<Response> {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return fetch(`${APP_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

async function getOperatorCredits(): Promise<number> {
  const { PrismaClient } = await import("@prisma/client");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://passport:passport@localhost:5433/passport?schema=public";
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const operator = await prisma.operator.findUnique({
      where: { stripeCustomerId: CUSTOMER_ID },
    });
    return operator?.credits ?? 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const payload = JSON.stringify(checkoutEvent);

  console.log(`[verify] Posting mock checkout.session.completed (event ${EVENT_ID})`);
  const first = await postWebhook(payload);
  const firstBody = await first.json();
  console.log(`[verify] First response: HTTP ${first.status}`, firstBody);

  if (first.status !== 200) {
    throw new Error(`Expected HTTP 200 on first webhook, got ${first.status}`);
  }
  if (!firstBody.handled) {
    throw new Error("Expected handled:true on first webhook");
  }

  const creditsAfterFirst = await getOperatorCredits();
  const expectedCredits = 100 + 10_000;
  console.log(`[verify] Credits after first event: ${creditsAfterFirst} (expected ${expectedCredits})`);
  if (creditsAfterFirst !== expectedCredits) {
    throw new Error(
      `Credit mismatch after first event: got ${creditsAfterFirst}, expected ${expectedCredits}`
    );
  }

  console.log(`[verify] Re-posting duplicate event ${EVENT_ID}`);
  const second = await postWebhook(payload);
  const secondBody = await second.json();
  console.log(`[verify] Duplicate response: HTTP ${second.status}`, secondBody);

  if (second.status !== 200) {
    throw new Error(`Expected HTTP 200 on duplicate webhook, got ${second.status}`);
  }
  if (!secondBody.duplicate) {
    throw new Error("Expected duplicate:true on second webhook");
  }

  const creditsAfterDuplicate = await getOperatorCredits();
  console.log(`[verify] Credits after duplicate: ${creditsAfterDuplicate}`);
  if (creditsAfterDuplicate !== creditsAfterFirst) {
    throw new Error(
      `Double-credit detected: ${creditsAfterFirst} -> ${creditsAfterDuplicate}`
    );
  }

  console.log(
    `[verify] Posting invoice.payment_succeeded (subscription_create) after checkout`
  );
  const invoicePayload = JSON.stringify(invoiceCreateEvent);
  const invoiceRes = await postWebhook(invoicePayload);
  const invoiceBody = await invoiceRes.json();
  console.log(`[verify] Invoice response: HTTP ${invoiceRes.status}`, invoiceBody);

  if (invoiceRes.status !== 200) {
    throw new Error(`Expected HTTP 200 on invoice webhook, got ${invoiceRes.status}`);
  }
  if (!invoiceBody.handled) {
    throw new Error("Expected handled:true on invoice webhook");
  }

  const creditsAfterInvoice = await getOperatorCredits();
  console.log(
    `[verify] Credits after checkout + invoice create: ${creditsAfterInvoice} (expected ${expectedCredits})`
  );
  if (creditsAfterInvoice !== expectedCredits) {
    throw new Error(
      `Double-credit on checkout+invoice: got ${creditsAfterInvoice}, expected ${expectedCredits}`
    );
  }

  console.log("[verify] PASS — operator provisioned, idempotency confirmed");
}

main().catch((err) => {
  console.error("[verify] FAIL:", err);
  process.exit(1);
});
