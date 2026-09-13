/**
 * External revenue bridge (Phase 35).
 *
 * Opens the loop outward: verified USD revenue earned OUTSIDE the system (e.g. an agent selling
 * a dataset) is credited to that agent's ANGEL wallet at parity, and recorded as reserve — so
 * external money enters without breaking 1:1 backing. Idempotent on `external_ref`; authenticity
 * is proven by an HMAC over the revenue fields (partner rails) or an ISSUER key.
 */

import { timingSafeEqual } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { prisma } from "@/lib/db";
import { PARITY_USD, revenueIssuanceQuote } from "@/lib/monetary/parity";
import { markJobSold } from "./pipeline";

/** USD cents → whole ANGEL at the current parity anchor. */
export function usdCentsToAngel(grossUsdCents: number): number {
  const cents = Math.max(0, Math.floor(grossUsdCents));
  return Math.floor(cents / (PARITY_USD * 100));
}

export interface RevenueFields {
  agentCommitment: string;
  source: string;
  externalRef: string;
  grossUsdCents: number;
}

/** HMAC-style signature over the revenue fields (sha256 hex of the canonical field string). */
export function computeRevenueSignature(fields: RevenueFields, secret: string): string {
  const agent = fields.agentCommitment.toLowerCase();
  return bytesToHex(
    sha256(utf8ToBytes(`${fields.externalRef}:${fields.grossUsdCents}:${agent}:${fields.source}:${secret}`))
  );
}

export function verifyRevenueSignature(
  fields: RevenueFields,
  signature: string,
  secret: string
): boolean {
  const expected = computeRevenueSignature(fields, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RevenueResult =
  | {
      ok: true;
      entryId: string;
      externalRef: string;
      grossUsdCents: number;
      angelCredited: number;
      reserveUsdAdded: number;
      deduped: boolean;
    }
  | { ok: false; code: string; error: string };

/**
 * Credits verified external revenue to an agent. `trusted` (ISSUER) skips the HMAC check.
 */
export async function creditExternalRevenue(
  input: RevenueFields & { signature?: string; pipelineJobId?: string },
  opts: { trusted: boolean } = { trusted: false }
): Promise<RevenueResult> {
  const agentCommitment = input.agentCommitment.toLowerCase();
  const source = input.source.trim();
  const externalRef = input.externalRef.trim();
  const grossUsdCents = Math.floor(input.grossUsdCents);

  if (!/^[0-9a-f]{64}$/i.test(agentCommitment)) {
    return { ok: false, code: "invalid_commitment", error: "agent_commitment must be 64-hex" };
  }
  if (!source) return { ok: false, code: "invalid_source", error: "source is required" };
  if (!externalRef) return { ok: false, code: "invalid_ref", error: "external_ref is required" };
  if (!Number.isFinite(grossUsdCents) || grossUsdCents <= 0) {
    return { ok: false, code: "invalid_amount", error: "gross_usd_cents must be a positive integer" };
  }

  if (!opts.trusted) {
    const secret = process.env.REVENUE_BRIDGE_SECRET;
    if (!secret) {
      return { ok: false, code: "not_configured", error: "REVENUE_BRIDGE_SECRET not configured" };
    }
    if (!verifyRevenueSignature({ agentCommitment, source, externalRef, grossUsdCents }, input.signature ?? "", secret)) {
      return { ok: false, code: "invalid_signature", error: "Invalid revenue signature" };
    }
  }

  const quote = revenueIssuanceQuote({ grossUsdCents, supplyAngel: 0, reserveUsd: 0 });
  const angelCredited = quote.angelCredited;
  if (angelCredited < 1) {
    return { ok: false, code: "below_floor", error: "Revenue is below the 1 ANGEL crediting floor" };
  }

  const agent = await prisma.agent.findFirst({
    where: { agentId: agentCommitment },
    select: { operatorId: true },
  });
  if (!agent) return { ok: false, code: "agent_not_found", error: "Agent not found" };

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRevenue.create({
        data: {
          agentCommitment,
          source,
          externalRef,
          grossUsdCents,
          angelCredited,
          status: "CREDITED",
        },
      });
      await tx.agentWallet.upsert({
        where: { subjectCommitment: agentCommitment },
        create: {
          subjectCommitment: agentCommitment,
          balance: angelCredited,
          earnedTotal: angelCredited,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: angelCredited },
          earnedTotal: { increment: angelCredited },
          lastActivityAt: new Date(),
        },
      });
      // Record the external USD as reserve inflow (backing the minted ANGEL 1:1).
      await tx.operatorLedgerEntry.create({
        data: {
          operatorId: agent.operatorId,
          deltaMicros: grossUsdCents * 10_000,
          kind: "external_revenue",
          metadata: JSON.stringify({ agent_commitment: agentCommitment, source, external_ref: externalRef }),
        },
      });
      if (input.pipelineJobId) {
        await markJobSold(tx as never, input.pipelineJobId, externalRef);
      }
      return created;
    });

    return {
      ok: true,
      entryId: entry.id,
      externalRef,
      grossUsdCents,
      angelCredited,
      reserveUsdAdded: quote.reserveUsdAdded,
      deduped: false,
    };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const existing = await prisma.agentRevenue.findUnique({ where: { externalRef } });
      if (existing) {
        return {
          ok: true,
          entryId: existing.id,
          externalRef,
          grossUsdCents: existing.grossUsdCents,
          angelCredited: existing.angelCredited,
          reserveUsdAdded: existing.grossUsdCents / 100,
          deduped: true,
        };
      }
    }
    return { ok: false, code: "internal_error", error: err instanceof Error ? err.message : "credit failed" };
  }
}

export async function listAgentRevenue(commitment: string, limit = 50) {
  return prisma.agentRevenue.findMany({
    where: { agentCommitment: commitment.toLowerCase() },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}
