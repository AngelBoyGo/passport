/**
 * In-process scheduler — runs the Think Tank + Runtime cycle on a cron schedule.
 * Replaces Vercel Cron Jobs. Starts when the Next.js server boots.
 */

import cron from "node-cron";
import { prisma } from "@/lib/db";
import { runTick, type SchedulerDeps } from "@/lib/scheduler/scheduler-service";

let initialized = false;

export function startScheduler(): void {
  if (initialized) return;
  initialized = true;

  const isDev = process.env.NODE_ENV === "development";
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  if (isTest) {
    console.log("[scheduler] Skipping cron startup in test mode");
    return;
  }

  // Run every hour in production, every 5 minutes in dev
  const schedule = isDev ? "*/5 * * * *" : "0 * * * *";

  console.log(`[scheduler] Starting with schedule: "${schedule}" (${isDev ? "dev" : "production"} mode)`);

  cron.schedule(schedule, async () => {
    const startedAt = Date.now();
    console.log(`[scheduler] Tick starting at ${new Date().toISOString()}`);

    try {
      const deps = createSchedulerDeps();
      const result = await runTick(deps);
      const durationMs = Date.now() - startedAt;
      console.log(`[scheduler] Tick ${result.tick_id} completed in ${durationMs}ms: ${result.runtime.summary}`);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      console.error(`[scheduler] Tick failed after ${durationMs}ms:`, err instanceof Error ? err.message : String(err));
    }
  });

  // Run the first tick immediately after a short delay (let the server settle)
  setTimeout(async () => {
    console.log("[scheduler] Running initial tick...");
    try {
      const deps = createSchedulerDeps();
      const result = await runTick(deps);
      console.log(`[scheduler] Initial tick ${result.tick_id}: ${result.runtime.summary}`);
    } catch (err) {
      console.error("[scheduler] Initial tick failed:", err instanceof Error ? err.message : String(err));
    }
  }, 10000);
}

function createSchedulerDeps(): SchedulerDeps {
  return {
    getSystemState: async () => {
      const [enrolledCount, totalEvidence, totalReceipts, wallets, operatorCount, agentCount, recentEvidence] = await Promise.all([
        prisma.agentEnrollment.count({ where: { status: "ISSUED" } }),
        prisma.agentEvidence.count(),
        prisma.receipt.count(),
        prisma.agentWallet.findMany(),
        prisma.operator.count(),
        prisma.agent.count(),
        prisma.agentEvidence.findMany({
          where: { observedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
          select: { observedAt: true },
        }),
      ]);
      return { enrolledCount, totalEvidence, totalReceipts, wallets, operatorCount, agentCount, recentEvidence };
    },
    getRecentDiscoveries: async (days, limit) => {
      const results = await prisma.agentEvidence.findMany({
        where: {
          sourceType: "think_tank_discovery",
          observedAt: { gte: new Date(Date.now() - days * 86400000) },
        },
        orderBy: { observedAt: "desc" },
        take: limit,
        select: { sourceDigest: true, agentIdentityCommitment: true },
      });
      return results;
    },
    getCurrentInstances: async () => {
      const agents = await prisma.agent.findMany({ select: { agentId: true } });
      return Promise.all(
        agents.map(async (agent) => {
          const wallet = await prisma.agentWallet.findUnique({ where: { subjectCommitment: agent.agentId } });
          return {
            commitment: agent.agentId,
            tier: "20",
            status: "active" as const,
            earnedTotal: wallet?.earnedTotal ?? 0,
            spentTotal: wallet?.spentTotal ?? 0,
            uptimeHours: Math.floor((wallet?.earnedTotal ?? 0) / 10),
          };
        })
      );
    },
    postEvidence: async (payload) => {
      const result = await prisma.agentEvidence.create({
        data: {
          sourceType: "think_tank_scheduler_tick",
          artifactType: "report",
          normalizedEventType: "AGENT_RUN_OBSERVED",
          observedAt: new Date(),
          agentIdentityCommitment: "scheduler",
          eventCommitmentHash: `tick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sourceDigest: JSON.stringify(payload),
          validationSignalPresent: true,
        },
        select: { eventCommitmentHash: true },
      });
      return { event_commitment_hash: result.eventCommitmentHash };
    },
    now: () => new Date().toISOString(),
    generateId: () => Math.random().toString(36).slice(2, 14),
  };
}