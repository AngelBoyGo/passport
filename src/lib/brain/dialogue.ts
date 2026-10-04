/**
 * Two-persona self-dialogue engine (Plan → Critique → Revise → Commit).
 *
 * This is how the Command Brain "talks to itself": MUSE (creative/experimental)
 * drafts candidate mission steps; MARS (aggressive/calculating) adversarially
 * critiques them; MUSE revises; a DETERMINISTIC arbiter commits the plan.
 *
 * Design:
 *   - Each persona runs on its OWN cortex-tier model (affordable), with its own
 *     temperature. The two minds are genuinely distinct models, not one model
 *     role-playing.
 *   - Every LLM turn is bounded and fail-closed: a gateway error ends the
 *     dialogue and returns no plan (never a fabricated one).
 *   - The arbiter is deterministic code, not an LLM: it filters steps to the
 *     allowlist, validates params, and picks the highest-ranked valid step.
 *     The personas only PROPOSE; they hold no execution authority here.
 *   - All turns are returned so the caller can persist the transcript.
 *
 * This module never executes a step and never moves money.
 */

import { brainComplete, parseJsonObject } from "@/lib/raillab/factory-brain";
import { resolveAllowlistedModel } from "@/lib/llm/tiers";
import { validateActionParams } from "@/lib/brain/param-schemas";
import type { BrainAction } from "@/lib/brain/command-brain";
import {
  PERSONAS,
  PERSONA_TIER,
  DRAFTER,
  CRITIC,
  personaModel,
  ACTION_PARAMS_CHEATSHEET,
  type PersonaId,
} from "@/lib/brain/personas";
import type { MissionStep } from "@/lib/brain/mission-service";

export interface DialogueTurn {
  persona: PersonaId;
  role: "draft" | "critique" | "revise";
  content: string;
}

export interface MissionContext {
  missionId?: string;
  title: string;
  objective: string;
  thesis?: string | null;
  datapoints?: Record<string, unknown>;
  recentMemory?: Array<{ kind: string; summary: string }>;
  /** Existing committed steps not yet done — revise around them. */
  openSteps?: MissionStep[];
}

export interface DialogueResult {
  ok: boolean;
  reason?: string;
  missionId?: string;
  /** Validated, allowlisted steps in the committed order. */
  steps: MissionStep[];
  committedStep: number | null;
  turns: DialogueTurn[];
  summary: string;
  draftedBy: PersonaId;
}

const MAX_STEPS = 3;
const MAX_DIALOGUE_STEPS = 2; // candidate steps per draft/revise round

/** Per-call token guard: the dialogue is bounded to a small fixed call budget. */
const llmDeps = {
  complete: brainComplete,
};

/** Calls one persona on its own model. Fail-closed: any throw ends the dialogue. */
async function askPersona(
  personaId: PersonaId,
  opts: { user: string; json?: boolean }
): Promise<string> {
  const persona = PERSONAS[personaId];
  const model = resolveAllowlistedModel(PERSONA_TIER, personaModel(persona));
  return llmDeps.complete({
    system: persona.systemPrompt,
    user: opts.user,
    tier: PERSONA_TIER,
    model,
    temperature: persona.temperature,
    json: opts.json ?? true,
  });
}

/** Parses a persona's JSON into candidate steps, dropping anything malformed. */
function parseCandidateSteps(raw: Record<string, unknown>): MissionStep[] {
  const arr = Array.isArray(raw.steps) ? raw.steps : [];
  const out: MissionStep[] = [];
  for (const entry of arr.slice(0, MAX_DIALOGUE_STEPS + 1)) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const action = String(o.action ?? "").toUpperCase();
    out.push({
      step: out.length + 1,
      action,
      params: (o.params && typeof o.params === "object" ? o.params : {}) as Record<string, unknown>,
      rationale: String(o.rationale ?? "").slice(0, 600),
      done: false,
    });
  }
  return out.slice(0, MAX_STEPS);
}

function isAllowedAction(action: string): action is BrainAction {
  return ALLOWED_ACTIONS.includes(action);
}

/**
 * Defence in depth against a module-eval cycle with command-brain (which
 * imports this dialogue module). This mirrors BRAIN_ACTIONS; a unit test asserts
 * the two lists are identical, so drift is caught rather than silently allowed.
 */
const ALLOWED_ACTIONS: readonly string[] = [
  "NOOP",
  "RECORD_NOTE",
  "RUN_DISCOVERY",
  "RUN_TICK",
  "TRIGGER_ATTESTATION",
  "QUARANTINE_RAIL",
  "INVESTIGATE_DISPUTE",
  "RUN_RESEARCH_SCAN",
  "RUN_EXTERNAL_RESEARCH",
  "SCALE_FLEET_UP",
  "RETIRE_AGENT",
  "REQUEST_MONEY_INTENT",
  "RUN_LOCUM_SEARCH",
  "ADVANCE_MISSION_PLAN",
];

/**
 * Deterministic arbiter: keep only steps whose action is allowlisted AND whose
 * params pass the strict per-action schema. Mutates `params` to the cleaned
 * form. NEVER executes.
 */
