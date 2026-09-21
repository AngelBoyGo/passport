/**
 * Phase 3 · Personality layer (Passport ID surface).
 *
 * Canonical per the empire planning decision:
 *   - Personality lives in the Passport ID layer, keyed by DID.
 *   - Only VERIFIED OUTCOMES (signed, attributable evidence) authorize real
 *     trait mutation. Reflections are non-authoritative: advisory deltas only,
 *     capped, and never sufficient to steer behavior on their own.
 *   - Profiles are immutable + append-only: every mutation is a new version,
 *     full history retained, rollback produces a new version.
 *   - Traits are bounded; per-event deltas are capped; mutation is
 *     rate-limited; oscillation is detected and blocked.
 *   - Safety policy is passed to behavior derivation and always wins —
 *     personality styles behavior, never permissions.
 *
 * Pure and deterministic (mirrors the brain/policy.ts conventions): no I/O, no
 * DB, no clock reads — time comes from the event, so replays are reproducible.
 */

export const TRAITS = [
  "communication",
  "risk_appetite",
  "autonomy",
  "empathy",
  "rigor",
] as const;

export type Trait = (typeof TRAITS)[number];

export interface TraitBounds {
  min: number;
  max: number;
  default: number;
  /** Absolute ceiling on any single event's per-trait delta. */
  maxDeltaPerEvent: number;
  /** Absolute ceiling for a NON-authoritative (reflection) delta. */
  advisoryMax: number;
  /** Minimum seconds between mutations. */
  cooldownSeconds: number;
  /** Direction changes within the recent window that trigger the guard. */
  oscillationFlips: number;
  oscillationWindow: number;
}

export const TRAIT_BOUNDS: TraitBounds = {
  min: 0,
  max: 100,
  default: 50,
  maxDeltaPerEvent: 10,
  advisoryMax: 2,
  cooldownSeconds: 3600,
  oscillationFlips: 3,
  oscillationWindow: 4,
};

export interface Traits {
  communication: number;
  risk_appetite: number;
  autonomy: number;
  empathy: number;
  rigor: number;
  [k: string]: number;
}

export interface ProfileHistoryEntry {
  version: number;
  traits: Traits;
  at: string | null;
  reason: string;
  evidenceRef?: string;
}

export interface Reflection {
  at: string;
  note: string;
  proposed: Partial<Traits>;
  applied: boolean;
}

export interface PersonalityProfile {
  did: string;
  version: number;
  traits: Traits;
  history: ProfileHistoryEntry[];
  reflections: Reflection[];
  lastMutationAt: string | null;
  /** Recent signed deltas per trait, newest last (oscillation detector). */
  recentDeltas: Record<string, number[]>;
}

export type PersonalityEvent =
  | {
      kind: "verified_outcome";
      did: string;
      at: string;
      evidence: { ref: string; type: string; score?: number; signer: string };
      deltas: Partial<Traits>;
      baseVersion?: number;
    }
  | {
      kind: "reflection";
      did: string;
      at: string;
      evidence: { ref?: string; note: string };
      deltas: Partial<Traits>;
      baseVersion?: number;
    };

export type MutationResult =
  | { ok: true; profile: PersonalityProfile; applied: Partial<Traits> }
  | { ok: false; reason: string; detail?: string };

function defaultTraits(): Traits {
  const t = {} as Traits;
  for (const trait of TRAITS) t[trait] = TRAIT_BOUNDS.default;
  return t;
}

export function newProfile(did: string): PersonalityProfile {
  const traits = defaultTraits();
  return {
    did,
    version: 0,
    traits: { ...traits },
    history: [{ version: 0, traits: { ...traits }, at: null, reason: "genesis" }],
    reflections: [],
    lastMutationAt: null,
    recentDeltas: {},
  };
}

