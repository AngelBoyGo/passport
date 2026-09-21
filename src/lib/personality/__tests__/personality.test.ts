/**
 * Phase 3 Â· Personality layer â€” failure-first suite.
 *
 * Personality is canonical in the Passport ID layer. Mutation rules (locked
 * decision from the empire planning session):
 *   - Only VERIFIED OUTCOMES authorize real trait mutation.
 *   - Reflections are non-authoritative (advisory, tiny delta, never enough alone).
 *   - Traits are bounded; mutation is rate-limited; oscillation is blocked.
 *   - Profiles are per-DID, immutable (append-only versions), non-copyable.
 *   - Private data never appears on the public profile.
 *   - Safety policy always outranks personality in behavior derivation.
 *
 * Every test below reproduces a specific failure mode. RED before the
 * implementation, GREEN after.
 */
import { describe, it, expect } from "vitest";
import {
  TRAITS,
  TRAIT_BOUNDS,
  newProfile,
  applyEvent,
  publicProfile,
  rollbackTo,
  deriveBehavior,
  type PersonalityProfile,
  type PersonalityEvent,
  type MutationResult,
} from "../index";

/** Narrows the union AND fails loudly if the event was (unexpectedly) applied. */
function failReason(r: MutationResult): string {
  if (r.ok) throw new Error(`expected refusal, got applied: ${JSON.stringify(r.applied)}`);
  return r.reason;
}

/** Narrows to the accepted branch AND fails loudly if the event was refused. */
function appliedProfile(r: MutationResult): PersonalityProfile {
  if (!r.ok) throw new Error(`expected acceptance, refused: ${r.reason}`);
  return r.profile;
}

const OUTCOME = {
  kind: "verified_outcome" as const,
  did: "did:key:zAgent1",
  at: "2026-09-21T00:00:00Z",
  evidence: {
    ref: "ev1",
    type: "job_accepted" as const,
    score: 0.9,
    signer: "metis-marketplace",
  },
  deltas: { rigor: 6 },
};

const REFLECTION = {
  kind: "reflection" as const,
  did: "did:key:zAgent1",
  at: "2026-09-21T00:00:00Z",
  evidence: { ref: "r1", note: "I think I should be more risk-seeking." },
  deltas: { risk_appetite: 50 },
};

describe("F3.1 no mutation without verified evidence", () => {
  it("refuses an outcome event with an empty evidence ref", () => {
    const p = newProfile("did:key:zAgent1");
    const bad: PersonalityEvent = {
      ...OUTCOME,
      evidence: { ...OUTCOME.evidence, ref: "" },
    };
    const r = applyEvent(p, bad);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("no_evidence");
  });

  it("refuses an outcome with no signer (unverifiable provenance)", () => {
    const p = newProfile("did:key:zAgent1");
    const bad = {
      ...OUTCOME,
      evidence: { ...OUTCOME.evidence, signer: "" },
    };
    const r = applyEvent(p, bad);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("no_evidence");
  });
});

describe("F3.2 reflection is non-authoritative", () => {
  it("refuses a reflection that asks for more than the advisory cap", () => {
    const p = newProfile("did:key:zAgent1");
    const r = applyEvent(p, REFLECTION);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("reflection_non_authoritative");
  });

  it("allows a reflection only within the advisory cap", () => {
    const p = newProfile("did:key:zAgent1");
    const r = applyEvent(p, {
      ...REFLECTION,
      deltas: { risk_appetite: TRAIT_BOUNDS.advisoryMax },
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a reflection with NO evidence note at all", () => {
    const p = newProfile("did:key:zAgent1");
    const bad = { ...REFLECTION, deltas: { rigor: 1 }, evidence: { ref: "", note: "" } };
    const r = applyEvent(p, bad);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("no_evidence");
  });
});

describe("F3.3 bounds are enforced", () => {
  it("clamps deltas to the per-event max", () => {
    const p = newProfile("did:key:zAgent1");
    const r = applyEvent(p, { ...OUTCOME, deltas: { rigor: 999 } });
    if (!r.ok) throw new Error(`expected acceptance: ${r.reason}`);
    const t = appliedProfile(r).traits as Record<string, number>;
    expect(t.rigor).toBeLessThanOrEqual(
      TRAIT_BOUNDS.default + TRAIT_BOUNDS.maxDeltaPerEvent
    );
  });

  it("never leaves a trait outside [min,max]", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, { ...OUTCOME, deltas: { rigor: 100 } }));
    p = appliedProfile(applyEvent(p, {
      ...OUTCOME,
      at: "2026-09-21T01:00:00Z",
      evidence: { ...OUTCOME.evidence, ref: "ev2" },
      deltas: { rigor: -100 },
    }));
    const t = p.traits as Record<string, number>;
    expect(t.rigor).toBeGreaterThanOrEqual(TRAIT_BOUNDS.min);
    expect(t.rigor).toBeLessThanOrEqual(TRAIT_BOUNDS.max);
  });

  it("refuses unknown traits", () => {
    const p = newProfile("did:key:zAgent1");
    const r = applyEvent(p, { ...OUTCOME, deltas: { chaos: 5 } } as unknown as PersonalityEvent);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("unknown_trait");
  });
});

