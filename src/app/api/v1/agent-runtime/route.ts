import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { computeRuntimeCycle, type RuntimeCycleInput } from "@/lib/agent-runtime/runtime-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agent-runtime — execute a runtime cycle.
 *
 * Reads the Think Tank's allocation plan from the request body,
 * queries current instance state, and returns a plan for creation,
 * stopping, and task assignment.
 *
 * Rate-limited: 5 per IP per minute (runtime cycles are expensive).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`agent-runtime:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  // Optional: accept a custom allocation plan, or use defaults
  let body: { allocation?: RuntimeCycleInput["allocation"]; force?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Gather current agent instances from the database
  const agents = await prisma.agent.findMany({
    select: { agentId: true, domain: true },
  });

  const currentInstances = await Promise.all(
    agents.map(async (agent) => {
      const wallet = await prisma.agentWallet.findUnique({
        where: { subjectCommitment: agent.agentId },
      });
      const evidenceCount = await prisma.agentEvidence.count({
        where: { agentIdentityCommitment: agent.agentId },
      });

      return {
        commitment: agent.agentId,
        tier: "20", // Default tier — would come from a real cost tracking system
        status: "active" as const,
        earnedTotal: wallet?.earnedTotal ?? 0,
        spentTotal: wallet?.spentTotal ?? 0,
        uptimeHours: Math.floor(wallet?.earnedTotal ?? 0 / 10), // Rough estimate
      };
    })
  );

  // Gather recent discoveries as available tasks
  const recentDiscoveries = await prisma.agentEvidence.findMany({
    where: { sourceType: "think_tank_discovery" },
    orderBy: { observedAt: "desc" },
    take: 20,
    select: { sourceDigest: true, agentIdentityCommitment: true },
  });

  const availableTasks = recentDiscoveries.map((d, i) => ({
    description: d.sourceDigest?.slice(0, 100) || `Discovery from ${d.agentIdentityCommitment.slice(0, 12)}`,
    value: Math.max(10, 100 - i * 5), // Diminishing value
    searchQuery: d.sourceDigest?.slice(0, 100) || "",
    confidence: Math.max(0.1, 0.9 - i * 0.05),
  }));

  // Get treasury balance (sum of all agent wallets)
  const wallets = await prisma.agentWallet.findMany();
  const treasuryBalance = wallets.reduce((sum, w) => sum + w.balance, 0);

  // Use the provided allocation or compute a default
  const allocation = body.allocation || {
    tiers: [
      { instanceCount: Math.max(3, Math.ceil(agents.length * 1.1)), costPerInstance: 50, capability: "high_compute_llm", expectedOutput: "analysis and discovery" },
      { instanceCount: Math.max(2, Math.ceil(agents.length * 0.5)), costPerInstance: 20, capability: "medium_compute", expectedOutput: "data collection and monitoring" },
    ],
  };

  const input: RuntimeCycleInput = {
    allocation,
    currentInstances,
    treasuryBalance,
    availableTasks,
  };

  const result = computeRuntimeCycle(input);

  return NextResponse.json({
    cycle_id: `cycle_${Date.now()}`,
    ...result,
    instances: {
      current: currentInstances.length,
      desired: allocation.tiers.reduce((s, t) => s + t.instanceCount, 0),
    },
    treasury: {
      balance: treasuryBalance,
      allocated: result.totalCost,
      remaining: treasuryBalance - result.totalCost,
    },
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}