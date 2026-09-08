/**
 * Rail lifecycle state machine — the single choke point for every RailSpec transition.
 *
 * Matches the house concurrency pattern: transitions are ALWAYS a conditional
 * `updateMany({ where: { id, state, version }, data: { state, version: { increment: 1 } } })`
 * and abort when `count !== 1`. This closes the TOCTOU race that would otherwise allow two
 * concurrent enable/quarantine requests to both win.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PROPOSED: ["PROVISIONED", "RETIRED"],
  PROVISIONED: ["SMOKE_TESTED", "RETIRED"],
  SMOKE_TESTED: ["ENABLED", "QUARANTINED", "RETIRED"],
  ENABLED: ["QUARANTINED", "RETIRED"],
  QUARANTINED: ["ENABLED", "RETIRED"],
  RETIRED: [],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export interface TransitionInput {
  id: string;
  from: string;
  to: string;
  version: number;
}

/**
 * Atomically transitions a RailSpec between states. Throws on illegal transition or on
 * a concurrent mutation (version/state mismatch → count 0).
 */
export async function transitionRailState(tx: any, input: TransitionInput): Promise<void> {
  if (!canTransition(input.from, input.to)) {
    throw new Error(`Illegal rail transition ${input.from} -> ${input.to}`);
  }
  const updated = await tx.railSpec.updateMany({
    where: { id: input.id, state: input.from, version: input.version },
    data: { state: input.to, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new Error("Rail state moved under us (concurrent mutation)");
  }
}
