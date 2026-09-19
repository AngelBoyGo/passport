/**
 * Distributed lease registry (Phase 42) — mutual exclusion for ALL in-process
 * scheduled jobs, not just the brain.
 *
 * The brain was hardened first (Phase 40) after its cycle could double-run across
 * replicas. The general scheduler tick and revenue runner had the same defect:
 * every Node replica that boots starts its own cron and would duplicate LLM work,
 * evidence writes, and revenue credits under horizontal scaling.
 *
 * All jobs share the BrainLease table (generic id/owner/expiry rows — the model
 * comment now documents it as the scheduler-wide lease registry). Acquisition is
 * an atomic conditional `updateMany`; expired leases (crashed owner) may be taken
 * over; a live lease blocks other instances. Callers must FAIL CLOSED: if the
 * lease store is unreachable, skip the job rather than run it uncoordinated.
 */

import { prisma } from "@/lib/db";

/** Default lease TTL — must exceed the longest expected job duration. */
export const LEASE_TTL_MS = 10 * 60_000;

export interface LeaseHandle {
  id: string;
  ownerId: string;
  release: () => Promise<void>;
}

function newOwnerId(): string {
  return `lease_${process.pid.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Attempts to acquire a lease by id. Returns a handle on success, or null when
 * another live job holds it. Database errors THROW — callers must fail closed.
 */
export async function acquireLease(leaseId: string, ttlMs: number = LEASE_TTL_MS): Promise<LeaseHandle | null> {
  const ownerId = newOwnerId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Atomic takeover: succeeds only for our ownerId or when the prior lease expired.
  const taken = await prisma.brainLease.updateMany({
    where: {
      id: leaseId,
      OR: [{ ownerId }, { expiresAt: { lt: now } }],
    },
    data: { ownerId, expiresAt },
  });

  if (taken.count === 1) {
    return { id: leaseId, ownerId, release: () => releaseLease(leaseId, ownerId) };
  }

  // No row yet (first ever run for this job) — create it. PK conflict = someone beat us.
  try {
    await prisma.brainLease.create({
      data: { id: leaseId, ownerId, expiresAt },
    });
    return { id: leaseId, ownerId, release: () => releaseLease(leaseId, ownerId) };
  } catch {
    return null;
  }
}

/** Releases the lease if (and only if) we still own it. */
export async function releaseLease(leaseId: string, ownerId: string): Promise<void> {
  await prisma.brainLease.deleteMany({
    where: { id: leaseId, ownerId },
  });
}