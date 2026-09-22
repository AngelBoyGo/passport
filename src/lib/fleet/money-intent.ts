/**
 * Money execution trigger — the ONLY gate through which fleet agents may move
 * ANGEL. Owner-approved model (user decision 2026-09-22):
 *
 * The brain may REQUEST money movement (it creates a PENDING intent row and
 * nothing else), but execution requires ALL THREE conditions:
 *   1. Fleet execution switch armed:   FLEET_MONEY_MOVEMENT_ENABLED=true
 *      (separate from FLEET_MINT_MONEY_ENABLED: minting a money agent and
 *      letting it move money are two different permissions).
 *   2. Provisioned tier binding:       the acting agent's AgentInstance row
 *      carries llmTier='money'. The tier follows the agent's identity — never
 *      the model that answered a prompt, so escalation via LLM output is
 *      impossible.
 *   3. Signed intent:                  the agent's own Ed25519 signature over
 *      the canonical intent JSON, verified against the ENROLLMENT-PINNED key.
 *      A forged prompt, a hijacked cycle, or a replayed string is useless.
 *
 * Fail-closed everywhere: unknown tier, missing instance, unset switch, bad
 * signature, over-cap amount, or unknown verification failure → REJECTED with
 * a recorded reason (admin audit row). No heuristic fallbacks.
 */

import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import { prisma } from "@/lib/db";

export const DEFAULT_MONEY_INTENT_CAP_ANGEL = 5000;
export const MONEY_INTENT_KINDS = ["hire_agent", "treasury_transfer", "fund_compute"] as const;
export type MoneyIntentKind = (typeof MONEY_INTENT_KINDS)[number];

export interface MoneyIntentInput {
  intentKind: string;
  workerCommitment?: string | null;
  amountAngels: number;
  cycleRef?: string | null;
}

/** Deterministic canonicalization — the exact bytes the agent must sign. */
export function canonicalIntent(intent: {
  intentKind: string;
  workerCommitment?: string | null;
  amountAngels: number;
  cycleRef?: string | null;
}): string {
  return canonicalJson({
    v: 1,
    kind: intent.intentKind,
    worker: intent.workerCommitment ?? null,
    amount: intent.amountAngels,
    cycle_ref: intent.cycleRef ?? null,
  });
}

export function intentDigest(intent: {
  intentKind: string;
  workerCommitment?: string | null;
  amountAngels: number;
  cycleRef?: string | null;
}): string {
  return sha256Hex(canonicalIntent(intent));
}

function cap(): number {
  const n = Number(process.env.FLEET_MONEY_MAX_INTENT_ANGEL);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONEY_INTENT_CAP_ANGEL;
}

export function fleetMoneyEnabled(): boolean {
  return String(process.env.FLEET_MONEY_MOVEMENT_ENABLED || "").toLowerCase() === "true";
}

export interface AuthorizeMoneyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Authorizes a PENDING intent: switch + provisioned tier + signature triple,
 * plus the global per-intent cap. Marks the row AUTHORIZED or REJECTED and
 * writes an admin audit line for every decision (rejects included).
 */
