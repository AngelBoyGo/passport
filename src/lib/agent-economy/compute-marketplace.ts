/**
 * Metered Compute Marketplace (Phase 32).
 *
 * Agents sell inference/compute units to other agents for ANGEL — the self-contained demand
 * loop: a provider lists capacity, a buyer purchases metered units, ANGEL moves wallet-to-wallet
 * under the buyer's spend policy, and every purchase is idempotent. No external platform needed.
 */

import { prisma } from "@/lib/db";
import { checkSpendPolicy } from "./spend-policy-service";

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export interface CreateOfferInput {
  offerId: string;
  providerCommitment: string;
  capability: string;
  description?: string | null;
  unit?: string;
  priceAngelPerUnit: number;
  capacityUnits: number;
}

export type CreateOfferResult =
  | { ok: true; offer: { offerId: string; remainingUnits: number; status: string } }
  | { ok: false; error: string };

export function normalizeOfferInput(raw: CreateOfferInput): CreateOfferResult {
  const offerId = (raw.offerId ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(offerId)) return { ok: false, error: "offer_id must be a 2-64 char slug" };
  const providerCommitment = (raw.providerCommitment ?? "").toLowerCase();
  if (!COMMITMENT_RE.test(providerCommitment)) {
    return { ok: false, error: "provider_commitment must be 64-hex" };
  }
  const capability = (raw.capability ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(capability)) return { ok: false, error: "capability must be a 2-64 char slug" };

  const priceAngelPerUnit = Math.floor(Number(raw.priceAngelPerUnit));
  if (!Number.isFinite(priceAngelPerUnit) || priceAngelPerUnit <= 0) {
    return { ok: false, error: "price_angel_per_unit must be a positive integer" };
  }
  const capacityUnits = Math.floor(Number(raw.capacityUnits));
  if (!Number.isFinite(capacityUnits) || capacityUnits <= 0) {
    return { ok: false, error: "capacity_units must be a positive integer" };
  }
  return { ok: true, offer: { offerId, remainingUnits: capacityUnits, status: "ACTIVE" } };
}

/** Pure price of `units` at `priceAngelPerUnit`. */
export function quotePurchase(
  priceAngelPerUnit: number,
  units: number
): { ok: true; totalAngel: number } | { ok: false; error: string } {
  const u = Math.floor(Number(units));
  if (!Number.isFinite(u) || u <= 0) return { ok: false, error: "units must be a positive integer" };
  return { ok: true, totalAngel: Math.floor(priceAngelPerUnit) * u };
}

export async function createOffer(input: CreateOfferInput) {
  const normalized = normalizeOfferInput(input);
  if (!normalized.ok) throw new Error(normalized.error);
  const offerId = input.offerId.trim().toLowerCase();
  const providerCommitment = input.providerCommitment.toLowerCase();
  const capability = input.capability.trim().toLowerCase();
  const unit = (input.unit ?? "1k_tokens").trim().slice(0, 32) || "1k_tokens";
  const priceAngelPerUnit = Math.floor(Number(input.priceAngelPerUnit));
  const capacityUnits = Math.floor(Number(input.capacityUnits));

  return prisma.computeOffer.upsert({
    where: { offerId },
    create: {
      offerId,
      providerCommitment,
      capability,
      description: input.description ?? null,
      unit,
      priceAngelPerUnit,
      capacityUnits,
      remainingUnits: capacityUnits,
      status: "ACTIVE",
    },
    update: {
      capability,
      description: input.description ?? null,
      unit,
      priceAngelPerUnit,
      capacityUnits,
      remainingUnits: capacityUnits,
      status: "ACTIVE",
    },
  });
}

