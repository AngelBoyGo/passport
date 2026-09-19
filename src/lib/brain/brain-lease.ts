/**
 * Brain lease (Phase 40) — distributed mutual exclusion for Command Brain cycles.
 *
 * The brain previously had no concurrency guard: two replicas (or a scheduler tick
 * plus a manual API trigger) could both gather state, both call the LLM, and both
 * execute actions — writing competing memory and double-executing state changes.
 *
 * Delegates to the generic scheduler lease registry (Phase 42), which shares the
 * BrainLease table across all scheduled jobs. Lease operations fail CLOSED: if the
 * lease table is unreachable, the cycle is skipped rather than risked uncoordinated.
 */

import { acquireLease } from "@/lib/scheduler/lease";

export const BRAIN_LEASE_ID = "command-brain";

/** How long a lease holder may hold the lease before it is considered stale. */
export const BRAIN_LEASE_TTL_MS = 5 * 60_000;

export interface BrainLeaseHandle {
  ownerId: string;
  release: () => Promise<void>;
}

/**
 * Attempts to acquire the brain lease. Returns a handle on success, or null when
 * another live cycle holds it. Database errors throw — callers must fail closed.
 */
export async function acquireBrainLease(ttlMs: number = BRAIN_LEASE_TTL_MS): Promise<BrainLeaseHandle | null> {
  const handle = await acquireLease(BRAIN_LEASE_ID, ttlMs);
  return handle ? { ownerId: handle.ownerId, release: handle.release } : null;
}