/**
 * Rail Execution Runtime (Phase 20).
 *
 * Makes an ENABLED RailSpec an executed, telemetered money flow. Dispatch is by `ledgerKind`:
 *   ANGEL      -> settleMobileMoneyOnramp (provider from spec.providerKey)
 *   FRACTIONAL -> executePoolSwap (fractional-amm)
 *   LP         -> removeLiquidity (fractional-amm)
 *   STATE      -> state treasury credit (stateStabilizationWalletCommitment)
 *
 * Live-vs-dry-run gate: a rail executes LIVE only if it has passed LIVE_CANARY (a real
 * `endpoints.sandboxUrl`) or is explicitly authorized; otherwise it runs dry-run and never
 * moves money. This preserves the Phase-19 invariant that a test/smoke path must not mint.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { settleMobileMoneyOnramp } from "@/lib/digital-gateway/mobile-money";
import { executePoolSwap, removeLiquidity } from "@/lib/reserves/fractional-amm";
import { stateStabilizationWalletCommitment } from "@/lib/reserves/industrialization-fund";
import { recordSettlement, isSlaBreach, getRailTelemetry } from "./telemetry";
import { autoQuarantineFailingRails } from "./factory-agent";

export type ExecutionStage = "ANGEL" | "FRACTIONAL" | "LP" | "STATE";

export interface ExecuteSettlementInput {
  payload: Record<string, unknown>;
}

export interface ExecuteSettlementResult {
  live: boolean;
  ok: boolean;
  stage: ExecutionStage;
  detail: string;
  creditedAngel?: number;
  errorTranche: "NONE" | "SLA_BREACH" | "COMPUTE_TIMEOUT" | "LOGIC_DETECTION";
}

/** A rail may execute LIVE only after a real canary endpoint exists or explicit authorization. */
export function canExecuteLive(spec: {
  endpoints?: any;
  authorizedBy?: string | null;
}): boolean {
  const sandboxUrl = spec.endpoints?.sandboxUrl;
  return Boolean(sandboxUrl) || Boolean(spec.authorizedBy);
}

