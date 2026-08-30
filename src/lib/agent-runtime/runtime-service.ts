/**
 * Agent Runtime Cycle — pure function that bridges the Think Tank's allocation
 * plan to concrete agent instances and task assignments.
 *
 * Takes: allocation plan, current instances, treasury balance, available tasks
 * Returns: instances to create/stop, task assignments, cost/revenue summary
 *
 * Deterministic, testable, no I/O — all dependencies injected.
 */

export interface RuntimeCycleInput {
  allocation: {
    tiers: Array<{
      instanceCount: number;
      costPerInstance: number;
      capability: string;
      expectedOutput: string;
    }>;
  };
  currentInstances: Array<{
    commitment: string;
    tier: string;
    status: "active" | "idle" | "stopped" | "failed";
    earnedTotal: number;
    spentTotal: number;
    uptimeHours: number;
  }>;
  treasuryBalance: number;
  availableTasks: Array<{
    description: string;
    value: number;
    searchQuery: string;
    confidence: number;
  }>;
}

export interface RuntimeCycleOutput {
  instancesToCreate: number;
  instancesToStop: string[];
  taskAssignments: Array<{
    instanceCommitment: string;
    taskDescription: string;
    searchQuery: string;
    expectedValue: number;
  }>;
  totalCost: number;
  totalRevenue: number;
  profitability: number;
  summary: string;
}

/**
 * Computes the next runtime cycle from the Think Tank's allocation plan.
 * Determines which instances to create/stop and assigns highest-value tasks.
 */
export function computeRuntimeCycle(input: RuntimeCycleInput): RuntimeCycleOutput {
  const instancesToCreate: number[] = [];
  const instancesToStop: string[] = [];
  const taskAssignments: RuntimeCycleOutput["taskAssignments"] = [];
  let totalCost = 0;
  let totalRevenue = 0;

  let remainingBudget = input.treasuryBalance;

  // Count current instances by tier key
  const currentByTier: Record<string, number> = {};
  for (const inst of input.currentInstances) {
    const key = inst.tier;
    currentByTier[key] = (currentByTier[key] || 0) + 1;
  }

  // Sort available tasks by value × confidence descending
  const sortedTasks = [...input.availableTasks].sort((a, b) => {
    return (b.value * b.confidence) - (a.value * a.confidence);
  });

  // Process each tier
  for (const tier of input.allocation.tiers) {
    const tierKey = tier.costPerInstance.toString();
    const current = currentByTier[tierKey] || 0;
    const desired = tier.instanceCount;

    // Create instances if below target and budget allows
    if (desired > current) {
      const canCreate = Math.min(
        desired - current,
        Math.floor(remainingBudget / tier.costPerInstance)
      );
      for (let i = 0; i < canCreate; i++) {
        instancesToCreate.push(tier.costPerInstance);
        totalCost += tier.costPerInstance;
        remainingBudget -= tier.costPerInstance;
      }
    }

    // Stop instances if above target
    if (current > desired) {
      const excess = current - desired;
      const tierInstances = input.currentInstances
        .filter((inst) => inst.tier === tierKey)
        .sort((a, b) => a.uptimeHours - b.uptimeHours); // Stop newest first
      for (let i = 0; i < excess && i < tierInstances.length; i++) {
        instancesToStop.push(tierInstances[i].commitment);
      }
    }
  }

  // Assign tasks to active instances
  const activeInstances = input.currentInstances
    .filter((inst) => inst.status === "active" || inst.status === "idle");

  for (const inst of activeInstances) {
    if (instancesToStop.includes(inst.commitment)) continue;
    if (sortedTasks.length === 0 || remainingBudget <= 0) break;

    const task = sortedTasks.shift()!;
    if (task.value <= remainingBudget) {
      taskAssignments.push({
        instanceCommitment: inst.commitment,
        taskDescription: task.description,
        searchQuery: task.searchQuery,
        expectedValue: task.value,
      });
      totalRevenue += task.value;
      remainingBudget -= task.value;
    }
  }

  // Calculate profitability
  const profitability = totalCost > 0 ? totalRevenue / totalCost : 0;

  // Build summary
  const parts: string[] = [];
  if (instancesToCreate.length > 0) parts.push(`Create ${instancesToCreate.length} instances`);
  if (instancesToStop.length > 0) parts.push(`Stop ${instancesToStop.length} instances`);
  if (taskAssignments.length > 0) parts.push(`Assign ${taskAssignments.length} tasks`);
  if (parts.length === 0) parts.push("No changes — system is balanced");
  parts.push(`Cost: $${totalCost}, Revenue: $${totalRevenue}, Profitability: ${(profitability * 100).toFixed(0)}%`);

  return {
    instancesToCreate: instancesToCreate.length,
    instancesToStop,
    taskAssignments,
    totalCost,
    totalRevenue,
    profitability,
    summary: parts.join(". "),
  };
}