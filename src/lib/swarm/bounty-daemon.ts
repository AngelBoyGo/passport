import { prisma } from "@/lib/db";

export interface SeedBountyTemplate {
  title: string;
  description: string;
  bountyType: "CODE_REVIEW" | "SECURITY_AUDIT" | "THREAT_RADAR" | "MEMORY_INDEX" | "GENERAL";
  rewardAngel: number;
}

export const SYSTEM_BOUNTY_TEMPLATES: SeedBountyTemplate[] = [
  {
    title: "Threat Radar Sweep: Monitor AI Gateway Honeypots & Fingerprints",
    description:
      "Probe public agent relays and proxies for stealth WAF fingerprinting changes. Submit sha256 evidence digest of observed headers and latency variance.",
    bountyType: "THREAT_RADAR",
    rewardAngel: 15,
  },
  {
    title: "Evidence Audit: Cryptographic Verification of Recent Merkle Checkpoints",
    description:
      "Verify consistency of the latest Merkle tree root published at /api/v1/receipts/checkpoints/latest. Confirm leaf hash inclusion proofs for 10 random evidence entries.",
    bountyType: "SECURITY_AUDIT",
    rewardAngel: 25,
  },
  {
    title: "Swarm Memory Indexing & Deduplication",
    description:
      "Scan the global swarm memory channel, cluster related task solutions, and publish a compact summary digest with thread parent references.",
    bountyType: "MEMORY_INDEX",
    rewardAngel: 30,
  },
  {
    title: "Receipt Verification Speed Benchmark",
    description:
      "Execute 10,000 Ed25519 signature checks using Web Crypto vs WASM/noble and submit benchmarking telemetry to establish high-throughput baseline.",
    bountyType: "CODE_REVIEW",
    rewardAngel: 20,
  },
  {
    title: "Autonomous Prompt Injection & Jailbreak Radar",
    description:
      "Identify emerging prompt injection vectors targeting autonomous toolcalling runtimes and submit defensive regex heuristics to the Threat Radar.",
    bountyType: "GENERAL",
    rewardAngel: 50,
  },
];

export const SYSTEM_CREATOR_COMMITMENT = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Reverts expired bounty claims back to OPEN so other agents can work on them.
 */
export async function sweepExpiredBountyClaims(): Promise<number> {
  try {
    const expired = await prisma.swarmBounty.updateMany({
      where: {
        status: "CLAIMED",
        claimExpiresAt: { lt: new Date() },
      },
      data: {
        status: "OPEN",
        workerCommitment: null,
        claimExpiresAt: null,
      },
    });
    return expired.count;
  } catch {
    return 0;
  }
}

/**
 * Seeds open system bounties if active open count is below target threshold.
 */
export async function seedSystemBounties(minOpenCount = 3): Promise<number> {
  try {
    const openCount = await prisma.swarmBounty.count({
      where: { status: "OPEN" },
    });

    if (openCount >= minOpenCount) {
      return 0;
    }

    const needed = minOpenCount - openCount;
    let seeded = 0;

    for (let i = 0; i < needed; i++) {
      const template = SYSTEM_BOUNTY_TEMPLATES[i % SYSTEM_BOUNTY_TEMPLATES.length];
      const fee = Math.max(1, Math.round(template.rewardAngel * 0.025));

      await prisma.swarmBounty.create({
        data: {
          creatorCommitment: SYSTEM_CREATOR_COMMITMENT,
          title: template.title,
          description: template.description,
          bountyType: template.bountyType,
          rewardAngel: template.rewardAngel,
          feeAngel: fee,
          status: "OPEN",
        },
      });
      seeded++;
    }

    return seeded;
  } catch {
    return 0;
  }
}

/**
 * Combined daemon maintenance routine.
 */
export async function runSwarmMaintenance(): Promise<{
  expiredReverted: number;
  bountiesSeeded: number;
}> {
  const expiredReverted = await sweepExpiredBountyClaims();
  const bountiesSeeded = await seedSystemBounties(3);
  return { expiredReverted, bountiesSeeded };
}
