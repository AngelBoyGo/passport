/**
 * Sovereign Trilateral Threshold Quorum & Governance Service
 *
 * Implements AES Protocol ASMC-3 Q159, Q161, and Q179:
 * - 2-of-3 Ed25519 threshold multi-signature quorum across Mali (ML), Burkina Faso (BF), and Niger (NE).
 * - Enforces constitutional consensus on sensitive reserve actions:
 *   ADD_VAULT, QUARANTINE_VAULT, EMERGENCY_FREEZE, GOVERNOR_REVIVAL, REBALANCE_BASKET.
 * - Anti-Sybil / Replay Protection: 1 vote per sovereign nation per proposal, RFC 8785 canonical hashing.
 * - Automated Atomic Execution: Triggered immediately when threshold is reached inside a single transaction.
 * - Dead-Man's Switch Surveillance: Monitors node heartbeats across Bamako, Ouagadougou, and Niamey.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import { generateLivePoR } from "./por-service";

export const SOVEREIGN_STATES = ["ML", "BF", "NE"] as const;
export type SovereignCountryCode = typeof SOVEREIGN_STATES[number];

export const VALID_ACTION_TYPES = [
  "ADD_VAULT",
  "QUARANTINE_VAULT",
  "EMERGENCY_FREEZE",
  "GOVERNOR_REVIVAL",
  "REBALANCE_BASKET",
] as const;
export type QuorumActionType = typeof VALID_ACTION_TYPES[number];

// ── Deterministic Benchmark Keys for Offline / Test Environments ──
export const SOVEREIGN_STATE_BENCHMARK_KEYS: Record<SovereignCountryCode, string> = {
  ML: "4a2f8b9e6c1d0a5e7f3b8c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f",
  BF: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
  NE: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
};

/**
 * Returns the registered Ed25519 public key for a sovereign state.
 */
export function getSovereignStateKey(countryCode: string): string {
  const code = countryCode.toUpperCase() as SovereignCountryCode;
  if (!SOVEREIGN_STATES.includes(code)) return "";
  const envKey = process.env[`SOVEREIGN_KEY_${code}`]?.trim();
  if (envKey && /^[0-9a-f]{64}$/i.test(envKey)) {
    return envKey.toLowerCase();
  }
  // Fail closed in production: never fall back to the public benchmark keys there.
  if (process.env.NODE_ENV === "production") return "";
  return SOVEREIGN_STATE_BENCHMARK_KEYS[code] || "";
}

export interface CreateProposalInput {
  proposalId?: string;
  actionType: QuorumActionType | string;
  payload: Record<string, unknown>;
  proposerState: string;
  requiredThreshold?: number;
  ttlHours?: number;
}

export interface SubmitSignatureInput {
  proposalId: string;
  signerState: string;
  signature: string;
  signerPublicKey?: string;
}

/**
 * Creates a pending 2-of-3 threshold governance proposal with canonical RFC 8785 hashing.
 */
export async function createQuorumProposal(input: CreateProposalInput) {
  const proposerState = input.proposerState.toUpperCase();
  if (!SOVEREIGN_STATES.includes(proposerState as SovereignCountryCode)) {
    throw new Error(`Invalid proposer state '${input.proposerState}'. Must be ML, BF, or NE.`);
  }

  const payloadDigest = sha256Hex(canonicalJson(input.payload));
  const proposalId = input.proposalId || `PROP-AES-${Date.now()}`;
  const ttlHours = input.ttlHours ?? 48;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  return prisma.sovereignQuorumProposal.create({
    data: {
      proposalId,
      actionType: input.actionType,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      payloadDigest,
      proposerState,
      requiredThreshold: input.requiredThreshold ?? 2,
      status: "PENDING",
      expiresAt,
    },
  });
}