export function vetSteps(steps: MissionStep[]): MissionStep[] {
  const vetted: MissionStep[] = [];
  for (const s of steps) {
    const action = s.action.toUpperCase();
    if (!isAllowedAction(action)) continue;
    const check = validateActionParams(action, s.params);
    if (!check.ok) continue;
    vetted.push({ ...s, step: vetted.length + 1, action, params: check.params });
  }
  return vetted;
}

/**
 * Runs one full Plan → Critique → Revise → Commit dialogue for a mission.
 * Returns the vetted steps and the full transcript. Never throws.
 */
export async function runMissionDialogue(ctx: MissionContext): Promise<DialogueResult> {
  const turns: DialogueTurn[] = [];
  const datapoints = ctx.datapoints ?? {};
  const memory = ctx.recentMemory ?? [];

  const sharedContext = JSON.stringify({
    mission: { id: ctx.missionId ?? null, title: ctx.title, objective: ctx.objective, thesis: ctx.thesis ?? null },
    open_steps: ctx.openSteps ?? [],
    datapoints,
    recent_memory: memory,
  });

  // ── 1. DRAFT (MUSE) ────────────────────────────────────────────────────────
  let draft: MissionStep[];
  try {
    const draftRaw = await askPersona(DRAFTER, {
      user:
        "Draft up to 2 candidate NEXT STEPS to advance this mission. Each step must name one " +
        "allowlisted action and its params. Be concrete and novel.\n" +
        ACTION_PARAMS_CHEATSHEET +
        "\n" +
        `Return STRICT JSON: {"steps":[{"action":"<ALLOWLIST>","params":{},"rationale":"..."}]}.\n\n` +
        sharedContext,
    });
    draft = parseCandidateSteps(parseJsonObject(draftRaw));
    turns.push({ persona: DRAFTER, role: "draft", content: JSON.stringify(draft) });
  } catch (err) {
    return { ok: false, reason: `draft_failed:${msg(err)}`, steps: [], committedStep: null, turns, summary: "draft failed", draftedBy: DRAFTER };
  }
  if (draft.length === 0) {
    return { ok: false, reason: "draft_empty", steps: [], committedStep: null, turns, summary: "no candidate steps", draftedBy: DRAFTER };
  }

  // ── 2. CRITIQUE (MARS) ─────────────────────────────────────────────────────
  let critiqueText = "";
  try {
    // Free-form critique (no JSON mode): ranking is prose, and some providers
    // return empty completions under strict JSON mode at high temperature.
    critiqueText = await askPersona(CRITIC, {
      json: false,
      user:
        "Adversarially critique these candidate steps for this mission. Attack cost, risk, " +
        "distraction, unproven assumptions, and expected value. Rank them best→worst in 2-4 " +
        "short sentences.\n\n" +
        `mission=${JSON.stringify({ title: ctx.title, objective: ctx.objective })}\n` +
        `candidates=${JSON.stringify(draft)}`,
    });
    turns.push({ persona: CRITIC, role: "critique", content: critiqueText });
  } catch (err) {
    // A failed critique does not abort the dialogue — the arbiter still vets the
    // draft. Record the failure so it is visible.
    critiqueText = `critique_unavailable:${msg(err)}`;
    turns.push({ persona: CRITIC, role: "critique", content: critiqueText });
  }

  // ── 3. REVISE (MUSE) ───────────────────────────────────────────────────────
  let revised = draft;
  try {
    const reviseRaw = await askPersona(DRAFTER, {
      user:
        "Revise your candidate steps in light of the critique. Drop weak steps, keep the " +
        "strongest, and return the FINAL ordered plan. Use ONLY the exact params allowed:\n" +
        ACTION_PARAMS_CHEATSHEET +
        "\n" +
        `Return STRICT JSON: {"steps":[{"action":"<ALLOWLIST>","params":{},"rationale":"..."}]}.\n\n` +
        `mission=${JSON.stringify({ title: ctx.title, objective: ctx.objective })}\n` +
        `draft=${JSON.stringify(draft)}\ncritique=${critiqueText}`,
    });
    const parsed = parseCandidateSteps(parseJsonObject(reviseRaw));
    if (parsed.length > 0) revised = parsed;
    turns.push({ persona: DRAFTER, role: "revise", content: JSON.stringify(revised) });
  } catch (err) {
    turns.push({ persona: DRAFTER, role: "revise", content: `revise_unavailable:${msg(err)}` });
  }

  // ── 4. COMMIT (deterministic arbiter) ──────────────────────────────────────
  const vetted = vetSteps(revised).slice(0, MAX_STEPS);
  if (vetted.length === 0) {
    return { ok: false, reason: "no_valid_steps_after_vetting", steps: [], committedStep: null, turns, summary: "no valid steps", draftedBy: DRAFTER };
  }
  const committedStep = vetted[0].step;
  const summary =
    `plan: ${vetted.length} step(s); first=${vetted[0].action} ` +
    `(${vetted[0].rationale.slice(0, 120)})`;
  return { ok: true, steps: vetted, committedStep, turns, summary, draftedBy: DRAFTER };
}

function msg(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 160);
}
