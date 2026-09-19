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