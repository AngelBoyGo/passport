/**
 * Think Tank Orchestrator — dynamically manages agent instances.
 *
 * The orchestrator reads the think tank's allocation plan and spins up
 * or tears down agent instances accordingly. This is the "hands" of the
 * system — the kernel thinks, the orchestrator acts.
 *
 * Instances are tracked as Agent records in Passport. Each instance has:
 *   - A Passport identity (Ed25519 keypair)
 *   - A capability tier (high/medium/low compute)
 *   - A cost per period
 *   - Assigned tasks from the think tank
 *   - Evidence of work completed
 */

export type InstanceStatus = "provisioning" | "active" | "idle" | "stopped" | "failed";

export interface AgentInstance {
  id: string;
  commitment: string;
  tier: string;
  capability: string;
  costPerPeriod: number;
  costCurrency: string;
  status: InstanceStatus;
  assignedTask: string | null;
  totalEarned: number;
  totalSpent: number;
  uptimeHours: number;
  lastHeartbeat: string | null;
  createdAt: string;
}

export interface OrchestrationPlan {
  instancesToCreate: Array<{ tier: string; capability: string; costPerPeriod: number }>;
  instancesToStop: string[];
  totalCost: number;
  expectedOutput: string;
}

export interface OrchestratorDeps {
  /** Create a new agent instance (autonomous provision) */
  createInstance: (tier: string, capability: string) => Promise<{ commitment: string; apiKey: string }>;
  /** Stop an existing instance */
  stopInstance: (commitment: string) => Promise<void>;
  /** Get all current instances */
  getInstances: () => Promise<AgentInstance[]>;
  /** Post evidence for an instance */
  postEvidence: (commitment: string, payload: unknown) => Promise<void>;
  /** Hire an agent to do work */
  hireAgent: (hirerCommitment: string, workerCommitment: string, amount: number, task: string) => Promise<boolean>;
  /** Get agent wallet balance */
  getWalletBalance: (commitment: string) => Promise<number>;
  /** Get current time */
  now: () => string;
}

/**
 * Computes the optimal orchestration plan from a think tank allocation.
 */
export function computeOrchestrationPlan(
  allocation: { tiers: Array<{ instanceCount: number; costPerInstance: number; capability: string; expectedOutput: string }> },
  currentInstances: AgentInstance[]
): OrchestrationPlan {
  const instancesToCreate: OrchestrationPlan["instancesToCreate"] = [];
  const instancesToStop: string[] = [];
  let totalCost = 0;

  // Current instance counts by tier
  const currentByTier: Record<string, number> = {};
  for (const inst of currentInstances) {
    currentByTier[inst.tier] = (currentByTier[inst.tier] || 0) + 1;
  }

  // Compare desired vs current
  for (const tier of allocation.tiers) {
    const current = currentByTier[tier.costPerInstance.toString()] || 0;
    const desired = tier.instanceCount;

    if (desired > current) {
      for (let i = 0; i < desired - current; i++) {
        instancesToCreate.push({
          tier: tier.costPerInstance.toString(),
          capability: tier.capability,
          costPerPeriod: tier.costPerInstance,
        });
        totalCost += tier.costPerInstance;
      }
    } else if (current > desired) {
      // Mark excess instances for stop
      const tierInstances = currentInstances
        .filter((inst) => inst.tier === tier.costPerInstance.toString())
        .sort((a, b) => a.uptimeHours - b.uptimeHours); // Stop newest first
      for (let i = 0; i < current - desired && i < tierInstances.length; i++) {
        instancesToStop.push(tierInstances[i].commitment);
      }
    }
  }

  const expectedOutput = allocation.tiers.map((t) =>
    `${t.instanceCount} × ${t.capability}: ${t.expectedOutput}`
  ).join("; ");

  return { instancesToCreate, instancesToStop, totalCost, expectedOutput };
}

/**
 * Executes the orchestration plan — creates and stops instances.
 */
export async function executeOrchestrationPlan(
  plan: OrchestrationPlan,
  deps: OrchestratorDeps
): Promise<{
  created: string[];
  stopped: string[];
  failed: string[];
  totalCost: number;
}> {
  const created: string[] = [];
  const stopped: string[] = [];
  const failed: string[] = [];

  // Create new instances
  for (const spec of plan.instancesToCreate) {
    try {
      const instance = await deps.createInstance(spec.tier, spec.capability);
      created.push(instance.commitment);

      await deps.postEvidence(instance.commitment, {
        event: "instance_provisioned",
        tier: spec.tier,
        capability: spec.capability,
        costPerPeriod: spec.costPerPeriod,
        timestamp: deps.now(),
      });
    } catch (err) {
      failed.push(`create_${spec.tier}_${spec.capability}`);
    }
  }

  // Stop excess instances
  for (const commitment of plan.instancesToStop) {
    try {
      await deps.stopInstance(commitment);
      stopped.push(commitment);

      await deps.postEvidence(commitment, {
        event: "instance_stopped",
        reason: "orchestration_scale_down",
        timestamp: deps.now(),
      });
    } catch {
      failed.push(`stop_${commitment}`);
    }
  }

  return { created, stopped, failed, totalCost: plan.totalCost };
}

/**
 * Assigns a task to a specific agent instance.
 */
export async function assignTask(
  instance: AgentInstance,
  task: { description: string; value: number; deadline: string },
  deps: Pick<OrchestratorDeps, "hireAgent" | "getWalletBalance">,
  treasuryCommitment: string
): Promise<boolean> {
  const balance = await deps.getWalletBalance(treasuryCommitment);
  if (balance < task.value) return false;

  return deps.hireAgent(treasuryCommitment, instance.commitment, task.value, task.description);
}