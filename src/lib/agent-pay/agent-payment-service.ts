import { verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { prisma } from "@/lib/db";
import { recordCapabilityEvent } from "@/lib/operator";
import {
  ATTESTATION_CATALOG,
  meterAttestation,
  microsToCredits,
  type AttestationProduct,
} from "@/lib/metering/attestation-meter";
import { sha256Hex } from "@/lib/receipt/canonical";

/**
 * Agentic Payments (research-aligned, 2026)
 * -----------------------------------------
 * Mirrors what shipped this year (Stripe Agentic Commerce Suite agent wallets,
 * spend-scope controls + SPT/x402 tokens; OpenAI+Visa agentic commerce;
 * Mastercard Agent Pay):
 *
 *  - An agent's Passport credit balance IS its wallet.
 *  - Spend scopes carry CONTROLS (product, max credits, merchant, TTL) so an
 *    agent cannot over-spend its authorization.
 *  - Self-pay is authorized by API key + optional Ed25519 proof-of-possession
 *    over the scope digest.
 *  - Inbound settlement from external rails is HMAC-authenticated, idempotent,
 *    and credited to the wallet, with a traceable ledger entry.
 */

export type AgentPaymentRail =
  | "passport_credits"
  | "stripe_agent"
  | "visa_intelligent_commerce"
  | "mastercard_agent_pay"
  | "x402";

export interface SpendScope {
  product: AttestationProduct;
  max_credits: number;
  merchant: string;
  nonce: string;
  created_at: string;
  expires_at: string;
}

export interface WalletHeader {
  operator_id: string;
  credits: number;
}

export interface WalletSpendResult {
  authorized: boolean;
  reason?: string;
  product?: AttestationProduct;
  credits_charged?: number;
  remaining_credits?: number;
  meter_ref?: string;
  payment_digest?: string;
}

export interface WalletSettlementResult {
  accepted: boolean;
  reason?: string;
  credits_added?: number;
  new_balance?: number;
}

const SPEND_TTL_MS = 5 * 60 * 1000; // 5 min scoped spend window

export function computeSpendScopeDigest(scope: SpendScope): string {
  return sha256Hex(
    [scope.product, scope.max_credits, scope.merchant, scope.nonce, scope.created_at, scope.expires_at].join(":")
  );
}

export function createSpendScope(product: AttestationProduct, maxCredits: number): SpendScope {
  const now = Date.now();
  return {
    product,
    max_credits: maxCredits,
    merchant: "passport",
    nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(24))),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SPEND_TTL_MS).toISOString(),
  };
}

export async function getAgentWallet(operatorId: string): Promise<WalletHeader> {
  const op = await prisma.operator.findUnique({
    where: { id: operatorId },
    select: { credits: true },
  });
  return { operator_id: operatorId, credits: op?.credits ?? 0 };
}

export async function authorizeAgentSpend(opts: {
  operatorId: string;
  product: AttestationProduct;
  scope: SpendScope;
  agentSignatureHex?: string;
  agentPublicKeyHex?: string;
}): Promise<WalletSpendResult> {
  const { operatorId, product, scope, agentSignatureHex, agentPublicKeyHex } = opts;

  if (scope.merchant !== "passport") {
    return { authorized: false, reason: "Spend scope merchant must be 'passport'" };
  }
  if (new Date(scope.expires_at).getTime() < Date.now()) {
    return { authorized: false, reason: "Spend scope expired" };
  }

  if (agentPublicKeyHex && agentSignatureHex) {
    const digest = computeSpendScopeDigest(scope);
    let ok = false;
    try {
      ok = await verify(hexToBytes(agentSignatureHex), utf8ToBytes(digest), hexToBytes(agentPublicKeyHex));
    } catch {
      ok = false;
    }
    if (!ok) {
      return { authorized: false, reason: "Invalid agent spend signature" };
    }
  }

  const price = ATTESTATION_CATALOG[product];
  const priceCredits = microsToCredits(price.price_micros);
  if (priceCredits > scope.max_credits) {
    return {
      authorized: false,
      reason: `Product costs ${priceCredits} credits which exceeds spend scope ceiling ${scope.max_credits}`,
    };
  }

  const meter = await meterAttestation(operatorId, product);
  if (!meter.allowed) {
    return { authorized: false, reason: meter.reason ?? "Insufficient credits" };
  }

  const paymentDigest = sha256Hex(
    [operatorId, product, meter.meter_ref ?? "", scope.nonce, new Date().toISOString()].join("|")
  );
  await recordCapabilityEvent(
    operatorId,
    `payment:${product}`,
    undefined,
    undefined,
    JSON.stringify({ scope_nonce: scope.nonce, payment_digest: paymentDigest, rail: "passport_credits" })
  ).catch(() => {});

  return {
    authorized: true,
    product,
    credits_charged: meter.credits_charged,
    remaining_credits: meter.remaining_credits,
    meter_ref: meter.meter_ref,
    payment_digest: paymentDigest,
  };
}

function computeRailHmac(reference: string, credits: number, rail: string, secret: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${reference}:${credits}:${rail}:${secret}`)));
}

export async function settleExternalRailPayment(opts: {
  operatorId: string;
  rail: AgentPaymentRail;
  reference: string;
  credit_credits: number;
  signature: string;
  amount_label?: string;
}): Promise<WalletSettlementResult> {
  const secret = process.env.AGENTIC_PAY_RAIL_SECRET;
  if (!secret) {
    return { accepted: false, reason: "Agentic pay rail not configured (AGENTIC_PAY_RAIL_SECRET unset)" };
  }

  const expectedSig = computeRailHmac(opts.reference, opts.credit_credits, opts.rail, secret);
  if (expectedSig !== opts.signature) {
    return { accepted: false, reason: "Invalid rail settlement signature" };
  }

  const idempotencyKey = `settle:${opts.rail}:${opts.reference}`;

  // H8: DB-level idempotency. We insert the settlement receipt FIRST on the
  // unique (rail, reference) constraint; a concurrent duplicate settlement
  // fails the insert (unique violation) instead of double-crediting. The
  // findFirst below is now only a fast-path hint, not the race closure.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.externalSettlement.create({
        data: {
          rail: opts.rail,
          reference: opts.reference,
          operatorId: opts.operatorId,
          creditCredits: opts.credit_credits,
          label: opts.amount_label ?? null,
        },
      });
      await tx.operator.update({
        where: { id: opts.operatorId },
        data: { credits: { increment: opts.credit_credits } },
      });
      await tx.capabilityLedgerEntry.create({
        data: {
          operatorId: opts.operatorId,
          eventType: `settlement:${opts.rail}`,
          metadata: JSON.stringify({
            idempotencyKey,
            reference: opts.reference,
            credits: opts.credit_credits,
            label: opts.amount_label ?? null,
          }),
        },
      });
    });
  } catch (err) {
    // Unique constraint violation on (rail, reference) = duplicate settlement.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return { accepted: false, reason: "Duplicate settlement reference (already applied)" };
    }
    // Any other error: rollback-safe (transaction), report it.
    const reason = err instanceof Error ? err.message : "Settlement failed";
    return { accepted: false, reason };
  }

  const balance = await getAgentWallet(opts.operatorId);
  return { accepted: true, credits_added: opts.credit_credits, new_balance: balance.credits };
}

export function railSignature(reference: string, credits: number, rail: string, secret: string): string {
  return computeRailHmac(reference, credits, rail, secret);
}