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
  DRAFTER,
  CRITIC,
  CONFIDENCE_FLOOR,
  personaModel,
  ACTION_PARAMS_CHEATSHEET,
  type PersonaId,
} from "@/lib/brain/personas";
import type { MissionStep } from "@/lib/brain/mission-service";
import { emitPersonaPhase } from "@/lib/brain/persona-events";

export interface DialogueTurn {
  persona: PersonaId;
  role: "draft" | "critique" | "revise" | "synthesize";
  content: string;
  /** Self-rated confidence 0-100 (null = the mind did not provide one). */
  confidence: number | null;
  /** Wall-clock duration of this turn's model call, in ms (per-persona timing). */
  ms?: number;
}

/** MORE (local gemma-4) only joins when its endpoint is configured. */
function isMoreEnabled(): boolean {
  return Boolean(process.env.LOCAL_LLM_BASE_URL?.trim());
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
  /** Cycle/run id; when set, real per-persona lifecycle events are emitted. */
  runId?: string;
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

/** Calls one persona on its own model + tier. Fail-closed: any throw ends the dialogue. */
async function askPersona(
  personaId: PersonaId,
  opts: { user: string; json?: boolean },
  runId?: string
): Promise<{ text: string; ms: number }> {
  const persona = PERSONAS[personaId];
  const model = resolveAllowlistedModel(persona.tier, personaModel(persona));
  const startedAt = Date.now();
  if (runId) {
    emitPersonaPhase({ runId, persona: personaId, phase: "working", at: new Date().toISOString() });
  }
  try {
    const text = await llmDeps.complete({
      system: persona.systemPrompt,
      user: opts.user,
      tier: persona.tier,
      model,
      temperature: persona.temperature,
      // Gemma 4 heretic emits a long private reasoning trace before `content`.
      // Ollama's OpenAI-compatible endpoint honors reasoning_effort=none; without
      // it, MORE spends minutes reasoning and can hit the completion timeout.
      ...(persona.tier === "local" ? { reasoningEffort: "none" as const, maxTokens: 256 } : {}),
      json: opts.json ?? true,
    });
    const ms = Date.now() - startedAt;
    if (runId) {
      emitPersonaPhase({ runId, persona: personaId, phase: "completed", at: new Date().toISOString(), ms });
    }
    return { text, ms };
  } catch (err) {
    if (runId) {
      emitPersonaPhase({
        runId,
        persona: personaId,
        phase: "failed",
        at: new Date().toISOString(),
        ms: Date.now() - startedAt,
        detail: String(err instanceof Error ? err.message : err).slice(0, 160),
      });
    }
    throw err;
  }
}

/** Parses a persona's JSON into candidate steps, dropping anything malformed. */
function parseCandidateSteps(raw: Record<string, unknown>, confidence: number | null): MissionStep[] {
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
      // The step inherits the self-rated confidence of the turn that produced it.
      confidence,
    });
  }
  return out.slice(0, MAX_STEPS);
}

/**
 * Extracts the turn's self-rated confidence from a persona JSON response.
 * Missing/invalid confidence counts as 0 (fail-closed per the owner's gate).
 */
export function extractConfidence(raw: Record<string, unknown>): number {
  const c = Number(raw.confidence);
  if (!Number.isFinite(c)) return 0;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/**
 * Extracts a trailing "CONFIDENCE: <0-100>" marker from free-form prose
 * (used by MARS's critique). Returns the cleaned text + parsed confidence
 * (null when no valid marker was present — advisory only, never a gate here).
 */
export function parseConfidenceMarker(text: string): { text: string; confidence: number | null } {
  const re = /CONFIDENCE:\s*(\d{1,3})\s*%?\s*$/i;
  const m = text.trim().match(re);
  if (!m) return { text: text.trim(), confidence: null };
  const n = Number(m[1]);
  const confidence = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  return { text: text.trim().replace(re, "").trim(), confidence };
}

/**
 * Extracts the critique's text + confidence from EITHER shape a critic returns.
 *
 * MARS's system prompt demands strict JSON, but the critique prompt asks for
 * prose + a trailing marker — models split. Accept both so MARS's confidence is
 * actually visible to the other minds (previously a JSON reply left it null):
 *   1. trailing "CONFIDENCE: NN" marker, else
 *   2. a JSON body with a `confidence` field (fences stripped).
 */
export function parseCritique(text: string): { text: string; confidence: number | null } {
  const marker = parseConfidenceMarker(text);
  if (marker.confidence !== null) return marker;

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const c = Number(obj.confidence);
    const body = String(obj.critique ?? obj.notes ?? obj.ranking ?? "").trim();
    return {
      text: body || cleaned,
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : null,
    };
  } catch {
    return { text: text.trim(), confidence: null };
  }
}

function isAllowedAction(action: string): action is BrainAction {
  return ALLOWED_ACTIONS.includes(action);
}

/**
 * Defence in depth against a module-eval cycle with command-brain (which
 * imports this dialogue module). This mirrors BRAIN_ACTIONS; a unit test asserts
 * the two lists are identical, so drift is caught rather than silently allowed.
 */