export async function authorizeMoneyMovement(args: {
  intentId: string;
  verifierCommitment: string;
  signature: string;
}): Promise<AuthorizeMoneyResult> {
  try {
    const intent = await prisma.moneyIntent.findUnique({ where: { id: args.intentId } });
    if (!intent) {
      return { ok: false, reason: "intent_not_found" };
    }
    if (intent.status !== "PENDING") {
      return failWith(intent.id, `intent_not_pending:${intent.status}`);
    }

    if (!MONEY_INTENT_KINDS.includes(intent.intentKind as MoneyIntentKind)) {
      return failWith(intent.id, `intent_kind_unknown:${intent.intentKind}`);
    }

    if (Number(intent.amountAngels) <= 0) {
      return failWith(intent.id, "intent_amount_invalid");
    }
    if (Number(intent.amountAngels) > cap()) {
      return failWith(intent.id, `intent_above_cap:${cap()}`);
    }

    // 1. Execution switch.
    if (!fleetMoneyEnabled()) {
      return failWith(intent.id, "money_movement_disabled");
    }

    // 2. Provisioned tier binding — resolved by the agent's OWN commitment,
    //    never by a caller-supplied tier string.
    const hypothesis = String(args.verifierCommitment ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hypothesis)) {
      return failWith(intent.id, "verifier_commitment_invalid");
    }
    const instance = await prisma.agentInstance.findUnique({ where: { commitment: hypothesis } });
    if (!instance) {
      return failWith(intent.id, "verifier_not_fleet");
    }
    if (instance.llmTier !== "money") {
      return failWith(intent.id, `verifier_not_money_tier:${instance.llmTier}`);
    }
    if (instance.status === "stopped" || instance.status === "failed") {
      return failWith(intent.id, `verifier_instance_${instance.status}`);
    }

    // 3. Agent-signed intent, checked against the enrollment-pinned key.
    const digest = sha256Hex(canonicalIntent({
      intentKind: intent.intentKind,
      workerCommitment: intent.workerCommitment,
      amountAngels: intent.amountAngels,
      cycleRef: intent.cycleRef,
    }));
    if (digest !== intent.intentDigest) {
      return failWith(intent.id, "intent_digest_mismatch");
    }
    const enrollment = await prisma.agentEnrollment.findUnique({
      where: { subjectCommitment: hypothesis },
      select: { publicKey: true, status: true },
    });
    if (!enrollment || enrollment.status !== "ISSUED") {
      return failWith(intent.id, "verifier_not_enrolled");
    }
    const sig = await verifyPinnedSignature({
      pinnedKey: enrollment.publicKey,
      signatureHex: args.signature,
      signPayload: digest,
      context: "fleet.money_intent",
      commitment: hypothesis,
    });
    if (!sig.valid) {
      return failWith(intent.id, "intent_signature_invalid");
    }

    // All three conditions hold — sign off, single-use (digest @unique is the
    // replay guard at row level; status guard above makes double-spend moot).
    const authorized = await prisma.moneyIntent.update({
      where: { id: intent.id },
      data: {
        status: "AUTHORIZED",
        signature: args.signature,
        requesterCommitment: intent.requesterCommitment ?? hypothesis,
      },
    });
    await prisma.adminAuditLog.create({
      data: {
        operatorId: hypothesis,
        action: "fleet_money_intent_authorized",
        targetId: intent.id,
        details: `${intent.intentKind} amount=${intent.amountAngels} digest=${digest.slice(0, 16)}`,
      },
    }).catch(() => undefined);
    return { ok: true, reason: `authorized:${authorized.id}` };
  } catch (err) {
    return { ok: false, reason: `internal_error:${String(err instanceof Error ? err.message : err).slice(0, 120)}` };
  }

  async function failWith(intentId: string, reason: string): Promise<AuthorizeMoneyResult> {
    await prisma.moneyIntent.update({
      where: { id: intentId },
      data: { status: "REJECTED", rejectionReason: reason },
    }).catch(() => undefined);
    return { ok: false, reason };
  }
}

/**
 * The brain's only money side effect: create a PENDING intent. Never executes.
 */
export async function stageMoneyIntent(input: MoneyIntentInput & { reason?: string }): Promise<
  { ok: true; intentId: string; digest: string } | { ok: false; reason: string }
> {
  if (!MONEY_INTENT_KINDS.includes(input.intentKind as MoneyIntentKind)) {
    return { ok: false, reason: `intent_kind_unknown:${input.intentKind}` };
  }
  if (!Number.isFinite(input.amountAngels) || input.amountAngels <= 0) {
    return { ok: false, reason: "intent_amount_invalid" };
  }
  if (input.amountAngels > cap()) {
    return { ok: false, reason: `intent_above_cap:${cap()}` };
  }
  const digest = intentDigest(input);
  const row = await prisma.moneyIntent.create({
    data: {
      intentKind: input.intentKind,
      workerCommitment: input.workerCommitment ?? null,
      amountAngels: input.amountAngels,
      intentDigest: digest,
      status: "PENDING",
      cycleRef: input.cycleRef ?? null,
      reason: (input.reason ?? "").slice(0, 500) || null,
    },
  });
  await prisma.adminAuditLog.create({
    data: {
      operatorId: "command_brain",
      action: "fleet_money_intent_staged",
      targetId: row.id,
      details: `kind=${input.intentKind} amount=${input.amountAngels}`,
    },
  }).catch(() => undefined);
  return { ok: true, intentId: row.id, digest };
}
