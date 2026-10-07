/**
 * Bounded retention for the brain's append-only history.
 *
 * Every brain cycle writes several BrainMemory rows, and every re-plan writes a
 * new MissionPlan (superseding the prior). Nothing pruned either table, so the
 * DB grows without limit and slowly contaminates dashboards/aggregations. This
 * keeps the most recent N rows and deletes older ones.
 *
 * Safety:
 *  - MissionPlan: only deletes NON-COMMITTED plans, and never a plan still
 *    referenced by Mission.currentPlanId (so a live plan can never be removed).
 *  - BrainMemory: no foreign keys reference it; keeping the newest N is safe.
 *  - Best-effort: callers wrap in try/catch; a failure never breaks a cycle.
 */

import { prisma } from "@/lib/db";

const BRAIN_MEMORY_KEEP = 5000;
const MISSION_PLAN_KEEP = 500;

export async function pruneBrainHistory(): Promise<{ brainMemory: number; missionPlans: number }> {
  const memoryDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM "BrainMemory"
     WHERE id IN (
       SELECT id FROM "BrainMemory" ORDER BY "createdAt" DESC OFFSET $1
     )`,
    BRAIN_MEMORY_KEEP
  );

  const plansDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM "MissionPlan"
     WHERE id IN (
       SELECT p.id FROM "MissionPlan" p
       WHERE p.status <> 'COMMITTED'
         AND NOT EXISTS (SELECT 1 FROM "Mission" m WHERE m."currentPlanId" = p.id)
       ORDER BY p."createdAt" DESC OFFSET $1
     )`,
    MISSION_PLAN_KEEP
  );

  return { brainMemory: Number(memoryDeleted), missionPlans: Number(plansDeleted) };
}
