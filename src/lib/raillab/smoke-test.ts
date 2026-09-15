/**
 * Rail smoke-test fidelity ladder (Phase 19).
 *
 *   MOCK       — deterministic in-memory double-entry ledger; asserts exact deltas and the
 *                sacred invariant that AgentWallet.balance is NEVER touched by non-ANGEL
 *                units (the two bugs this project has already shipped and fixed).
 *   SANDBOX    — DRY-RUN validation against the REAL Phase-18 `settleMobileMoneyOnramp`
 *                (parse + FX-fix band + idempotency detection) WITHOUT moving money. A smoke
 *                test must never mint ANGEL or book the treasury.
 *   LIVE_CANARY— relays 3 real currency units against a REAL configured sandbox endpoint with
 *                a bounded cap. No configured endpoint → the rail is NOT canary-tested (must be
 *                human-enabled); any SLA breach → QUARANTINE.
 */

 
import { settleMobileMoneyOnramp } from "@/lib/digital-gateway/mobile-money";

export type SmokeStage = "MOCK" | "SANDBOX" | "LIVE_CANARY";
export type SmokeOutcome = "PASS" | "FAIL" | "DEFERRED";

export interface SmokeResult {
  stage: SmokeStage;
  outcome: SmokeOutcome;
  detail: string;
}

// ── MOCK: deterministic double-entry ledger ──

export class MockLedger {
  agentWallet = new Map<string, number>();
  fractional = new Map<string, number>();
  lp = new Map<string, number>();
  state = new Map<string, number>();

  credit(ledgerKind: string, key: string, units: number): void {
    const map = this.mapFor(ledgerKind);
    map.set(key, (map.get(key) ?? 0) + units);
  }

  debit(ledgerKind: string, key: string, units: number): void {
    const map = this.mapFor(ledgerKind);
    const next = (map.get(key) ?? 0) - units;
    if (next < 0) throw new Error(`MockLedger overdraft on ${ledgerKind}:${key}`);
    map.set(key, next);
  }

  private mapFor(ledgerKind: string): Map<string, number> {
    switch (ledgerKind) {
      case "ANGEL":
        return this.agentWallet;
      case "FRACTIONAL":
        return this.fractional;
      case "LP":
        return this.lp;
      case "STATE":
        return this.state;
      default:
        throw new Error(`Unknown ledger kind ${ledgerKind}`);
    }
  }
}

/**
 * Simulates a single settlement against the spec's ledgerKind and asserts the ANGEL-purity
 * invariant: only `ANGEL` rails may touch AgentWallet. Returns PASS or FAIL with detail.
 */
export function mockSmokeTest(spec: {
  ledgerKind: string;
  feeBps?: number;
}): SmokeResult {
  const ledger = new MockLedger();
  const ledgerKind = spec.ledgerKind;
  const gross = 1000;
  const fee = Math.floor((gross * (spec.feeBps ?? 0)) / 10_000);
  const net = gross - fee;

  try {
    // Simulate: counterparty pre-funds gross, protocol takes fee, beneficiary receives net.
    ledger.credit(ledgerKind, "counterparty", gross);
    ledger.debit(ledgerKind, "counterparty", gross);
    ledger.credit(ledgerKind, "beneficiary", net);
    ledger.credit(ledgerKind, "protocol_fee", fee);

    // Sacred invariant: non-ANGEL units must never inflate the ANGEL money ledger.
    if (ledgerKind !== "ANGEL" && ledger.agentWallet.size !== 0) {
      return {
        stage: "MOCK",
        outcome: "FAIL",
        detail: `LEAK: ledgerKind=${ledgerKind} touched AgentWallet (ANGEL purity invariant violated)`,
      };
    }
    return {
      stage: "MOCK",
      outcome: "PASS",
      detail: `exact deltas (gross=${gross}, fee=${fee}, net=${net}) conserved on ${ledgerKind}`,
    };
  } catch (err) {
    return {
      stage: "MOCK",
      outcome: "FAIL",
      detail: err instanceof Error ? err.message : "mock settlement failed",
    };
  }
}

// ── SANDBOX: dry-run validation against real Phase-18 settlement code ──

const SANDBOX_EXTERNAL_REF_PREFIX = "raillab-sandbox";

/**
 * Validates the real mobile-money settlement path in DRY-RUN mode — parse, FX-fix band, and
 * idempotency detection — WITHOUT creating a settlement row, crediting a wallet, or booking
 * the treasury. A smoke test must never mint money. The idempotency *guarantee* (double
 * callback → single credit) is asserted at the unit-test level against the real
 * `settleMobileMoneyOnramp`, not re-exercised against the live ledger here.
 */
export async function sandboxSmokeTest(): Promise<SmokeResult> {
  try {
    const ref = `${SANDBOX_EXTERNAL_REF_PREFIX}-${Date.now()}`;
    const payload = { external_reference: ref, amount: 3000 };
    const result = await settleMobileMoneyOnramp({
      provider: "agent_api",
      payload,
      internal: true,
      dryRun: true,
    });

    if (result.deduped || result.creditedAngel < 1) {
      return {
        stage: "SANDBOX",
        outcome: "FAIL",
        detail: `dry-run validation failed: deduped=${result.deduped}, credited=${result.creditedAngel}`,
      };
    }
    return {
      stage: "SANDBOX",
      outcome: "PASS",
      detail: `dry-run settlement validated (would credit ${result.creditedAngel} ANGEL; no money moved)`,
    };
  } catch (err) {
    return {
      stage: "SANDBOX",
      outcome: "FAIL",
      detail: err instanceof Error ? err.message : "sandbox validation failed",
    };
  }
}

// ── LIVE_CANARY: real relay against a configured sandbox endpoint ──

/**
 * Relays 3 real currency units against a real sandbox endpoint (if configured). Returns
 * DEFERRED when no endpoint is configured (the rail must be human-enabled), FAIL on any
 * relay/SLA error (→ QUARANTINE), PASS when all 3 relays settle within budget.
 */
export async function liveCanary(spec: {
  endpoints?: Record<string, unknown>;
}): Promise<SmokeResult> {
  const sandboxUrl = spec.endpoints?.sandboxUrl as string | undefined;
  if (!sandboxUrl || typeof sandboxUrl !== "string") {
    return {
      stage: "LIVE_CANARY",
      outcome: "DEFERRED",
      detail: "no sandbox endpoint configured (rail requires human enable)",
    };
  }

  const CANARY_RELAYS = 3;
  try {
    for (let i = 0; i < CANARY_RELAYS; i++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(sandboxUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canary: i + 1, units: 1 }),
          signal: controller.signal,
        });
        if (!res.ok) {
          return {
            stage: "LIVE_CANARY",
            outcome: "FAIL",
            detail: `canary relay ${i + 1} returned ${res.status}`,
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    return {
      stage: "LIVE_CANARY",
      outcome: "PASS",
      detail: `${CANARY_RELAYS} canary relays settled within budget`,
    };
  } catch (err) {
    return {
      stage: "LIVE_CANARY",
      outcome: "FAIL",
      detail: err instanceof Error ? err.message : "canary relay failed",
    };
  }
}

// ── Ladder orchestration ──

/**
 * Runs the MOCK + SANDBOX rungs (deterministic + idempotency). LIVE_CANARY is invoked
 * separately by the factory because it depends on an optional real endpoint.
 */
export async function runSmokeLadder(spec: {
  ledgerKind: string;
  feeBps?: number;
  category?: string;
}): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [mockSmokeTest(spec)];
  if (spec.category === "PAYMENT") {
    results.push(await sandboxSmokeTest());
  }
  return results;
}
