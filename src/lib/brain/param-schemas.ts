/**
 * Per-action parameter validation for the Command Brain (Phase 40).
 *
 * Previously the LLM could supply arbitrary `params` objects — only `rail_key`
 * was checked non-empty at execution time. Strict per-action schemas now reject
 * unknown keys and malformed values BEFORE execution, closing parameter-injection
 * and garbage-data paths. Validation is deterministic policy — never LLM-judged.
 */

import { z } from "zod";
import type { BrainAction } from "@/lib/brain/command-brain";

const REASON_MAX = 500;
const ID_MAX = 200;
/**
 * Cap on any single brain-staged money intent. MUST track the enforcement cap
 * in fleet/money-intent.ts (env FLEET_MONEY_MAX_INTENT_ANGEL, default 5000) so
 * the brain's schema is never LOOSER than the executor's check. Read lazily so
 * an env change applies without a rebuild; fall back to the default on NaN.
 */
const DEFAULT_MONEY_INTENT_ANGEL = 5000;
function maxMoneyIntentAngels(): number {
  const n = Number(process.env.FLEET_MONEY_MAX_INTENT_ANGEL);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONEY_INTENT_ANGEL;
}
/** Bounded fleet blast radius per brain cycle (matches fleet-actions MAX_SCALE_PER_CYCLE). */
const MAX_SCALE_PER_CYCLE = 3;

export const NOOP_PARAMS = z.object({}).strict();

export const RECORD_NOTE_PARAMS = z
  .object({ note: z.string().min(1).max(1000).optional() })
  .strict();

export const EMPTY_PARAMS = z.object({}).strict();

export const QUARANTINE_RAIL_PARAMS = z
  .object({
    rail_key: z.string().min(1).max(ID_MAX),
    reason: z.string().min(1).max(REASON_MAX).optional(),
  })
  .strict();

export const INVESTIGATE_DISPUTE_PARAMS = z
  .object({
    dispute_id: z.string().min(1).max(ID_MAX).optional(),
    reason: z.string().min(1).max(REASON_MAX).optional(),
  })
  .strict();

export const RUN_RESEARCH_SCAN_PARAMS = z
  .object({ focus: z.string().min(1).max(200).optional() })
  .strict();

export const RUN_EXTERNAL_RESEARCH_PARAMS = z
  .object({ focus: z.string().min(1).max(200).optional() })
  .strict();

export const SCALE_FLEET_UP_PARAMS = z
  .object({
    capability: z.string().min(1).max(ID_MAX),
    llm_tier: z.enum(["neuron", "money"]),
    count: z.number().int().min(1).max(MAX_SCALE_PER_CYCLE).optional(),
  })
  .strict();

export const RETIRE_AGENT_PARAMS = z
  .object({
    commitment: z.string().regex(/^[0-9a-fA-F]{64}$/, "commitment must be 64-hex"),
    reason: z.string().min(1).max(REASON_MAX).optional(),
  })
  .strict();

export const REQUEST_MONEY_INTENT_PARAMS = z
  .object({
    intent_kind: z.enum(["hire_agent", "treasury_transfer", "fund_compute"]),
    worker_commitment: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "worker_commitment must be 64-hex")
      .optional(),
    amount_angels: z.number().positive(),
    reason: z.string().min(1).max(REASON_MAX),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Cap is env-driven and must never exceed the executor's own check.
    if (val.amount_angels > maxMoneyIntentAngels()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `amount_angels exceeds cap ${maxMoneyIntentAngels()}`,
      });
    }
  });

/**
 * Strict param schema per allowlisted action. Unknown keys are rejected.
 * Every action MUST have an entry — enforced by the Record<BrainAction, ...> type.
 */
export const ACTION_PARAM_SCHEMAS: Record<BrainAction, z.ZodTypeAny> = {
  NOOP: NOOP_PARAMS,
  RECORD_NOTE: RECORD_NOTE_PARAMS,
  RUN_DISCOVERY: EMPTY_PARAMS,
  RUN_TICK: EMPTY_PARAMS,
  TRIGGER_ATTESTATION: EMPTY_PARAMS,
  QUARANTINE_RAIL: QUARANTINE_RAIL_PARAMS,
  INVESTIGATE_DISPUTE: INVESTIGATE_DISPUTE_PARAMS,
  RUN_RESEARCH_SCAN: RUN_RESEARCH_SCAN_PARAMS,
  RUN_EXTERNAL_RESEARCH: RUN_EXTERNAL_RESEARCH_PARAMS,
  SCALE_FLEET_UP: SCALE_FLEET_UP_PARAMS,
  RETIRE_AGENT: RETIRE_AGENT_PARAMS,
  REQUEST_MONEY_INTENT: REQUEST_MONEY_INTENT_PARAMS,
};

/**
 * Validates params for an action. Returns cleaned params on success, or an
 * error message on failure. Never throws.
 */
export function validateActionParams(
  action: BrainAction,
  params: Record<string, unknown>
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const schema = ACTION_PARAM_SCHEMAS[action];
  if (!schema) return { ok: false, error: `no param schema for action ${action}` };
  const result = schema.safeParse(params);
  if (result.success) {
    return { ok: true, params: result.data as Record<string, unknown> };
  }
  const first = result.error.issues[0];
  const path = first?.path?.join(".") || "(root)";
  return { ok: false, error: `invalid params for ${action} at ${path}: ${first?.message ?? "validation failed"}` };
}