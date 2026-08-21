import { prisma } from "@/lib/db";
import { decrementCredits } from "@/lib/operator";
import { recordCapabilityEvent } from "@/lib/operator";
import { getPublicKeyHex } from "@/lib/receipt/signer";

/**
 * Reputation-as-a-Service metering (2.7)
 * -------------------------------------
 * Passport already meters receipt issuance against an operator credit ledger.
 * This extends that same primitive into a reusable "attestation product"
 * catalog so verified reputation lookups, portable credential issuance, and
 * audit-package generation become explicitly metered, billable products.
 *
 * Micro-denomination keeps unit prices expressive without floating-point
 * money. 1_000_000 micro = 1 credit.
 */
export type AttestationProduct =
  | "reputation_lookup_verified"
  | "portable_credential_issuance"
  | "audit_package_generation"
  | "neutrality_residency_attestation";

export interface AttestationPrice {
  product: AttestationProduct;
  price_micros: number;
  label: string;
}

export const ATTESTATION_CATALOG: Record<AttestationProduct, AttestationPrice> = {
  reputation_lookup_verified: {
    product: "reputation_lookup_verified",
    price_micros: 100_000, // 0.1 credit
    label: "Verified reputation lookup (hardware-verified, signed)",
  },
  portable_credential_issuance: {
    product: "portable_credential_issuance",
    price_micros: 500_000, // 0.5 credit
    label: "W3C portable reputation credential issuance",
  },
  audit_package_generation: {
    product: "audit_package_generation",
    price_micros: 1_000_000, // 1 credit
    label: "Audit-grade compliance evidence package generation",
  },
  neutrality_residency_attestation: {
    product: "neutrality_residency_attestation",
    price_micros: 5_000_000, // 5 credits
    label: "Neutrality / residency attestation (premium)",
  },
};

export function microsToCredits(micros: number): number {
  return micros / 1_000_000;
}

/**
 * Resolves the operator's credit balance (denominated in whole credits).
 */
export async function getOperatorCreditBalance(operatorId: string): Promise<number> {
  const op = await prisma.operator.findUnique({
    where: { id: operatorId },
    select: { credits: true },
  });
  return op?.credits ?? 0;
}

/**
 * Meters an attestation product against the operator's credit ledger.
 * Refuses (returns { allowed:false, reason }) when balance is insufficient,
 * atomically debiting credits only on success. Records an audit entry so the
 * charge is fully traceable.
 */
export async function meterAttestation(
  operatorId: string,
  product: AttestationProduct,
  subjectCommitment?: string
): Promise<{
  allowed: boolean;
  reason?: string;
  product: AttestationProduct;
  price_micros: number;
  credits_charged: number;
  remaining_credits?: number;
  meter_ref?: string;
}> {
  const price = ATTESTATION_CATALOG[product];
  const creditsNeeded = microsToCredits(price.price_micros);

  let result: { allowed: boolean; reason?: string } = { allowed: false };

  await prisma.$transaction(async (tx) => {
    const available = await tx.operator.findUnique({
      where: { id: operatorId },
      select: { credits: true },
    });
    const credits = available?.credits ?? 0;
    if (credits < creditsNeeded) {
      result = {
        allowed: false,
        reason: `Insufficient credits: need ${creditsNeeded}, have ${credits}`,
      };
      return;
    }
    const meterRef = `meter_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await tx.capabilityLedgerEntry.create({
      data: {
        operatorId,
        agentId: subjectCommitment ?? null,
        eventType: `meter:${product}`,
        metadata: JSON.stringify({
          meter_ref: meterRef,
          price_micros: price.price_micros,
          product,
        }),
      },
    });
    await tx.operator.update({
      where: { id: operatorId },
      data: { credits: { decrement: creditsNeeded } },
    });
    result = { allowed: true };
  });

  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason,
      product,
      price_micros: price.price_micros,
      credits_charged: 0,
    };
  }

  const remaining = await getOperatorCreditBalance(operatorId);
  const meterRef = `meter_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await recordCapabilityEvent(
    operatorId,
    `meter:${product}`,
    subjectCommitment,
    undefined,
    JSON.stringify({ meter_ref: meterRef, price_micros: price.price_micros, product })
  ).catch(() => {});

  return {
    allowed: true,
    product,
    price_micros: price.price_micros,
    credits_charged: creditsNeeded,
    remaining_credits: remaining,
    meter_ref: meterRef,
  };
}

/**
 * Verifies the substrate signing key is available (for attestation signing).
 */
export function getAttestationSignerKid(): string {
  const pubKey = getPublicKeyHex();
  return `ed25519:${pubKey.slice(0, 16)}`;
}
