/**
 * Strategic focus — what the Command Brain should currently pursue.
 *
 * The operator steers priorities here (overridable via the
 * BRAIN_STRATEGIC_FOCUS env var). This is injected into the mission-genesis
 * prompt and the cycle's system prompt, so the brain's self-authored missions
 * aim at the right target instead of defaulting to small tactical wins (e.g.
 * a first locum placement) when the real objective is platform growth.
 */
export const DEFAULT_STRATEGIC_FOCUS =
  "Revenue over motion. The SINGLE blocker is the first REAL external dollar — close ONE paid " +
  "engagement end-to-end (a locum/Medora placement or a marketplace engagement) and record the " +
  "revenue. Prefer concrete, revenue-producing actions (RUN_LOCUM_SEARCH, RUN_TICK, fleet dispatch) " +
  "over meta/governance steps (RECORD_NOTE, TRIGGER_ATTESTATION). Do NOT re-author " +
  "'adoption / attestation / flywheel' missions — keep ONE durable revenue mission at a time. " +
  "Adoption, ANGEL circulation, and staking FOLLOW revenue; they are not separate goals.";

export function strategicFocus(env: Record<string, string | undefined> = process.env): string {
  return (env.BRAIN_STRATEGIC_FOCUS?.trim() || DEFAULT_STRATEGIC_FOCUS).slice(0, 1200);
}
