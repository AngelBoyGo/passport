import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { runTick, type SchedulerDeps } from "@/lib/scheduler/scheduler-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/scheduler/tick — run one full scheduler cycle.
 *
 * Chains: Think Tank analysis → Runtime Cycle → post evidence → return summary.
 * Designed to be called by Vercel Cron Jobs (or cron-job.org) at regular intervals.
 *
 * Rate-limited: 2 per IP per minute (one tick should be enough).
 * Protected: requires a SCHEDULER_SECRET header for production use.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`scheduler-tick:${ip}`, 2, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  // Production protection: require SCHEDULER_SECRET header
  const secret = process.env.SCHEDULER_SECRET;
  if (secret && request.headers.get("x-scheduler-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden: invalid scheduler secret" }, { status: 403 });
  }

  const startedAt = Date.now();

  const deps: SchedulerDeps = {
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
          const wallet = await prisma.agentWallet.findUnique({
            where: { subjectCommitment: agent.agentId },
          });
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
      // Post as evidence using the existing evidence pattern
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

  try {
    const result = await runTick(deps);
    const durationMs = Date.now() - startedAt;

    console.log(`[scheduler] Tick ${result.tick_id} completed in ${durationMs}ms: ${result.runtime.summary}`);

    return NextResponse.json({
      ...result,
      duration_ms: durationMs,
      next_tick: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : "Scheduler tick failed";

    console.error(`[scheduler] Tick failed after ${durationMs}ms: ${message}`);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/v1/scheduler/tick — get the last tick status.
 * Returns a simple health check for the scheduler.
 */
export async function GET(request: NextRequest) {
  const lastTick = await prisma.agentEvidence.findFirst({
    where: { sourceType: "think_tank_scheduler_tick" },
    orderBy: { observedAt: "desc" },
    select: { observedAt: true, sourceDigest: true },
  });

  const tickCount = await prisma.agentEvidence.count({
    where: { sourceType: "think_tank_scheduler_tick" },
  });

  return NextResponse.json({
    scheduler: {
      status: "active",
      total_ticks: tickCount,
      last_tick_at: lastTick?.observedAt?.toISOString() ?? null,
      last_tick_summary: lastTick?.sourceDigest?.slice(0, 200) ?? null,
      next_tick_at: new Date(Date.now() + 3600000).toISOString(),
      interval: "3600s (1 hour)",
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}