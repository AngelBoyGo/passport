/**
 * Sahel Digital Money Gateway — mobile-money on-ramp orchestrator (Phase 18).
 *
 * Settles a confirmed mobile-money (or agent-API) FCFA payment into ANGEL with
 * exactly-once semantics:
 *   1. Parse callback via the provider adapter.
 *   2. HMAC-SHA256 verify the callback signature (production rejects bad signatures;
 *      dev/test accept an injected secret).
 *   3. Load the current XOF fix (staleness + band guard).
 *   4. Create the MoneySettlement row FIRST (committed, status PENDING) as the idempotency
 *      lock; a redelivered callback hits the unique (provider, externalRef) index and
 *      returns the ORIGINAL event — no double credit.
 *   5. In a single atomic `$transaction`, credit the collector wallet, book the fiat gross
 *      into the protocol treasury ledger consumed by GET /api/v1/rate, and flip the row to
 *      SETTLED. On any failure the row is flipped to PENDING_REVIEW (no credit).
 */

import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/receipt/canonical";
import { getFiatFix, xofToAngel } from "./fiat-fix";
import { MoneyProvider, getProviderSecret } from "./providers/contract";
import { OrangeMoneyProvider } from "./providers/orangemoney";
import { MoovMoneyProvider } from "./providers/moov";
import { MomoProvider } from "./providers/momo";
import { UssdProvider } from "./providers/ussd";
import { AgentApiProvider } from "./providers/agent-api";

export const MOBILE_MONEY_PROVIDERS: Record<string, MoneyProvider> = {
  orangemoney: OrangeMoneyProvider,
  moov: MoovMoneyProvider,
  momo: MomoProvider,
  ussd: UssdProvider,
  agent_api: AgentApiProvider,
};

export const FX_FIX_REFERENCE_RATE_USD = 1 / 600.0;

export interface SettleOnrampInput {
  provider: string;
  payload: unknown;
  /** Optional override: only used from authenticated agent-API / USSD paths. */
  targetCommitment?: string;
  /** Test-injectable secret; in production read from env. */
  secret?: string;
  /**
   * Internal (USSD / agent-API) settlements are already authenticated at the HTTP layer,
   * so provider HMAC is skipped. Provider callbacks MUST NOT set this.
   */
  internal?: boolean;
  /**
   * Dry-run: performs the full validation path (parse, FX fix, dedupe detection) but
   * NEVER creates a settlement row, credits a wallet, or books the treasury. Used by the
   * Rail Factory smoke-test ladder so a "test" never mints money in production.
   */
  dryRun?: boolean;
}

export interface SettleOnrampResult {
  deduped: boolean;
  settlementId: string;
  provider: string;
  externalRef: string;
  xofAmount: number;
  xofRateUsd: number;
  creditedAngel: number;
  targetCommitment: string;
  status: string;
}

/** Collector wallet for a mobile-money settlement: sha256Hex("mobilemoney:operator:<externalRef>"). */
export function collectorWalletCommitment(externalRef: string): string {
  return sha256Hex(`mobilemoney:operator:${externalRef}`);
}

/**
 * Atomically settles a provider callback. Returns the row — either freshly created
 * (deduped=false) or the original (deduped=true) — and never double-credits.
 */