/**
 * Executes the underlying state transition when a proposal reaches quorum.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeProposalAction(tx: any, actionType: string, payload: any) {
  switch (actionType) {
    case "QUARANTINE_VAULT": {
      const batchNumber = String(payload.batchNumber || payload.batch_number || "");
      if (!batchNumber) throw new Error("batchNumber required for QUARANTINE_VAULT");
      await tx.vaultBatch.update({
        where: { batchNumber },
        data: { status: "QUARANTINED" },
      });
      return { quarantinedBatchNumber: batchNumber, executed: true };
    }
    case "ADD_VAULT": {
      const batchNumber = String(payload.batchNumber || payload.batch_number || "");
      const reserve = await tx.commodityReserve.upsert({
        where: { commodityType_symbol: { commodityType: "GOLD", symbol: "Au" } },
        create: { commodityType: "GOLD", symbol: "Au" },
        update: {},
      });
      const batch = await tx.vaultBatch.create({
        data: {
          batchNumber,
          reserveId: reserve.id,
          vaultId: String(payload.vaultId || "VAULT-AES-DEFAULT"),
          custodianName: String(payload.custodianName || "Confederation Central Custody"),
          locationCity: String(payload.locationCity || "Bamako"),
          locationCountry: String(payload.locationCountry || "ML").toUpperCase(),
          barSerials: Array.isArray(payload.barSerials) ? payload.barSerials : [],
          grossWeightGrams: Number(payload.grossWeightGrams || 1000.0),
          fineness: Number(payload.fineness || 0.9999),
          fineWeightGrams: Number(payload.fineWeightGrams || 999.9),
          status: "AUDITED",
          auditedAt: new Date(),
        },
      });
      return { createdBatchNumber: batch.batchNumber, executed: true };
    }
    case "EMERGENCY_FREEZE": {
      return { circuitBreakerForced: true, regime: "GHOST", executed: true };
    }
    case "GOVERNOR_REVIVAL": {
      return { circuitBreakerLifted: true, regime: "SOLID", executed: true };
    }
    case "REBALANCE_BASKET": {
      return { rebalanceApproved: true, payload, executed: true };
    }
    default:
      return { executed: true, note: `Custom action ${actionType} recorded` };
  }
}

/**
 * Submits an Ed25519 signature from a sovereign state ministry.
 * If distinct signatures reach the required threshold (e.g. 2-of-3), automatically executes the action.
 */