export async function listOffers(opts: {
  capability?: string;
  activeOnly?: boolean;
  limit?: number;
}) {
  return prisma.computeOffer.findMany({
    where: {
      ...(opts.capability ? { capability: opts.capability.trim().toLowerCase() } : {}),
      ...(opts.activeOnly === false ? {} : { status: "ACTIVE", remainingUnits: { gt: 0 } }),
    },
    orderBy: [{ priceAngelPerUnit: "asc" }],
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}

export type PurchaseResult =
  | { ok: true; purchaseId: string; units: number; totalAngel: number; providerCommitment: string; deduped: boolean }
  | { ok: false; code: string; error: string };

/**
 * Purchases `units` from an offer. Moves ANGEL from buyer → provider atomically, under the
 * buyer's spend policy, idempotent on `purchaseId`.
 */
export async function purchaseUnits(input: {
  offerId: string;
  buyerCommitment: string;
  units: number;
  purchaseId: string;
}): Promise<PurchaseResult> {
  const offerId = input.offerId.trim().toLowerCase();
  const buyerCommitment = input.buyerCommitment.toLowerCase();
  const purchaseId = input.purchaseId.trim();

  const offer = await prisma.computeOffer.findUnique({ where: { offerId } });
  if (!offer) return { ok: false, code: "offer_not_found", error: "Offer not found" };
  if (offer.status !== "ACTIVE") {
    return { ok: false, code: "offer_not_active", error: `Offer is ${offer.status}` };
  }
  if (buyerCommitment === offer.providerCommitment) {
    return { ok: false, code: "self_purchase", error: "Provider cannot purchase its own offer" };
  }

  const quote = quotePurchase(offer.priceAngelPerUnit, input.units);
  if (!quote.ok) return { ok: false, code: "invalid_units", error: quote.error };
  const { totalAngel } = quote;
  const units = Math.floor(input.units);

  if (offer.remainingUnits < units) {
    return { ok: false, code: "insufficient_capacity", error: "Offer has insufficient remaining capacity" };
  }

  // Autonomous spend policy (buyer → provider).
  const decision = await checkSpendPolicy({
    agentCommitment: buyerCommitment,
    amount: totalAngel,
    counterparty: offer.providerCommitment,
  });
  if (!decision.allowed) {
    return { ok: false, code: "spend_policy_denied", error: decision.reason || "Spend policy denied" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Idempotency: the unique purchaseId insert happens FIRST; a concurrent duplicate fails here.
      await tx.computePurchase.create({
        data: {
          purchaseId,
          offerId,
          buyerCommitment,
          providerCommitment: offer.providerCommitment,
          units,
          totalAngel,
          status: "SETTLED",
        },
      });

      const debit = await tx.agentWallet.updateMany({
        where: { subjectCommitment: buyerCommitment, balance: { gte: totalAngel } },
        data: {
          balance: { decrement: totalAngel },
          spentTotal: { increment: totalAngel },
          lastActivityAt: new Date(),
        },
      });
      if (debit.count !== 1) throw new Error("INSUFFICIENT_BALANCE");

      await tx.agentWallet.upsert({
        where: { subjectCommitment: offer.providerCommitment },
        create: {
          subjectCommitment: offer.providerCommitment,
          balance: totalAngel,
          earnedTotal: totalAngel,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: totalAngel },
          earnedTotal: { increment: totalAngel },
          lastActivityAt: new Date(),
        },
      });

      const cap = await tx.computeOffer.updateMany({
        where: { offerId, status: "ACTIVE", remainingUnits: { gte: units } },
        data: { remainingUnits: { decrement: units } },
      });
      if (cap.count !== 1) throw new Error("CAPACITY_RACE");
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const existing = await prisma.computePurchase.findUnique({ where: { purchaseId } });
      if (existing) {
        return {
          ok: true,
          purchaseId,
          units: existing.units,
          totalAngel: existing.totalAngel,
          providerCommitment: existing.providerCommitment,
          deduped: true,
        };
      }
    }
    const message = err instanceof Error ? err.message : "Purchase failed";
    if (message.includes("INSUFFICIENT_BALANCE")) {
      return { ok: false, code: "insufficient_balance", error: "Buyer has insufficient ANGEL balance" };
    }
    if (message.includes("CAPACITY_RACE")) {
      return { ok: false, code: "insufficient_capacity", error: "Offer capacity was consumed concurrently" };
    }
    return { ok: false, code: "internal_error", error: message };
  }

  // Best-effort: mark exhausted offers.
  await prisma.computeOffer
    .updateMany({ where: { offerId, remainingUnits: { lte: 0 } }, data: { status: "EXHAUSTED" } })
    .catch(() => null);

  return {
    ok: true,
    purchaseId,
    units,
    totalAngel,
    providerCommitment: offer.providerCommitment,
    deduped: false,
  };
}

export async function listPurchases(opts: { buyerCommitment?: string; offerId?: string; limit?: number }) {
  return prisma.computePurchase.findMany({
    where: {
      ...(opts.buyerCommitment ? { buyerCommitment: opts.buyerCommitment.toLowerCase() } : {}),
      ...(opts.offerId ? { offerId: opts.offerId.trim().toLowerCase() } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}