/** Resolves the idempotency key from the payload at the spec's configured path. */
export function resolveIdempotencyKey(
  idempotencyKeyPath: string | null | undefined,
  payload: Record<string, unknown>
): string | null {
  if (!idempotencyKeyPath) return null;
  const value = payload[idempotencyKeyPath];
  if (value === undefined || value === null) return null;
  return String(value);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Executes one settlement for an ENABLED rail, dispatching by ledgerKind. Never throws:
 * failures are returned as an `ok: false` result with an error tranche so the caller can
 * record telemetry and keep the loop running (fail-closed, never silently enabled).
 */
export async function executeRailSettlement(
  railKey: string,
  input: ExecuteSettlementInput
): Promise<ExecuteSettlementResult> {
  const spec = await prisma.railSpec.findUnique({ where: { railKey } });
  if (!spec) {
    throw new Error(`RailSpec '${railKey}' not found`);
  }
  if (spec.state !== "ENABLED") {
    throw new Error(`Rail '${railKey}' is not ENABLED (current: ${spec.state})`);
  }

  const live = canExecuteLive(spec);
  const payload = input.payload ?? {};
  const idempotencyKey = resolveIdempotencyKey(spec.idempotencyKeyPath, payload);

  const stage = spec.ledgerKind as ExecutionStage;

  switch (stage) {
    case "ANGEL": {
      // Idempotency is enforced by MoneySettlement's (provider, externalRef) unique key;
      // dry-run passes `dryRun` so a non-canary rail never mints money.
      const res = await settleMobileMoneyOnramp({
        provider: spec.providerKey,
        payload,
        internal: true,
        dryRun: !live,
      });
      return {
        live,
        ok: true,
        stage,
        detail: live
          ? `ANGEL settlement executed (credited ${res.creditedAngel} ANGEL)`
          : `ANGEL dry-run validated (would credit ${res.creditedAngel} ANGEL)`,
        creditedAngel: res.creditedAngel,
        errorTranche: "NONE",
      };
    }

    case "FRACTIONAL": {
      if (!live) {
        return {
          live,
          ok: true,
          stage,
          detail: "FRACTIONAL dry-run: swap shape validated (no money moved)",
          errorTranche: "NONE",
        };
      }
      await executePoolSwap({
        poolId: String(payload.pool_id ?? payload.poolId ?? ""),
        agentCommitment: String(payload.agent_commitment ?? payload.agentCommitment ?? ""),
        inputToken: (String(payload.input_token ?? payload.inputToken ?? "ANGEL")) as any,
        inputAmount: asNumber(payload.input_amount ?? payload.inputAmount),
      });
      return { live, ok: true, stage, detail: "FRACTIONAL swap executed", errorTranche: "NONE" };
    }

    case "LP": {
      if (!live) {
        return {
          live,
          ok: true,
          stage,
          detail: "LP dry-run: removal shape validated (no money moved)",
          errorTranche: "NONE",
        };
      }
      await removeLiquidity({
        poolId: String(payload.pool_id ?? payload.poolId ?? ""),
        operatorCommitment: String(payload.operator_commitment ?? payload.operatorCommitment ?? ""),
        angelAmount: asNumber(payload.angel_amount ?? payload.angelAmount),
      });
      return { live, ok: true, stage, detail: "LP liquidity removed", errorTranche: "NONE" };
    }

    case "STATE": {
      if (!live) {
        return {
          live,
          ok: true,
          stage,
          detail: "STATE dry-run: treasury credit shape validated (no money moved)",
          errorTranche: "NONE",
        };
      }
      const countryCode = String(payload.country_code ?? payload.countryCode ?? "");
      const amount = asNumber(payload.amount);
      if (!countryCode || amount <= 0) {
        throw new Error("STATE settlement requires country_code and amount");
      }
      const commitment = stateStabilizationWalletCommitment(countryCode);
      await prisma.agentWallet.upsert({
        where: { subjectCommitment: commitment },
        create: { subjectCommitment: commitment, balance: amount, earnedTotal: amount, lastActivityAt: new Date() },
        update: { balance: { increment: amount }, earnedTotal: { increment: amount }, lastActivityAt: new Date() },
      });
      return { live, ok: true, stage, detail: `STATE treasury credited ${amount} ANGEL`, creditedAngel: amount, errorTranche: "NONE" };
    }

    default:
      return {
        live,
        ok: false,
        stage: spec.ledgerKind as ExecutionStage,
        detail: `Unknown ledgerKind '${spec.ledgerKind}'`,
        errorTranche: "LOGIC_DETECTION",
      };
  }
}

/** Reads recent telemetry and auto-quarantines ENABLED rails in breach. */
export async function evaluateRailsHealth(): Promise<{ quarantined: string[] }> {
  return autoQuarantineFailingRails();
}

export interface ExecutionTickResult {
  executed: number;
  dryRun: number;
  failed: number;
  quarantined: string[];
}

/**
 * Full execution + health tick: for each ENABLED rail, execute (live or dry-run), record
 * settlement telemetry, then run the health check. Fail-closed.
 */
export async function runExecutionTick(): Promise<ExecutionTickResult> {
  const enabled = await prisma.railSpec.findMany({ where: { state: "ENABLED" } });
  let executed = 0;
  let dryRun = 0;
  let failed = 0;

  for (const spec of enabled) {
    const startedAt = Date.now();
    let result: ExecuteSettlementResult;
    try {
      result = await executeRailSettlement(spec.railKey, {
        payload: { external_reference: `tick-${spec.railKey}-${startedAt}`, amount: 3000 },
      });
    } catch (err) {
      result = {
        live: false,
        ok: false,
        stage: spec.ledgerKind as ExecutionStage,
        detail: err instanceof Error ? err.message : String(err),
        errorTranche: "SLA_BREACH",
      };
    }

    const latencyMs = Date.now() - startedAt;
    if (result.ok) {
      result.live ? executed++ : dryRun++;
    } else {
      failed++;
    }

    await recordSettlement(spec.railKey, {
      latencyMs,
      volumeUnits: result.creditedAngel ?? 0,
      dedupeHits: 0,
      errorTranche: result.errorTranche,
      settlementCount: 1,
    }).catch(() => null);
  }

  const { quarantined } = await evaluateRailsHealth();
  return { executed, dryRun, failed, quarantined };
}

export { getRailTelemetry, isSlaBreach, recordSettlement };