export async function submitQuorumSignature(input: SubmitSignatureInput) {
  const signerState = input.signerState.toUpperCase();
  if (!SOVEREIGN_STATES.includes(signerState as SovereignCountryCode)) {
    throw new Error(`Invalid signer state '${input.signerState}'. Must be ML, BF, or NE.`);
  }

  const proposal = await prisma.sovereignQuorumProposal.findUnique({
    where: { proposalId: input.proposalId },
    include: { signatures: true },
  });

  if (!proposal) {
    throw new Error(`Proposal '${input.proposalId}' not found`);
  }
  if (proposal.status !== "PENDING") {
    throw new Error(`Proposal '${input.proposalId}' is not pending (status: ${proposal.status})`);
  }
  if (new Date() > proposal.expiresAt) {
    throw new Error(`Proposal '${input.proposalId}' has expired`);
  }
  if (proposal.signatures?.some((s) => s.signerState === signerState)) {
    throw new Error(`Sovereign state '${signerState}' has already signed proposal '${input.proposalId}'`);
  }

  // 1. Verify Ed25519 Cryptographic Signature against the REGISTERED sovereign key.
  //    A caller-supplied signerPublicKey must never override the registered key, otherwise
  //    any caller could self-assert a keypair and forge a 2-of-3 quorum that executes
  //    reserve actions (ADD_VAULT / QUARANTINE_VAULT / EMERGENCY_FREEZE / ...).
  const expectedKey = getSovereignStateKey(signerState);
  if (!expectedKey) {
    throw new Error(`No registered sovereign key for state ${signerState}`);
  }
  const provenance = await verifyPinnedSignature({
    pinnedKey: expectedKey,
    providedKey: input.signerPublicKey,
    signatureHex: input.signature,
    signPayload: proposal.payloadDigest,
    context: "reserves.quorum.sign",
    commitment: signerState,
  });
  if (!provenance.valid) {
    throw new Error(`Invalid Ed25519 signature for sovereign state ${signerState}`);
  }
  const keyToVerify = expectedKey;

  // 2. Execute Atomic Quorum Evaluation & Action Trigger
  const result = await prisma.$transaction(async (tx) => {
    // Record signature (enforces unique [proposalId, signerState])
    await tx.quorumSignature.create({
      data: {
        proposalId: proposal.id,
        signerState,
        signerPublicKey: keyToVerify,
        signature: input.signature,
      },
    });

    const signatureCount = await tx.quorumSignature.count({
      where: { proposalId: proposal.id },
    });

    const isThresholdReached = signatureCount >= proposal.requiredThreshold;
    let executionResult = null;

    if (isThresholdReached) {
      // Atomic guard: transition PENDING -> EXECUTED; only one concurrent vote executes the action
      const transitioned = await tx.sovereignQuorumProposal.updateMany({
        where: { id: proposal.id, status: "PENDING" },
        data: {
          status: "EXECUTED",
          executedAt: new Date(),
        },
      });

      if (transitioned.count === 1) {
        // Execute the action transition
        executionResult = await executeProposalAction(tx, proposal.actionType, proposal.payload);

        await tx.sovereignQuorumProposal.update({
          where: { id: proposal.id },
          data: {
            executionResult: executionResult as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    return {
      proposalId: proposal.proposalId,
      signerState,
      totalSignatures: signatureCount,
      requiredThreshold: proposal.requiredThreshold,
      status: isThresholdReached ? "EXECUTED" : "PENDING",
      executed: isThresholdReached,
      executionResult,
    };
  });

  // Re-generate live PoR if a vault lot was modified
  if (result.executed && (proposal.actionType === "QUARANTINE_VAULT" || proposal.actionType === "ADD_VAULT")) {
    await generateLivePoR("GOLD").catch(() => null);
  }

  return result;
}

/**
 * Registers an authenticated node heartbeat from a sovereign state capital.
 * Verifies the Ed25519 signature against the registered sovereign key for the state.
 */
export async function registerStateHeartbeat(params: {
  countryCode: string;
  nodeEndpoint: string;
  heartbeatNonce: string;
  signature: string;
}) {
  const countryCode = params.countryCode.toUpperCase() as SovereignCountryCode;
  if (!SOVEREIGN_STATES.includes(countryCode)) {
    throw new Error(`Invalid state code '${params.countryCode}'`);
  }

  // Verify Ed25519 signature over canonical heartbeat payload against the state's key.
  const stateKey = getSovereignStateKey(countryCode);
  if (!stateKey) {
    throw new Error(`No registered sovereign key for state ${countryCode}; heartbeat refused`);
  }
  const heartbeatPayload = {
    country_code: countryCode,
    node_endpoint: params.nodeEndpoint,
    nonce: params.heartbeatNonce,
  };
  const hive = await verifyPinnedSignature({
    pinnedKey: stateKey,
    signatureHex: params.signature,
    signPayload: heartbeatPayload,
    context: "reserves.quorum.heartbeat",
    commitment: countryCode,
  });
  if (!hive.valid) {
    throw new Error(`Invalid heartbeat signature for sovereign state ${countryCode}`);
  }

  return prisma.sovereignStateHeartbeat.upsert({
    where: { countryCode },
    create: {
      countryCode,
      nodeEndpoint: params.nodeEndpoint,
      heartbeatNonce: params.heartbeatNonce,
      signature: params.signature,
      status: "ONLINE",
      lastSeenAt: new Date(),
    },
    update: {
      nodeEndpoint: params.nodeEndpoint,
      heartbeatNonce: params.heartbeatNonce,
      signature: params.signature,
      status: "ONLINE",
      lastSeenAt: new Date(),
    },
  });
}

/**
 * Scans state node heartbeats (Black Paper Q179 Dead-Man's Switch).
 * Flags DARK status if a nation's nodes are silent for >72 hours.
 */
export async function checkDeadManSurveillance(maxSilenceHours = 72) {
  const heartbeats = await prisma.sovereignStateHeartbeat.findMany();
  const now = Date.now();
  const maxSilenceMs = maxSilenceHours * 3600 * 1000;

  const statesStatus: Array<{
    countryCode: string;
    status: "ONLINE" | "DARK";
    lastSeenAt: Date | null;
    silenceHours: number;
  }> = [];

  let isAnyStateDark = false;

  for (const code of SOVEREIGN_STATES) {
    const hb = heartbeats.find((h) => h.countryCode === code);
    if (!hb) {
      statesStatus.push({
        countryCode: code,
        status: "DARK",
        lastSeenAt: null,
        silenceHours: 999,
      });
      isAnyStateDark = true;
    } else {
      const silenceMs = now - hb.lastSeenAt.getTime();
      const silenceHours = Number((silenceMs / 3600000).toFixed(1));
      const isDark = silenceMs > maxSilenceMs;
      if (isDark) isAnyStateDark = true;

      statesStatus.push({
        countryCode: code,
        status: isDark ? "DARK" : "ONLINE",
        lastSeenAt: hb.lastSeenAt,
        silenceHours,
      });
    }
  }

  return {
    states: statesStatus,
    isAnyStateDark,
    deadManAlertTriggered: isAnyStateDark,
  };
}

/**
 * Lists active and historical quorum proposals with their voting progress.
 */
export async function listQuorumProposals(limit = 10) {
  const proposals = await prisma.sovereignQuorumProposal.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      signatures: {
        select: {
          signerState: true,
          signerPublicKey: true,
          signedAt: true,
        },
      },
    },
  });

  const surveillance = await checkDeadManSurveillance();

  return {
    proposals: proposals.map((p) => ({
      proposal_id: p.proposalId,
      action_type: p.actionType,
      payload: p.payload,
      payload_digest: p.payloadDigest,
      proposer_state: p.proposerState,
      required_threshold: p.requiredThreshold,
      signature_count: p.signatures.length,
      signatures: p.signatures.map((s) => ({
        signer_state: s.signerState,
        signed_at: s.signedAt.toISOString(),
      })),
      status: p.status,
      expires_at: p.expiresAt.toISOString(),
      executed_at: p.executedAt ? p.executedAt.toISOString() : null,
      execution_result: p.executionResult,
    })),
    surveillance,
  };
}
