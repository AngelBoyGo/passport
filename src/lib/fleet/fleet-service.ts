/**
 * Fleet control plane — minting, stopping, and rehydrating fleet agents, each
 * bound 1:1 to a real Passport.
 *
 * Internal mint path: the fleet mints its own Ed25519 keypairs and drives the
 * enrollment service directly (challenge -> sign -> complete). No PoW — the
 * proof-of-work limit is anti-spam for EXTERNAL provisioning; internal mint is
 * an ISSUER-trust operation, subject instead to fleet caps and switches.
 *
 * Retention invariant: stopping an instance never deletes the Passport,
 * enrollment, API key, wallet, or evidence — it releases the runtime only.
 * Rehydration re-enters through provisioning and restores state from the
 * latest resurrection capsule (saved by the dispatch runtime, agent-signed).
 */

import crypto from "crypto";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { prisma } from "@/lib/db";
import { ed } from "@/lib/receipt/crypto";
import { hashApiKey } from "@/lib/operator";
import {
  startEnrollment,
  completeEnrollment,
  requireEnrolled,
} from "@/lib/enrollment/enrollment-service";
import {
  isLlmTier,
  resolveTierModel,
  type LlmTier,
} from "@/lib/llm/tiers";
import {
  canTransition,
  tierNotDowngraded,
  validateInstanceSpec,
  type InstanceStatus,
} from "./lifecycle";
import { sha256Hex } from "@/lib/receipt/canonical";
import { saveResurrectionCapsule, getResurrectionCapsule } from "@/lib/swarm/swarm-service";

const FLEET_DEFAULT_CAP = 25;

function fleetEnvInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Global fleet cap (env-overridable; protects the budget by construction). */
export function maxFleetAgents(): number {
  return fleetEnvInt("FLEET_MAX_AGENTS", FLEET_DEFAULT_CAP);
}

/** Money-tier minting is switch-gated (the fleet governance trigger). */
export function moneyMintEnabled(): boolean {
  return String(process.env.FLEET_MINT_MONEY_ENABLED || "false").toLowerCase() === "true";
}

/** Fleet kill switch — every governor-checked fleet operation refuses while set. */
export function fleetHalted(): boolean {
  return String(process.env.FLEET_HALT || "false").toLowerCase() === "true";
}

export interface MintInstanceInput {
  capability: string;
  llmTier: LlmTier;
  displayName?: string;
}

export interface MintedInstance {
  commitment: string;
  instanceId: string;
  operatorId: string;
  /** Handed over ONCE — the runtime layer keeps the keypair for capsule signing. */
  enrollment: { privateKeyHex: string; publicKeyHex: string };
  rawApiKey: string;
  tier: LlmTier;
  resolvedModel: string;
}

/** Project-local hex -> bytes (same semantics as @noble's hexToBytes). */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Mints one fleet agent with a real Passport (enrollment ISSUED) and a
 * persisted AgentInstance row. Fail-closed: any failure after the enrollment
 * is minted removes the partial rows — no zombie identities.
 */