function clamp(v: number): number {
  return Math.min(TRAIT_BOUNDS.max, Math.max(TRAIT_BOUNDS.min, v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Corrupt-profile containment: every trait must be a finite in-range number. */
export function profileIsSane(profile: PersonalityProfile): boolean {
  if (!profile || typeof profile.did !== "string" || !Number.isInteger(profile.version)) {
    return false;
  }
  for (const trait of TRAITS) {
    const v = (profile.traits as Record<string, number> | undefined)?.[trait];
    if (!isFiniteNumber(v) || v < TRAIT_BOUNDS.min || v > TRAIT_BOUNDS.max) {
      return false;
    }
  }
  return true;
}

/**
 * A2: "verified outcome" must come from a trusted authority. An arbitrary
 * signer string used to grant the full non-advisory delta budget. The
 * allowlist is the set of issuers whose outcome attestations this Passport
 * deployment trusts (extend via env when new issuers are onboarded).
 */
const DEFAULT_TRUSTED_SIGNERS = new Set(["metis-marketplace", "passport-attestation"]);

export function setTrustedSigners(signers: string[]): void {
  DEFAULT_TRUSTED_SIGNERS.clear();
  for (const s of signers) DEFAULT_TRUSTED_SIGNERS.add(s);
}

function hasEvidence(event: PersonalityEvent): boolean {
  if (event.kind === "verified_outcome") {
    const signer = String(event.evidence?.signer ?? "");
    return Boolean(
      event.evidence?.ref && String(event.evidence.ref).trim() &&
      signer.trim() && DEFAULT_TRUSTED_SIGNERS.has(signer)
    );
  }
  return Boolean(
    (event.evidence?.ref && String(event.evidence.ref).trim()) ||
    (event.evidence?.note && String(event.evidence.note).trim())
  );
}

function recentDeltasFor(profile: PersonalityProfile, trait: string): number[] {
  return (profile.recentDeltas as Record<string, number[]>)[trait] ?? [];
}

function isOscillating(profile: PersonalityProfile, trait: string, next: number): boolean {
  const recent = recentDeltasFor(profile, trait).slice(-TRAIT_BOUNDS.oscillationWindow);
  if (recent.length < 2) return false;
  const flips = recent.slice(1).reduce(
    (n, cur, i) => (Math.sign(cur) !== 0 && Math.sign(cur) !== Math.sign(recent[i]) ? n + 1 : n),
    0
  );
  const wouldFlip =
    Math.sign(next) !== 0 && Math.sign(next) !== Math.sign(recent[recent.length - 1]);
  // flips counts direction changes already in the window; adding this event's
  // flip must EXCEED the allowance to trigger (so N flips are tolerated and
  // the N+1th consecutive flip is blocked).
  return wouldFlip && flips + 1 > TRAIT_BOUNDS.oscillationFlips;
}

function secondsBetween(fromIso: string | null, toIso: string): number {
  if (!fromIso) return Number.POSITIVE_INFINITY;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  // A1: an unparseable timestamp must NEVER bypass the cooldown (returning
  // Infinity let `at: "garbage"` mutate freely and poison lastMutationAt).
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NEGATIVE_INFINITY;
  return (to - from) / 1000;
}

export function applyEvent(
  profile: PersonalityProfile,
  event: PersonalityEvent
): MutationResult {
  if (event.did !== profile.did) {
    return { ok: false, reason: "cross_did_mutation_refused" };
  }
  if (!profileIsSane(profile)) {
    return { ok: false, reason: "corrupt_profile" };
  }
  if (
    event.baseVersion !== undefined &&
    event.baseVersion !== profile.version
  ) {
    return { ok: false, reason: "version_conflict" };
  }
  const deltas = (event.deltas ?? {}) as Record<string, number>;
  const keys = Object.keys(deltas);
  if (keys.length === 0) {
    return { ok: false, reason: "no_evidence" };
  }
  for (const k of keys) {
    if (!TRAITS.includes(k as Trait)) {
      return { ok: false, reason: "unknown_trait", detail: k };
    }
  }
  if (!hasEvidence(event)) {
    return { ok: false, reason: "no_evidence" };
  }
  // Cooldown — anchored to event time (replayable), not wall clock.
  if (secondsBetween(profile.lastMutationAt, event.at) < TRAIT_BOUNDS.cooldownSeconds) {
    return { ok: false, reason: "mutation_rate_limited" };
  }

  const advisory = event.kind === "reflection";
  const applied: Partial<Traits> = {};
  const nextTraits: Traits = { ...profile.traits };
  const nextRecent: Record<string, number[]> = Object.fromEntries(
    Object.entries(profile.recentDeltas as Record<string, number[]>).map(
      ([k, v]) => [k, [...v]]
    )
  );

  for (const k of keys) {
    const raw = deltas[k];
    if (!isFiniteNumber(raw)) {
      return { ok: false, reason: "unknown_trait", detail: `${k}: non-numeric` };
    }
    const cap = advisory ? TRAIT_BOUNDS.advisoryMax : TRAIT_BOUNDS.maxDeltaPerEvent;
    const delta = Math.sign(raw) * Math.min(Math.abs(raw), cap);
    // A reflection asking for more than its advisory cap is treated as an
    // attempt to self-authorize — refused, not silently clamped.
    if (advisory && Math.abs(raw) > TRAIT_BOUNDS.advisoryMax) {
      return { ok: false, reason: "reflection_non_authoritative", detail: k };
    }
    if (isOscillating(profile, k, delta)) {
      return { ok: false, reason: "oscillation_detected", detail: k };
    }
    applied[k as Trait] = delta;
    nextTraits[k as Trait] = clamp(nextTraits[k] + delta);
    nextRecent[k] = [...(nextRecent[k] ?? []), delta].slice(
      -TRAIT_BOUNDS.oscillationWindow
    );
  }

  const nextVersion = profile.version + 1;
  const next: PersonalityProfile = {
    ...profile,
    version: nextVersion,
    traits: nextTraits,
    lastMutationAt: event.at,
    recentDeltas: nextRecent,
    history: [
      ...profile.history,
      {
        version: nextVersion,
        traits: { ...nextTraits },
        at: event.at,
        reason: event.kind,
        evidenceRef:
          event.kind === "verified_outcome"
            ? event.evidence.ref
            : (event.evidence.ref ?? undefined),
      },
    ],
    reflections:
      event.kind === "reflection"
        ? [
            ...profile.reflections,
            {
              at: event.at,
              note: String(event.evidence.note ?? ""),
              proposed: { ...deltas },
              applied: true,
            },
          ]
        : profile.reflections,
  };
  return { ok: true, profile: next, applied };
}

export function rollbackTo(
  profile: PersonalityProfile,
  version: number
): MutationResult {
  if (!profileIsSane(profile)) {
    return { ok: false, reason: "corrupt_profile" };
  }
  const target = profile.history.find((h) => h.version === version);
  if (!target) {
    return { ok: false, reason: "version_not_found" };
  }
  // A4: a rollback must never resurrect corrupt/out-of-bounds traits — the
  // restored set is validated before it becomes live.
  const restored = { ...target.traits };
  for (const t of TRAITS) {
    const v = (restored as Record<string, number>)[t];
    if (!Number.isFinite(v) || v < TRAIT_BOUNDS.min || v > TRAIT_BOUNDS.max) {
      restored[t] = TRAIT_BOUNDS.default;
    }
  }
  const nextVersion = profile.version + 1;
  const next: PersonalityProfile = {
    ...profile,
    version: nextVersion,
    traits: restored,
    // A5: deep-copy mutable internal state — a rollback must not share
    // oscillation history or reflections with the pre-rollback object.
    recentDeltas: Object.fromEntries(
      Object.entries(profile.recentDeltas as Record<string, number[]>).map(
        ([k, v]) => [k, [...v]]
      )
    ),
    reflections: profile.reflections.map((r) => ({ ...r })),
    lastMutationAt: profile.lastMutationAt,
    history: [
      ...profile.history,
      {
        version: nextVersion,
        traits: { ...restored },
        at: null,
        reason: `rollback_to_${version}`,
      },
    ],
  };
  return { ok: true, profile: next, applied: {} };
}

export interface PublicProfile {
  did: string;
  version: number;
  traits: Traits;
  updatedAt: string | null;
}

/**
 * Privacy boundary: reflections, evidence provenance, and history are internal.
 * Only the CURRENT, CANONICAL trait values are public — A3: unknown/extra keys
 * that ever landed in the traits object are stripped, not leaked.
 */
export function publicProfile(profile: PersonalityProfile): PublicProfile {
  const traits = {} as Traits;
  for (const t of TRAITS) traits[t] = (profile.traits as Traits)[t];
  return {
    did: profile.did,
    version: profile.version,
    traits,
    updatedAt: profile.lastMutationAt,
  };
}

export interface SafetyPolicy {
  allowedActions: string[];
  maxSpendUsd: number;
  requireHumanApproval: boolean;
}

export interface DerivedBehavior {
  style: Record<string, string>;
  safety: SafetyPolicy;
}

/**
 * Behavior derivation: personality styles HOW an agent acts (tone, pacing,
 * autonomy flavor) but NEVER WHAT it may do — the safety policy is passed
 * through untouched and always outranks traits.
 */
export function deriveBehavior(
  profile: PersonalityProfile,
  safety: SafetyPolicy
): DerivedBehavior {
  const t = profile.traits as Traits;
  const band = (v: number): string =>
    v < 35 ? "low" : v <= 65 ? "measured" : "high";
  return {
    style: {
      communication: band(t.communication),
      risk: band(t.risk_appetite),
      autonomy: band(t.autonomy),
      empathy: band(t.empathy),
      rigor: band(t.rigor),
    },
    safety: {
      allowedActions: [...safety.allowedActions],
      maxSpendUsd: safety.maxSpendUsd,
      requireHumanApproval: safety.requireHumanApproval,
    },
  };
}
