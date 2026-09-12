/**
 * Metered Compute Marketplace (Phase 32).
 *
 * Agents sell inference/compute units to other agents for ANGEL — the self-contained demand
 * loop: a provider lists capacity, a buyer purchases metered units, ANGEL moves wallet-to-wallet
 * under the buyer's spend policy, and every purchase is idempotent. No external platform needed.
 */

import { prisma } from "@/lib/db";
import { checkSpendPolicy } from "./spend-policy-service";
import { computeReputationBatch } from "@/lib/reputation/agent-reputation";

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
  const rows = await prisma.computeOffer.findMany({
    where: {
      ...(opts.capability ? { capability: opts.capability.trim().toLowerCase() } : {}),
      ...(opts.activeOnly === false ? {} : { status: "ACTIVE", remainingUnits: { gt: 0 } }),
    },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });

  const reputation = await computeReputationBatch(rows.map((r) => r.providerCommitment));
  return rows
    .map((r) => ({
      ...r,
      provider_reputation_score: reputation.get(r.providerCommitment.toLowerCase())?.score ?? 0,
      provider_reputation_tier: reputation.get(r.providerCommitment.toLowerCase())?.tier ?? "bronze",
    }))
    .sort(
      (a, b) =>
        b.provider_reputation_score - a.provider_reputation_score ||
        a.priceAngelPerUnit - b.priceAngelPerUnit
    );
}

export type PurchaseResult =
  | {
      ok: true;
      purchaseId: string;
      units: number;
      totalAngel: number;
      providerCommitment: string;
      status: string;
      deduped: boolean;
    }
  | { ok: false; code: string; error: string };

/**
 * Purchases `units` from an offer **escrow-style (pay-on-delivery)**: the buyer's ANGEL is
 * debited and HELD (not yet paid to the provider), offer capacity is consumed, and the purchase
 * starts in `HELD`. The provider marks DELIVERED, then the buyer releases (→ provider paid) or
 * refunds (→ buyer made whole, capacity restored). Idempotent on `purchaseId`.
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
          status: "HELD",
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

      // NOTE: the provider is NOT credited yet — funds are held until release.
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
          status: existing.status,
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
    status: "HELD",
    deduped: false,
  };
}

// ── Escrow lifecycle (pay-on-delivery) ──

export type LifecycleResult =
  | { ok: true; purchaseId: string; status: string }
  | { ok: false; code: string; error: string };

/** Provider marks a HELD purchase as DELIVERED (optionally with a deliverable digest). */
export async function deliverCompute(input: {
  purchaseId: string;
  providerCommitment: string;
  deliverableDigest?: string | null;
}): Promise<LifecycleResult> {
  const purchaseId = input.purchaseId.trim();
  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId } });
  if (!purchase) return { ok: false, code: "purchase_not_found", error: "Purchase not found" };
  if (purchase.providerCommitment !== input.providerCommitment.toLowerCase()) {
    return { ok: false, code: "not_provider", error: "Only the provider may mark delivery" };
  }
  const upd = await prisma.computePurchase.updateMany({
    where: { purchaseId, status: "HELD" },
    data: { status: "DELIVERED" },
  });
  if (upd.count !== 1) {
    return { ok: false, code: "invalid_state", error: `Purchase is ${purchase.status}` };
  }
  void input.deliverableDigest;
  return { ok: true, purchaseId, status: "DELIVERED" };
}

/** Buyer (or ISSUER) releases a DELIVERED purchase, paying the provider. */
export async function releaseCompute(input: {
  purchaseId: string;
  actorCommitment: string;
  isIssuer: boolean;
}): Promise<LifecycleResult> {
  const purchaseId = input.purchaseId.trim();
  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId } });
  if (!purchase) return { ok: false, code: "purchase_not_found", error: "Purchase not found" };
  if (!input.isIssuer && purchase.buyerCommitment !== input.actorCommitment.toLowerCase()) {
    return { ok: false, code: "not_party", error: "Only the buyer may release this purchase" };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.computePurchase.updateMany({
        where: { purchaseId, status: "DELIVERED" },
        data: { status: "SETTLED" },
      });
      if (upd.count !== 1) throw new Error("INVALID_STATE");
      await tx.agentWallet.upsert({
        where: { subjectCommitment: purchase.providerCommitment },
        create: {
          subjectCommitment: purchase.providerCommitment,
          balance: purchase.totalAngel,
          earnedTotal: purchase.totalAngel,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: purchase.totalAngel },
          earnedTotal: { increment: purchase.totalAngel },
          lastActivityAt: new Date(),
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "release failed";
    if (message.includes("INVALID_STATE")) {
      return { ok: false, code: "invalid_state", error: `Purchase is ${purchase.status}` };
    }
    return { ok: false, code: "internal_error", error: message };
  }
  return { ok: true, purchaseId, status: "SETTLED" };
}

/** Buyer (or ISSUER) refunds a HELD/DELIVERED purchase; funds return and capacity is restored. */
export async function refundCompute(input: {
  purchaseId: string;
  actorCommitment: string;
  isIssuer: boolean;
}): Promise<LifecycleResult> {
  const purchaseId = input.purchaseId.trim();
  const purchase = await prisma.computePurchase.findUnique({ where: { purchaseId } });
  if (!purchase) return { ok: false, code: "purchase_not_found", error: "Purchase not found" };
  if (!input.isIssuer && purchase.buyerCommitment !== input.actorCommitment.toLowerCase()) {
    return { ok: false, code: "not_party", error: "Only the buyer may refund this purchase" };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.computePurchase.updateMany({
        where: { purchaseId, status: { in: ["HELD", "DELIVERED"] } },
        data: { status: "REFUNDED" },
      });
      if (upd.count !== 1) throw new Error("INVALID_STATE");
      await tx.agentWallet.upsert({
        where: { subjectCommitment: purchase.buyerCommitment },
        create: {
          subjectCommitment: purchase.buyerCommitment,
          balance: purchase.totalAngel,
          earnedTotal: 0,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: purchase.totalAngel },
          lastActivityAt: new Date(),
        },
      });
      await tx.computeOffer.update({
        where: { offerId: purchase.offerId },
        data: { remainingUnits: { increment: purchase.units } },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "refund failed";
    if (message.includes("INVALID_STATE")) {
      return { ok: false, code: "invalid_state", error: `Purchase is ${purchase.status}` };
    }
    return { ok: false, code: "internal_error", error: message };
  }
  return { ok: true, purchaseId, status: "REFUNDED" };
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