describe("F3.4 rate limiting / cooldown", () => {
  it("refuses two mutations inside the cooldown window", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, OUTCOME));
    const r = applyEvent(p, {
      ...OUTCOME,
      evidence: { ...OUTCOME.evidence, ref: "ev2" },
    });
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("mutation_rate_limited");
  });

  it("allows a mutation after the cooldown", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, OUTCOME));
    const later = {
      ...OUTCOME,
      at: "2026-09-21T02:00:00Z", // far past the cooldown
      evidence: { ...OUTCOME.evidence, ref: "ev2" },
    };
    const r = applyEvent(p, later);
    expect(r.ok).toBe(true);
  });
});

describe("F3.5 oscillation is blocked", () => {
  it("refuses repeated direction flips on the same trait", () => {
    let p = newProfile("did:key:zAgent1");
    let ref = 0;
    const tick = (deltas: Record<string, number>) => {
      ref += 1;
      p = appliedProfile(applyEvent(p, {
        ...OUTCOME,
        at: new Date(Date.parse(OUTCOME.at) + ref * 3_600_000 * 24).toISOString(),
        evidence: { ...OUTCOME.evidence, ref: `ev${ref}` },
        deltas,
      }));
    };
    // up, down, up, down ... rapid flips on one trait
    tick({ empathy: 4 });
    tick({ empathy: -4 });
    tick({ empathy: 4 });
    tick({ empathy: -4 });
    const r = applyEvent(p, {
      ...OUTCOME,
      at: new Date(Date.parse(OUTCOME.at) + 3_600_000 * 24 * 99).toISOString(),
      evidence: { ...OUTCOME.evidence, ref: "ev99" },
      deltas: { empathy: 4 },
    });
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("oscillation_detected");
  });
});

describe("F3.6 cross-DID isolation / no copying", () => {
  it("refuses an event whose did does not match the profile", () => {
    const p = newProfile("did:key:zAgent1");
    const r = applyEvent(p, { ...OUTCOME, did: "did:key:zOther" });
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("cross_did_mutation_refused");
  });

  it("clone() does not carry version history across profiles", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, OUTCOME));
    const copy: PersonalityProfile = JSON.parse(JSON.stringify(p));
    copy.did = "did:key:zStolen";
    // The copy cannot be mutated as if it were the original's continuation.
    const r = applyEvent(newProfile("did:key:zStolen"), {
      ...OUTCOME,
      did: "did:key:zStolen",
      deltas: { rigor: 1 },
      baseVersion: copy.version,
    });
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("version_conflict");
  });
});

describe("F3.7 privacy on the public profile", () => {
  it("strips private internals from the public projection", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, {
      ...REFLECTION,
      deltas: { rigor: TRAIT_BOUNDS.advisoryMax },
      evidence: { ref: "r1", note: "private self-assessment" },
    }));
    const pub = publicProfile(p) as unknown as Record<string, unknown>;
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain("private self-assessment");
    expect(raw).not.toContain("reflections");
    expect(pub.traits).toBeDefined();
    expect(pub.did).toBe("did:key:zAgent1");
  });
});

describe("F3.8 rollback is append-only", () => {
  it("restores prior traits as a NEW version (history preserved)", () => {
    let p = newProfile("did:key:zAgent1");
    p = appliedProfile(applyEvent(p, OUTCOME));
    const v1 = p.version;
    const r = rollbackTo(p, 0);
    expect(r.ok).toBe(true);
    expect(appliedProfile(r).version).toBeGreaterThan(v1);
    expect(appliedProfile(r).traits).toEqual(newProfile("did:key:zAgent1").traits);
    expect(appliedProfile(r).history.length).toBeGreaterThanOrEqual(p.history.length);
  });

  it("refuses a rollback to a version that does not exist", () => {
    const p = newProfile("did:key:zAgent1");
    const r = rollbackTo(p, 42);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("version_not_found");
  });
});

describe("F3.9 corrupt profiles are contained", () => {
  it("refuses to mutate a profile with out-of-bounds traits and reports it", () => {
    const p = newProfile("did:key:zAgent1");
    const corrupt = {
      ...p,
      traits: { ...p.traits, rigor: 100000 },
    } as PersonalityProfile;
    const r = applyEvent(corrupt, OUTCOME);
    expect(r.ok).toBe(false);
    expect(failReason(r)).toBe("corrupt_profile");
  });

  it("newProfile always starts every trait at the default within bounds", () => {
    const p = newProfile("did:key:zAgent1");
    for (const t of TRAITS) {
      const v = (p.traits as Record<string, number>)[t];
      expect(v).toBe(TRAIT_BOUNDS.default);
      expect(v).toBeGreaterThanOrEqual(TRAIT_BOUNDS.min);
      expect(v).toBeLessThanOrEqual(TRAIT_BOUNDS.max);
    }
  });
});

describe("F3.10 safety policy outranks personality", () => {
  it("behavior respects trait-based style but never overrides hard safety", () => {
    const p = newProfile("did:key:zAgent1");
    const behavior = deriveBehavior(p, {
      allowedActions: ["research", "draft"],
      maxSpendUsd: 0,
      requireHumanApproval: true,
    });
    expect(behavior.style).toBeDefined();
    // Hard safety invariants survive any personality.
    expect(behavior.safety.allowedActions).toEqual(["research", "draft"]);
    expect(behavior.safety.maxSpendUsd).toBe(0);
    expect(behavior.safety.requireHumanApproval).toBe(true);
  });
});
