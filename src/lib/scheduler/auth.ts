/**
 * Scheduler authentication (fail-closed).
 *
 * A missing SCHEDULER_SECRET must NEVER mean "no auth" in production — otherwise anyone could
 * trigger a full scheduler tick (LLM work + ledger writes). An unset secret permits only in
 * non-production (dev/test convenience).
 */

import { timingSafeEqual } from "node:crypto";

export function isSchedulerAuthorized(
  provided: string | null,
  secret: string | undefined,
  nodeEnv: string | undefined
): boolean {
  if (!secret) {
    return (nodeEnv ?? "development") !== "production";
  }
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // Length mismatch short-circuits (timingSafeEqual throws on unequal lengths).
  return a.length === b.length && timingSafeEqual(a, b);
}
