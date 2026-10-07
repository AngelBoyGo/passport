/**
 * Shared guard for in-process schedulers.
 *
 * Schedulers that make real LLM calls, write to the DB, read external services,
 * or execute money intents must NOT run during tests, local development, or a
 * SECONDARY deployment (cross-environment contamination: a dev/staging box
 * pointed at prod keys, the prod DB, or the same Telegram bot would fire real
 * cycles every 10 minutes and send duplicate digests).
 *
 * Rule:
 *   - SCHEDULERS_ENABLED=true    → start (explicit opt-in always wins; tests).
 *   - vitest / NODE_ENV=test     → never start.
 *   - SCHEDULERS_ENABLED=false   → never start (explicit operator kill switch).
 *   - SCHEDULER_ROLE != primary  → never start (environment identity; only the
 *                                  primary deployment runs schedulers).
 *   - NODE_ENV=development       → start only if SCHEDULERS_ENABLED=true.
 *   - production                 → start unless SCHEDULERS_ENABLED=false.
 *
 * Multi-replica: even when several replicas of the PRIMARY deployment run, each
 * job is additionally guarded by a distributed lease (src/lib/scheduler/lease.ts)
 * so the work executes on exactly one replica.
 */
let warnedMissingRole = false;

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
  // Environment identity: a secondary/staging deployment must never run the
  // schedulers, even in NODE_ENV=production (it may share the Telegram bot or
  // the database). Only `SCHEDULER_ROLE=primary` may run them.
  const role = String(process.env.SCHEDULER_ROLE || "").trim().toLowerCase();
  if (role && role !== "primary") {
    return { allowed: false, reason: `SCHEDULER_ROLE=${role} (only "primary" runs schedulers)` };
  }
  if (process.env.NODE_ENV === "development") {
    return { allowed: false, reason: "development (set SCHEDULERS_ENABLED=true to opt in)" };
  }
  if (process.env.NODE_ENV === "production" && !role && !warnedMissingRole) {
    warnedMissingRole = true;
    console.warn(
      "[scheduler] SCHEDULER_ROLE is not set — defaulting to primary. " +
        "Set SCHEDULER_ROLE=primary on the one deployment that should run schedulers " +
        "and SCHEDULER_ROLE=secondary on every other environment (staging, a second " +
        "replica you do not want scheduling), so only one environment schedules."
    );
  }
  return { allowed: true };
}
