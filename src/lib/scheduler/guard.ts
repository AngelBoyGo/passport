/**
 * Shared guard for in-process schedulers.
 *
 * Schedulers that make real LLM calls, write to the DB, read external services,
 * or execute money intents must NOT run during tests or local development
 * (cross-environment contamination: a dev box pointed at prod keys would fire
 * real cycles every 10 minutes). node-cron.ts already skipped test mode; the
 * brain/moltbook/fleet-dispatch schedulers did not. This centralizes the rule.
 *
 * Rule:
 *   - vitest / NODE_ENV=test  → never start.
 *   - SCHEDULERS_ENABLED=false → never start (explicit operator kill switch).
 *   - NODE_ENV=development    → start only if SCHEDULERS_ENABLED=true (opt-in).
 *   - production              → start unless SCHEDULERS_ENABLED=false.
 */
export function schedulersAllowed(): { allowed: boolean; reason?: string } {
  const explicit = String(process.env.SCHEDULERS_ENABLED || "").toLowerCase();
  // An explicit opt-in always wins (lets a test exercise the scheduling logic
  // without actually running jobs — the jobs are mocked at their boundaries).
  if (explicit === "true") {
    return { allowed: true };
  }
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return { allowed: false, reason: "test environment" };
  }
  if (explicit === "false") {
    return { allowed: false, reason: "SCHEDULERS_ENABLED=false" };
  }
  if (process.env.NODE_ENV === "development") {
    return { allowed: false, reason: "development (set SCHEDULERS_ENABLED=true to opt in)" };
  }
  return { allowed: true };
}
