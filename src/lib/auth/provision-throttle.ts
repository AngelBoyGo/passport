/**
 * Persistent provisioning throttle (Sybil resistance).
 *
 * AUDIT FIX (H3): the autonomous-provision daily cap was an in-memory counter
 * that reset on every restart/replica, so a single actor could mint unbounded
 * identities. This module is DB-backed and cross-replica safe: it increments a
 * per-(scope,key,window) counter atomically under a unique constraint and
 * refuses when the window count exceeds the limit.
 */

import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Floor a timestamp to the start of its fixed window. */
export function windowStart(nowMs: number, windowMs: number): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

export interface ThrottleResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: Date;
}

/**
 * Atomically consumes one slot for (scope, key) in the current window.
 * Returns allowed=false when the limit is already reached (no slot consumed).
 * Fail-closed on DB error is the caller's decision; this throws on hard errors.
 */
export async function consumeProvisioningSlot(
  scope: string,
  key: string,
  limit: number,
  nowMs: number = Date.now(),
  windowMs: number = DAY_MS
): Promise<ThrottleResult> {
  const ws = windowStart(nowMs, windowMs);
  const resetAt = new Date(ws.getTime() + windowMs);

  // Atomic increment guarded by a conditional update; if no row matched, create.
  // The unique (scope,key,windowStart) makes the create idempotent-safe: a race
  // loser gets P2002 and falls back to the guarded update.
  const bumped = await prisma.provisioningThrottle.updateMany({
    where: { scope, key, windowStart: ws, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  if (bumped.count === 1) {
    const row = await prisma.provisioningThrottle.findUnique({
      where: { scope_key_windowStart: { scope, key, windowStart: ws } },
    });
    return { allowed: true, count: row?.count ?? 1, limit, resetAt };
  }

  // No row matched: either it doesn't exist yet, or it's at the limit.
  try {
    const created = await prisma.provisioningThrottle.create({
      data: { scope, key, windowStart: ws, count: 1 },
    });
    return { allowed: true, count: created.count, limit, resetAt };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      // Row exists and is at the limit (the guarded update above matched 0).
      const row = await prisma.provisioningThrottle.findUnique({
        where: { scope_key_windowStart: { scope, key, windowStart: ws } },
      });
      return { allowed: false, count: row?.count ?? limit, limit, resetAt };
    }
    throw err;
  }
}