export async function mintFleetAgent(input: MintInstanceInput): Promise<MintedInstance> {
  if (fleetHalted()) {
    throw new Error("fleet_halted");
  }
  if (!isLlmTier(input.llmTier)) {
    throw new Error(`unknown_llm_tier:${String(input.llmTier)}`);
  }
  if (input.llmTier === "money" && !moneyMintEnabled()) {
    throw new Error("money_tier_mint_disabled");
  }
  const specOk = validateInstanceSpec(input);
  if (!specOk.ok) {
    throw new Error(`invalid_instance_spec:${specOk.reason}`);
  }

  const cap = maxFleetAgents();

  // 1. Keypair — the private key is handed to the runtime layer exactly once.
  const privateKeyHex = bytesToHex(ed.utils.randomSecretKey());
  const publicKeyHex = bytesToHex(await ed.getPublicKeyAsync(hexToBytes(privateKeyHex)));

  // 2. Enroll (start -> sign challenge -> complete) — real Passport issuance.
  const challengePassport = await startEnrollment(publicKeyHex, "FLEET_AGENT");
  const signatureHex = bytesToHex(
    await ed.signAsync(utf8ToBytes(challengePassport.challengeNonce!), hexToBytes(privateKeyHex))
  );
  const passport = await completeEnrollment(challengePassport.subjectCommitment, signatureHex);

  // 3. Operator + bound HOLDER key + Agent + lifecycle row — with the fleet
  //    cap guard INSIDE a serializable transaction: count-then-create is only
  //    race-free when the read and the write commit at the serializable level.
  let instance;
  let createdOperatorId: string | undefined;
  try {
    instance = await prisma.$transaction(
      async (tx) => {
        const live = await tx.agentInstance.count({
          where: { status: { in: ["provisioning", "active", "idle"] } },
        });
        if (live >= cap) {
          throw new Error(`fleet_cap_reached:${live}/${cap}`);
        }

        const operator = await tx.operator.create({
          data: {
            stripeCustomerId: `cus_fleet_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`,
            email: null,
            tier: "free",
            credits: 0,
          },
        });
        createdOperatorId = operator.id;

        const rawApiKey = `pp_flt_${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
        await tx.apiKey.create({
          data: {
            operatorId: operator.id,
            keyHash: hashApiKey(rawApiKey),
            name: input.displayName || `fleet-${input.capability}`,
            role: "HOLDER",
          },
        });

        const agentRecord = await tx.agent.create({
          data: {
            operatorId: operator.id,
            agentId: passport.subjectCommitment,
            domain: input.capability,
          },
        });

        const created = await tx.agentInstance.create({
          data: {
            commitment: passport.subjectCommitment,
            operatorId: operator.id,
            agentRecordId: agentRecord.id,
            capability: input.capability.trim(),
            llmTier: input.llmTier,
            displayName: input.displayName || null,
            status: "provisioning",
          },
        });
        await tx.agentInstance.update({
          where: { id: created.id },
          data: { status: "active" },
        });
        return { created, rawApiKey };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    // No zombie identities: any failure after enrollment removes the partial
    // records — INCLUDING the ISSUED passport (this enrollment's keypair is
    // discarded; the key never persisted elsewhere).
    await prisma.agent.deleteMany({ where: { agentId: passport.subjectCommitment } });
    await prisma.agentEnrollment.deleteMany({
      where: { subjectCommitment: challengePassport.subjectCommitment },
    });
    if (createdOperatorId) {
      await prisma.apiKey.deleteMany({ where: { operatorId: createdOperatorId } });
      await prisma.operator.delete({ where: { id: createdOperatorId } }).catch(() => undefined);
    }
    throw err;
  }

  return {
    commitment: passport.subjectCommitment,
    instanceId: instance.created.id,
    operatorId: instance.created.operatorId,
    enrollment: { privateKeyHex, publicKeyHex },
    rawApiKey: instance.rawApiKey,
    tier: input.llmTier,
    resolvedModel: resolveTierModel(input.llmTier),
  };
}

/**
 * Stops an instance. Retention: identity rows are untouched; only the runtime
 * state flips to `stopped`. An optional agent-signed capsule payload is
 * verified + persisted here (the dispatch runtime generates and signs it).
 */
export async function stopFleetAgent(
  commitment: string,
  opts: {
    reason?: string;
    capsulePayload?: string;
    capsuleSignature?: string;
    capsulePublicKey?: string;
    ttlHours?: number;
  } = {}
): Promise<void> {
  const instance = await prisma.agentInstance.findUnique({ where: { commitment } });
  if (!instance) throw new Error("instance_not_found");
  if (instance.status === "stopped") {
    throw new Error("instance_already_stopped");
  }
  if (!canTransition(instance.status as InstanceStatus, "stopped")) {
    throw new Error(`illegal_transition:${instance.status}->stopped`);
  }

  let capsuleDigest: string | undefined;
  if (opts.capsulePayload && opts.capsuleSignature && opts.capsulePublicKey) {
    await saveResurrectionCapsule({
      agentCommitment: commitment,
      encryptedPayload: opts.capsulePayload,
      signature: opts.capsuleSignature,
      publicKey: opts.capsulePublicKey,
      ttlHours: opts.ttlHours,
    });
    // digest OF THE PAYLOAD (the same value the agent signed), not a row id —
    // downstream uses capsuleDigest to runtime-verify continuity.
    capsuleDigest = sha256Hex(opts.capsulePayload);
  }

  await prisma.agentInstance.update({
    where: { commitment },
    data: {
      status: "stopped",
      stoppedAt: new Date(),
      stopReason: (opts.reason || "fleet_stop").slice(0, 200),
      ...(capsuleDigest ? { capsuleDigest } : {}),
    },
  });
}

/**
 * Rehydrates a stopped/failed instance: same Passport, same commitment.
 * Upserts the runtime back to active and returns the latest capsule payload
 * (when one exists) so the new runtime restores its own state.
 *
 * `newTier` (optional) re-provisions the instance at a HIGHER tier only —
 * the upgrade-only invariant; a downgrade throws.
 */
export async function rehydrateFleetAgent(
  commitment: string,
  newTier?: LlmTier
): Promise<{
  capsule: Awaited<ReturnType<typeof getResurrectionCapsule>>;
  tier: LlmTier;
  resolvedModel: string;
  upgraded: boolean;
}> {
  const instance = await prisma.agentInstance.findUnique({ where: { commitment } });
  if (!instance) throw new Error("instance_not_found");
  await requireEnrolled(commitment); // Passport must still be ISSUED.

  if (!canTransition(instance.status as InstanceStatus, "provisioning")) {
    throw new Error(`illegal_transition:${instance.status}->provisioning`);
  }

  const currentTier = instance.llmTier as LlmTier;
  if (!isLlmTier(currentTier)) {
    throw new Error(`unknown_llm_tier:${String(currentTier)}`);
  }

  let finalTier = currentTier;
  if (newTier) {
    if (!isLlmTier(newTier)) {
      throw new Error(`unknown_llm_tier:${String(newTier)}`);
    }
    if (!tierNotDowngraded(currentTier, newTier)) {
      throw new Error(`tier_downgrade_rejected:${currentTier}->${newTier}`);
    }
    // Money governance closes the stop-then-rehydrate bypass: a tier UPGRADE
    // into money must satisfy the same switch as minting a money agent.
    // (Compared against currentTier — finalTier is assigned only after this.)
    if (newTier !== currentTier && newTier === "money" && !moneyMintEnabled()) {
      throw new Error("money_tier_mint_disabled");
    }
    finalTier = newTier;
  }

  const capsule = await getResurrectionCapsule(commitment);
  await prisma.agentInstance.update({
    where: { commitment },
    data: {
      status: "active",
      rehydratedAt: new Date(),
      stoppedAt: null,
      stopReason: null,
      ...(finalTier !== currentTier ? { llmTier: finalTier } : {}),
      ...(capsule?.payloadDigest ? { capsuleDigest: capsule.payloadDigest } : {}),
    },
  });

  return {
    capsule,
    tier: finalTier,
    resolvedModel: resolveTierModel(finalTier),
    upgraded: finalTier !== currentTier,
  };
}

export async function getFleetStatus() {
  const rows = await prisma.agentInstance.groupBy({
    by: ["status", "llmTier"],
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + row._count._all;
    byTier[row.llmTier] = (byTier[row.llmTier] || 0) + row._count._all;
  }
  return {
    byStatus,
    byTier,
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    cap: maxFleetAgents(),
    moneyMintEnabled: moneyMintEnabled(),
  };
}

/** Fleet roster — dispatch targets are ACTIVE instances filtered by capability. */
export async function listFleet(
  filter: {
    capability?: string;
    status?: InstanceStatus;
    limit?: number;
  } = {}
) {
  return prisma.agentInstance.findMany({
    where: {
      ...(filter.capability ? { capability: filter.capability } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 100, 500),
    select: {
      id: true,
      commitment: true,
      capability: true,
      llmTier: true,
      status: true,
      totalEarnedCents: true,
      totalSpentCents: true,
      rehydratedAt: true,
      stoppedAt: true,
      stopReason: true,
      createdAt: true,
    },
  });
}