export const ALLOWED_ACTIONS: readonly string[] = [
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
    // ADVANCE_MISSION_PLAN is a META-action the cycle applies to run a stored
    // step — it must never itself be stored as a plan step (that would be a
    // self-referential step). Reject it here so plans contain only real work.
    if (action === "ADVANCE_MISSION_PLAN") continue;
    // Confidence gate (owner-directed): a step below the floor is rejected.
    // AUDIT FIX (F5): normalize first — NaN/strings must NOT slip through
    // (`NaN < 51` is false, which previously failed OPEN). Missing/invalid = 0.
    const c = typeof s.confidence === "number" && Number.isFinite(s.confidence) ? s.confidence : 0;
    if (c < CONFIDENCE_FLOOR) continue;
    const check = validateActionParams(action, s.params);
    if (!check.ok) continue;
    vetted.push({ ...s, step: vetted.length + 1, action, params: check.params });
  }
  return vetted;
}

/**
 * Runs one full Plan → Critique → Revise → (Synthesize) → Commit dialogue.
 *
 * CONFIDENCE SYSTEM (owner-directed): every persona JSON response must carry
 * "confidence" (0-100). Each later turn SEES the earlier turns' confidences;
 * the deterministic arbiter rejects any artifact below CONFIDENCE_FLOOR (51):
 *   - draft  < 51 → the dialogue aborts (no plan this cycle);
 *   - revise < 51 → MUSE's higher-confidence draft is kept instead;
 *   - synthesize < 51 → the revised plan is kept (MORE's synthesis ignored).
 * A missing confidence counts as 0 (fail-closed). Never throws.
 */