export async function settleMobileMoneyOnramp(
  input: SettleOnrampInput
): Promise<SettleOnrampResult> {
  const provider = MOBILE_MONEY_PROVIDERS[input.provider.toLowerCase()];
  if (!provider) {
    throw new Error(`Unknown money provider '${input.provider}'`);
  }

  const { externalRef, xofAmount, raw } = provider.parseCallback(input.payload);

  // HMAC verification. Provider callbacks always verify; an internal (already
  // authenticated USSD/agent-API) settlement skips provider HMAC.
  if (!input.internal) {
    const secret = input.secret ?? getProviderSecret(provider.name);
    const verified = await provider.verifyCallbackSignature(input.payload, secret);
    if (!verified && process.env.NODE_ENV === "production") {
      throw new Error(`Invalid ${provider.name} callback signature`);
    }
  }

  const fix = await getFiatFix("XOF", FX_FIX_REFERENCE_RATE_USD);
  const creditedAngel = xofToAngel(xofAmount, fix.rateUsdPerUnit);
  const targetCommitment =
    input.targetCommitment ?? collectorWalletCommitment(externalRef);

  // 0. Dry-run: validate without any money mutation. Detects a prior settlement for
  //    idempotency reporting, but never persists a row or moves funds.
  if (input.dryRun) {
    const existing = await prisma.moneySettlement.findUnique({
      where: { provider_externalRef: { provider: provider.name, externalRef } },
    });
    if (existing) {
      return {
        deduped: true,
        settlementId: existing.id,
        provider: existing.provider,
        externalRef: existing.externalRef,
        xofAmount: existing.xofAmount,
        xofRateUsd: existing.xofRateUsd,
        creditedAngel: existing.creditedAngel,
        targetCommitment: existing.targetCommitment,
        status: existing.status,
      };
    }
    return {
      deduped: false,
      settlementId: "dry-run",
      provider: provider.name,
      externalRef,
      xofAmount,
      xofRateUsd: fix.rateUsdPerUnit,
      creditedAngel,
      targetCommitment,
      status: "PENDING",
    };
  }

  // 1. Idempotency lock: create the settlement row FIRST (committed). The unique
  //    (provider, externalRef) index makes a concurrent redelivery collide.
  let settlement;
  try {
    settlement = await prisma.moneySettlement.create({
      data: {
        provider: provider.name,
        externalRef,
        xofAmount,
        xofRateUsd: fix.rateUsdPerUnit,
        creditedAngel,
        targetCommitment,
        status: "PENDING",
        metadata: raw,
      },
    });
  } catch {
    const existing = await prisma.moneySettlement.findUnique({
      where: { provider_externalRef: { provider: provider.name, externalRef } },
    });
    if (!existing) {
      throw new Error("Settlement dedupe read failed");
    }
    return {
      deduped: true,
      settlementId: existing.id,
      provider: existing.provider,
      externalRef: existing.externalRef,
      xofAmount: existing.xofAmount,
      xofRateUsd: existing.xofRateUsd,
      creditedAngel: existing.creditedAngel,
      targetCommitment: existing.targetCommitment,
      status: existing.status,
    };
  }

  // 2. Atomic credit + treasury booking + SETTLED flip.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.agentWallet.upsert({
        where: { subjectCommitment: targetCommitment },
        create: {
          subjectCommitment: targetCommitment,
          balance: creditedAngel,
          earnedTotal: creditedAngel,
          lastActivityAt: new Date(),
        },
        update: {
          balance: { increment: creditedAngel },
          earnedTotal: { increment: creditedAngel },
          lastActivityAt: new Date(),
        },
      });

      // Book fiat gross into the protocol treasury ledger consumed by GET /api/v1/rate.
      // kind "sahel_onramp" is added to the fiat-reserve allowlist in that route.
      const deltaMicros = Math.round(xofAmount * fix.rateUsdPerUnit * 1_000_000);
      await tx.operatorLedgerEntry.create({
        data: {
          operatorId: "protocol_treasury",
          deltaMicros,
          kind: "sahel_onramp",
          metadata: JSON.stringify({ provider: provider.name, externalRef, xofAmount }),
        },
      });

      await tx.moneySettlement.update({
        where: { id: settlement.id },
        data: { status: "SETTLED", settledAt: new Date() },
      });
    });
  } catch (err) {
    // Fail-close: no credit persisted; flag for ops review.
    await prisma.moneySettlement
      .update({ where: { id: settlement.id }, data: { status: "PENDING_REVIEW" } })
      .catch(() => null);
    throw err instanceof Error ? err : new Error("settlement failed");
  }

  return {
    deduped: false,
    settlementId: settlement.id,
    provider: provider.name,
    externalRef,
    xofAmount,
    xofRateUsd: fix.rateUsdPerUnit,
    creditedAngel,
    targetCommitment,
    status: "SETTLED",
  };
}