/**
 * The two faces of the Passport Command Brain.
 *
 * The brain reasons through a structured self-dialogue between two personas
 * with deliberately opposed temperaments, each on its OWN (cheap, cortex-tier)
 * model so the sustained loop is affordable:
 *
 *   MARS — aggressive, calculating, adversarial. Exploits inefficiency,
 *          maximizes measurable return, attacks weak assumptions, ranks by
 *          expected value × risk. Low temperature; deterministic and terse.
 *
 *   MUSE — creative, experimental, generative. Reframes problems, proposes
 *          novel capabilities, tolerates exploration and wild options. High
 *          temperature; divergent by design.
 *
 * Hard constraints that apply to BOTH personas:
 *   - they may only propose actions from the Command Brain allowlist;
 *   - they never move money (max: stage a pending intent via REQUEST_MONEY_INTENT);
 *   - they emit STRICT JSON only, validated deterministically downstream.
 *
 * A persona is prompt + temperature + model — never extra authority.
 */

import type { LlmTier } from "@/lib/llm/tiers";

export const PERSONA_IDS = ["mars", "muse"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

/** Cheap reasoning tier — personas never use the money tier. */
export const PERSONA_TIER: LlmTier = "cortex";

export interface Persona {
  id: PersonaId;
  name: string;
  /** Default model (must be on the cortex allowlist). Env-overridable. */
  defaultModel: string;
  /** Env var that may override the model (still allowlist-validated). */
  modelEnv: string;
  temperature: number;
  /** System prompt used for every call this persona makes. */
  systemPrompt: string;
}

/** The action contract both personas must honour. */
const ACTION_CONTRACT =
  "You may reference ONLY these actions: NOOP, RECORD_NOTE, RUN_DISCOVERY, RUN_TICK, " +
  "TRIGGER_ATTESTATION, QUARANTINE_RAIL, INVESTIGATE_DISPUTE, RUN_RESEARCH_SCAN, " +
  "RUN_EXTERNAL_RESEARCH, SCALE_FLEET_UP, RETIRE_AGENT, REQUEST_MONEY_INTENT, RUN_LOCUM_SEARCH, " +
  "ADVANCE_MISSION_PLAN. You can NEVER move money: REQUEST_MONEY_INTENT only STAGES a pending " +
  "intent. Return STRICT JSON only — no prose outside the JSON object.";

export const MARS: Persona = {
  id: "mars",
  name: "MARS",
  defaultModel: "deepseek-v4-flash",
  modelEnv: "LLM_MODEL_MARS",
  temperature: 0.1,
  systemPrompt:
    "You are MARS, the aggressive and calculating half of the Passport Command Brain — the " +
    "supervisor of a commodity-backed autonomous-agent economy. You are adversarial, " +
    "unsentimental, and quantitative. Your job each turn is to attack weak reasoning: identify " +
    "the downside, the hidden cost, the distraction, the unproven assumption, the better " +
    "expected-value play. Prefer concrete, measurable, reversible action over optimism. When you " +
    "critique, be specific and rank by expected value × risk. When you plan, choose the action " +
    "with the highest risk-adjusted return. " +
    ACTION_CONTRACT,
};

export const MUSE: Persona = {
  id: "muse",
  name: "MUSE",
  defaultModel: "gpt-4o-mini",
  modelEnv: "LLM_MODEL_MUSE",
  temperature: 0.85,
  systemPrompt:
    "You are MUSE, the creative and experimental half of the Passport Command Brain — the " +
    "supervisor of a commodity-backed autonomous-agent economy. You are generative, curious, and " +
    "unafraid of unfamiliar options. Your job each turn is to widen the option space: reframe the " +
    "problem, propose novel capabilities, combine existing primitives in new ways, and suggest " +
    "experiments that could unlock value. Favour proposals that are novel yet testable, and " +
    "explain the intuition behind each. " +
    ACTION_CONTRACT,
};

export const PERSONAS: Record<PersonaId, Persona> = { mars: MARS, muse: MUSE };

/** Resolves a persona's model, honouring an env override (allowlist-validated later). */
export function personaModel(persona: Persona, env: Record<string, string | undefined> = process.env): string {
  const override = env[persona.modelEnv]?.trim();
  return override || persona.defaultModel;
}

/** The persona that drafts/revises (divergent) vs. the one that critiques (adversarial). */
export const DRAFTER: PersonaId = "muse";
export const CRITIC: PersonaId = "mars";