export async function runMissionDialogue(ctx: MissionContext): Promise<DialogueResult> {
  const turns: DialogueTurn[] = [];
  const datapoints = ctx.datapoints ?? {};
  const memory = ctx.recentMemory ?? [];
  const runId = ctx.runId;

  // Announce the participants as Queued before the first call — a REAL signal
  // (the dialogue has begun), not a fabricated phase.
  if (runId) {
    const participants: PersonaId[] = ["muse", "mars"];
    if (isMoreEnabled()) participants.push("more");
    const at = new Date().toISOString();
    for (const p of participants) emitPersonaPhase({ runId, persona: p, phase: "queued", at });
  }

  const sharedContext = JSON.stringify({
    mission: { id: ctx.missionId ?? null, title: ctx.title, objective: ctx.objective, thesis: ctx.thesis ?? null },
    open_steps: ctx.openSteps ?? [],
    datapoints,
    recent_memory: memory,
  });

  // ── 1. DRAFT (MUSE) ────────────────────────────────────────────────────────
  let draft: MissionStep[];
  let draftConfidence = 0;
  try {
    const { text: draftRaw, ms: draftMs } = await askPersona(DRAFTER, {
      user:
        "Draft up to 2 candidate NEXT STEPS to advance this mission. Each step must name one " +
        "allowlisted action and its params. Be concrete and novel.\n" +
        ACTION_PARAMS_CHEATSHEET +
        "\n" +
        `Return STRICT JSON: {"steps":[{"action":"<ALLOWLIST>","params":{},"rationale":"..."}],"confidence":<0-100>}.\n\n` +
        sharedContext,
    }, runId);
    const parsedRaw = parseJsonObject(draftRaw);
    draftConfidence = extractConfidence(parsedRaw);
    draft = parseCandidateSteps(parsedRaw, draftConfidence);
    turns.push({ persona: DRAFTER, role: "draft", content: JSON.stringify(draft), confidence: draftConfidence, ms: draftMs });
  } catch (err) {
    return { ok: false, reason: `draft_failed:${msg(err)}`, steps: [], committedStep: null, turns, summary: "draft failed", draftedBy: DRAFTER };
  }
  if (draft.length === 0) {
    return { ok: false, reason: "draft_empty", steps: [], committedStep: null, turns, summary: "no candidate steps", draftedBy: DRAFTER };
  }
  if (draftConfidence < CONFIDENCE_FLOOR) {
    return {
      ok: false,
      reason: `low_confidence_draft:${draftConfidence}`,
      steps: [],
      committedStep: null,
      turns,
      summary: `MUSE draft rejected at confidence ${draftConfidence} (< ${CONFIDENCE_FLOOR})`,
      draftedBy: DRAFTER,
    };
  }

  // ── 2. CRITIQUE (MARS) — sees MUSE's confidence ────────────────────────────
  let critiqueText = "";
  let critiqueConfidence: number | null = null;
  let critiqueMs: number | undefined;
  try {
    // Free-form critique (no JSON mode): ranking is prose, and some providers
    // return empty completions under strict JSON mode at high temperature. MARS
    // appends a CONFIDENCE: NN marker, which we parse out for cross-visibility.
    const critiqueCall = await askPersona(CRITIC, {
      json: false,
      user:
        "Adversarially critique these candidate steps for this mission. Attack cost, risk, " +
        "distraction, unproven assumptions, and expected value. Rank them best→worst in 2-4 " +
        "short sentences. End your reply with exactly: CONFIDENCE: <0-100>.\n\n" +
        `mission=${JSON.stringify({ title: ctx.title, objective: ctx.objective })}\n` +
        `muse_confidence=${draftConfidence}\n` +
        `candidates=${JSON.stringify(draft)}`,
    }, runId);
    critiqueMs = critiqueCall.ms;
    // Accept either a trailing marker OR a JSON body (MARS's system prompt
    // demands strict JSON), so its confidence is visible to the other minds.
    const { text, confidence } = parseCritique(critiqueCall.text);
    critiqueText = text;
    critiqueConfidence = confidence;
    turns.push({ persona: CRITIC, role: "critique", content: critiqueText, confidence: critiqueConfidence, ms: critiqueMs });
  } catch (err) {
    // A failed critique does not abort the dialogue — the arbiter still vets the
    // draft. Record the failure so it is visible.
    critiqueText = `critique_unavailable:${msg(err)}`;
    turns.push({ persona: CRITIC, role: "critique", content: critiqueText, confidence: null, ms: critiqueMs });
  }

  // ── 3. REVISE (MUSE) — sees its own draft confidence + MARS's ──────────────
  let revised = draft;
  try {
    const { text: reviseRaw, ms: reviseMs } = await askPersona(DRAFTER, {
      user:
        "Revise your candidate steps in light of the critique. Drop weak steps, keep the " +
        "strongest, and return the FINAL ordered plan. Use ONLY the exact params allowed:\n" +
        ACTION_PARAMS_CHEATSHEET +
        "\n" +
        `Return STRICT JSON: {"steps":[{"action":"<ALLOWLIST>","params":{},"rationale":"..."}],"confidence":<0-100>}.\n\n` +
        `mission=${JSON.stringify({ title: ctx.title, objective: ctx.objective })}\n` +
        `your_draft_confidence=${draftConfidence}\nmars_confidence=${critiqueConfidence ?? "unrated"}\n` +
        `draft=${JSON.stringify(draft)}\ncritique=${critiqueText}`,
    }, runId);
    const parsedRaw = parseJsonObject(reviseRaw);
    const reviseConfidence = extractConfidence(parsedRaw);
    const parsed = parseCandidateSteps(parsedRaw, reviseConfidence);
    if (parsed.length > 0 && reviseConfidence >= CONFIDENCE_FLOOR) {
      revised = parsed;
    }
    turns.push({
      persona: DRAFTER,
      role: "revise",
      content: revised === parsed ? JSON.stringify(revised) : `kept_draft_confidence_${reviseConfidence}`,
      confidence: reviseConfidence,
      ms: reviseMs,
    });
  } catch (err) {
    turns.push({ persona: DRAFTER, role: "revise", content: `revise_unavailable:${msg(err)}`, confidence: null });
  }

  // ── 3b. SYNTHESIZE (MORE, local gemma-4) — best-effort ─────────────────────
  // MORE reads both minds (and their confidences) and may replace the plan with
  // a stronger synthesis. Best-effort: if MORE is unconfigured/down (e.g. the
  // Tailscale link is up but the local server is off), the dialogue proceeds
  // with the revised plan.
  if (isMoreEnabled()) {
    try {
      const { text: synthRaw, ms: synthMs } = await askPersona("more", {
        user:
          "MARS critiqued and MUSE revised. As the synthesizer, either keep the revised plan, " +
          "replace it with a stronger COMBINED plan, or expose a blind spot. Use ONLY the exact " +
          "params allowed:\n" +
          ACTION_PARAMS_CHEATSHEET +
          "\n" +
          `Return STRICT JSON: {"steps":[{"action":"<ALLOWLIST>","params":{},"rationale":"..."}],` +
          `"confidence":<0-100>,"synthesis":"<1-2 sentences: what you changed and why>"}.\n\n` +
          `mission=${JSON.stringify({ title: ctx.title, objective: ctx.objective })}\n` +
          `muse_confidence=${draftConfidence}\nmars_confidence=${critiqueConfidence ?? "unrated"}\n` +
          `revised_plan=${JSON.stringify(revised)}\nmars_critique=${critiqueText}`,
      }, runId);
      const parsedRaw = parseJsonObject(synthRaw);
      const synthConfidence = extractConfidence(parsedRaw);
      const synthSteps = parseCandidateSteps(parsedRaw, synthConfidence);
      if (synthSteps.length > 0 && synthConfidence >= CONFIDENCE_FLOOR) {
        revised = synthSteps;
        turns.push({ persona: "more", role: "synthesize", content: JSON.stringify(synthSteps), confidence: synthConfidence, ms: synthMs });
      } else {
        turns.push({
          persona: "more",
          role: "synthesize",
          content: `kept_revised_plan (confidence ${synthConfidence}):${String(parsedRaw.synthesis ?? "").slice(0, 200)}`,
          confidence: synthConfidence,
          ms: synthMs,
        });
      }
    } catch (err) {
      turns.push({ persona: "more", role: "synthesize", content: `more_unavailable:${msg(err)}`, confidence: null });
    }
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
