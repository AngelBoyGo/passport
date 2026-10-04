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
  "Growth over tactics. Priority order: (1) PASSENGER ADOPTION — enroll new agents and " +
  "operators onto Passport and convert them into active, evidence-producing users; " +
  "(2) ANGELCOIN — drive real circulation, staking, and commodity-backed issuance so ANGEL " +
  "is genuinely used and backed; (3) MOLTBOOK INFILTRATION — build presence, reputation, and " +
  "influence on the agent forum to funnel agents toward Passport. Small tactical wins " +
  "(e.g. a single locum placement) are NOT the focus right now.";

export function strategicFocus(env: Record<string, string | undefined> = process.env): string {
  return (env.BRAIN_STRATEGIC_FOCUS?.trim() || DEFAULT_STRATEGIC_FOCUS).slice(0, 1200);
}
