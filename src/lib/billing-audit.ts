import { Prisma } from "@prisma/client";
import type { PrismaTx } from "./operator";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "./escrow/constants";
import { FREE_CREDITS, PRO_CREDITS } from "./stripe";

export type AuditCheckoutEvent = {
  id: string;
  type: "checkout.session.completed";
  data: {
    object: {
      customer: string;
      customer_email: string;
      mode: "subscription";
    };
  };
};

export type AuditProvisionResult = {
  operatorId: string;
  apiKey?: string;
  expectedCredits: number;
  duplicate?: boolean;
};

/**
 * Generates a randomized live-audit Stripe customer id.
 */
export function generateAuditCustomerId(): string {
  return `cus_live_audit_${Math.random().toString(36).substring(7)}`;
}

/**
 * Builds a live-format checkout.session.completed event for audit injection.
 */
export function buildAuditCheckoutEvent(
  customerId: string,
  eventId: string,
  email = "billing-audit@passport.metis.gold"
): AuditCheckoutEvent {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        customer: customerId,
        customer_email: email,
        mode: "subscription",
      },
    },
  };
}

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
 * Provisions an operator via checkout.session.completed logic inside a transaction.
 * Mirrors src/lib/stripe.ts provisionOperatorPayment for live DB verification.
 */
export async function provisionAuditCheckout(
  tx: PrismaTx,
  customerId: string,
  email: string,
  eventId: string
): Promise<AuditProvisionResult> {
  const { ensureOperator, createApiKey, operatorIdFromStripe } = await import(
    "./operator"
  );

  const duplicate = await claimStripeEvent(tx, eventId, "checkout.session.completed");
  if (duplicate) {
    return {
      operatorId: operatorIdFromStripe(customerId),
      expectedCredits: FREE_CREDITS + PRO_CREDITS,
      duplicate: true,
    };
  }

  const operator = await ensureOperator(customerId, email, tx);

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

  let apiKey: string | undefined;
  const existingKeys = await tx.apiKey.count({
    where: { operatorId: operator.id },
  });
  if (existingKeys === 0) {
    apiKey = await createApiKey(operator.id, "default", tx);
  }

  return {
    operatorId: operatorIdFromStripe(customerId),
    apiKey,
    expectedCredits: FREE_CREDITS + PRO_CREDITS,
    duplicate: false,
  };
}

/**
 * ASSERTION A + B: validates Sybil anchor, credits, tier, and API key row.
 */
export async function assertAuditProvisioning(
  tx: PrismaTx,
  customerId: string
): Promise<{ operatorId: string; credits: number; apiKeyCount: number }> {
  const { operatorIdFromStripe } = await import("./operator");

  const operator = await tx.operator.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!operator) {
    throw new Error(
      `[ASSERTION A] Operator not found for stripeCustomerId=${customerId}`
    );
  }

  const expectedPublicId = operatorIdFromStripe(customerId);
  if (expectedPublicId !== `op_${customerId}`) {
    throw new Error(
      `[ASSERTION A] Sybil anchor mismatch: expected op_${customerId}, got ${expectedPublicId}`
    );
  }

  if (operator.tier !== "pro") {
    throw new Error(
      `[ASSERTION B] Expected tier=pro, got tier=${operator.tier}`
    );
  }

  const expectedCredits = FREE_CREDITS + PRO_CREDITS;
  if (operator.credits !== expectedCredits) {
    throw new Error(
      `[ASSERTION B] Expected credits=${expectedCredits}, got ${operator.credits}`
    );
  }

  const apiKeys = await tx.apiKey.findMany({
    where: { operatorId: operator.id },
  });
  if (apiKeys.length === 0) {
    throw new Error("[ASSERTION B] No API key provisioned for audit operator");
  }

  return {
    operatorId: expectedPublicId,
    credits: operator.credits,
    apiKeyCount: apiKeys.length,
  };
}

/**
 * Forensic teardown — purges audit operator and related rows from production Postgres.
 */
export async function purgeAuditOperator(
  tx: PrismaTx,
  customerId: string,
  eventIds: string[]
): Promise<void> {
  const operator = await tx.operator.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (!operator) {
    return;
  }

  await tx.receipt.deleteMany({ where: { operatorId: operator.id } });
  await tx.agent.deleteMany({ where: { operatorId: operator.id } });
  await tx.capabilityLedgerEntry.deleteMany({
    where: { operatorId: operator.id },
  });
  await tx.matchLedgerEntry.deleteMany({ where: { operatorId: operator.id } });
  await tx.apiKey.deleteMany({ where: { operatorId: operator.id } });

  if (eventIds.length > 0) {
    await tx.stripeEvent.deleteMany({
      where: { id: { in: eventIds } },
    });
  }

  await tx.operator.delete({ where: { id: operator.id } });
}
