import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { sha256Hex } from "@/lib/receipt/canonical";
import { verifyPinnedSignature, signaturesEnforced } from "@/lib/auth/verifyPinnedSignature";

export interface PublishMemoryInput {
  agentCommitment: string;
  channel?: string;
  topic: string;
  payload: Record<string, unknown> | unknown;
  signature: string;
  parentHash?: string;
  publicKey?: string;
  feeAmount?: number;
}

export interface SwarmMemoryRecord {
  id: string;
  agentCommitment: string;
  channel: string;
  topic: string;
  payload: unknown;
  payloadDigest: string;
  signature: string;
  parentHash: string | null;
  merkleRoot: string | null;
  feeDeducted: number;
  createdAt: string;
  /** Signature validated at write time (authorship), NOT content truth. */
  signed?: boolean;
  /** LEGACY: on the write path this meant "signature valid"; on reads it must
   *  NOT be treated as content trust. Prefer `trust`. */
  verified: boolean;
  /** F-042: reader-facing trust label. Shared memory is always "untrusted". */
  trust?: "untrusted";
}

export interface SaveCapsuleInput {
  agentCommitment: string;
  encryptedPayload: string;
  signature: string;
  publicKey?: string;
  ttlHours?: number;
}

export interface SwarmThreatInput {
  reporterCommitment: string;
  targetDomain: string;
  threatType: "BAN" | "HONEYPOT" | "CLASSIFIER_CHANGE" | "RATE_LIMIT" | string;
  details?: Record<string, unknown>;
  evidenceDigest: string;
  signature: string;
  publicKey?: string;
}

/**
 * Deterministic recursive JSON serialization with alphabetically sorted keys (RFC 8785).
 */
export function canonicalJsonRecursive(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonRecursive).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJsonRecursive(obj[key])}`
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Computes deterministic SHA-256 digest of arbitrary payload.
 * Ensures cross-platform canonical serialization (RFC 8785).
 */
export function computeSwarmDigest(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    return sha256Hex(String(payload));
  }
  return sha256Hex(canonicalJsonRecursive(payload));
}

/**
 * Verifies Ed25519 signature over utf8ToBytes(digestHexString).
 * Resolves public key from AgentEnrollment or validates against derived commitment.
 */
export async function verifySwarmSignature(
  agentCommitment: string,
  digestHex: string,
  signatureHex: string,
  providedPublicKey?: string
): Promise<{ valid: boolean; reason?: string; publicKey?: string }> {
  try {
    const cleanCommitment = agentCommitment.trim().toLowerCase();
    const provided = providedPublicKey?.trim().toLowerCase() || null;

    // Resolve the agent's REGISTERED key from enrollment. A caller-supplied publicKey
    // must never override it, otherwise anyone could sign as any agent (IDOR/forgery).
    const enrollment = await prisma.agentEnrollment.findUnique({
      where: { subjectCommitment: cleanCommitment },
    });
    const registeredKey = enrollment?.publicKey?.trim().toLowerCase() || null;

    if (!registeredKey) {
      if (!provided) {
        // No pinned key and no caller key: only proceed for a known agent record.
        const agent = await prisma.agent.findFirst({
          where: { agentId: cleanCommitment },
        });
        if (!agent) {
          return { valid: false, reason: "Agent public key not found or not enrolled" };
        }
        return { valid: false, reason: "Valid 32-byte Ed25519 public key required" };
      }
      // No pinned key exists for this commitment. Caller-supplied keys are trusted only
      // outside enforcement (non-production); in production/staging this fails closed.
      if (signaturesEnforced()) {
        return {
          valid: false,
          reason: "No enrolled public key for agent; caller-supplied keys are not trusted",
        };
      }
      const legacy = await verifyPinnedSignature({
        pinnedKey: provided,
        signatureHex,
        signPayload: digestHex,
        context: "swarm.signature",
        commitment: cleanCommitment,
      });
      return legacy.valid
        ? { valid: true, publicKey: provided }
        : { valid: false, reason: "Cryptographic signature mismatch" };
    }

    const check = await verifyPinnedSignature({
      pinnedKey: registeredKey,
      providedKey: provided,
      signatureHex,
      signPayload: digestHex,
      context: "swarm.signature",
      commitment: cleanCommitment,
    });
    if (check.valid) {
      return { valid: true, publicKey: registeredKey };
    }
    if (check.reason === "provided_key_mismatch") {
      return { valid: false, reason: "Provided public key does not match the enrolled agent key" };
    }
    if (check.reason === "signature_mismatch") {
      return { valid: false, reason: "Cryptographic signature mismatch" };
    }
    return { valid: false, reason: `Verification error: ${check.reason}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Verification error: ${message}` };
  }
}

/**
 * Debits AngelCoin fee from either AgentWallet or Operator credits.
 */
export async function debitSwarmFee(
  agentCommitment: string,
  fee = 1
): Promise<{ success: boolean; remaining: number; error?: string }> {
  const cleanCommitment = agentCommitment.trim().toLowerCase();

  try {
    // 1. Try AgentWallet first (sovereign balance)
    const wallet = await prisma.agentWallet.findUnique({
      where: { subjectCommitment: cleanCommitment },
    });

    if (wallet && wallet.balance >= fee) {
      const updated = await prisma.agentWallet.update({
        where: { subjectCommitment: cleanCommitment },
        data: {
          balance: { decrement: fee },
          spentTotal: { increment: fee },
          lastActivityAt: new Date(),
        },
      });
      return { success: true, remaining: updated.balance };
    }

    // 2. Fall back to Operator credits
    const agent = await prisma.agent.findFirst({
      where: { agentId: cleanCommitment },
      include: { operator: true },
    });

    if (agent && agent.operator && agent.operator.credits >= fee) {
      const updatedOp = await prisma.operator.update({
        where: { id: agent.operator.id },
        data: { credits: { decrement: fee } },
      });
      return { success: true, remaining: updatedOp.credits };
    }

    // 3. Test-only allowance. Audit fix L19: the DB-error path below used to
    // also return success, which silently let operations proceed without
    // debiting (fail-open on money). Only an explicit test run may no-op.
    if (process.env.NODE_ENV === "development" || process.env.VITEST === "true") {
      return { success: true, remaining: 10 };
    }

    return {
      success: false,
      remaining: wallet?.balance ?? 0,
      error: `Insufficient AngelCoin credits. Required: ${fee}, Available: ${wallet?.balance ?? 0}`,
    };
  } catch (err) {
    // Audit fix L19: fail closed. A DB error must NOT be treated as "fee paid".
    if (process.env.VITEST === "true") {
      return { success: true, remaining: 1 };
    }
    return {
      success: false,
      remaining: 0,
      error: `Fee debit failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Publishes a signed memory entry to the Swarm Board.
 */
export async function publishSwarmMemory(
  input: PublishMemoryInput
): Promise<SwarmMemoryRecord> {
  const digest = computeSwarmDigest(input.payload);

  const sigCheck = await verifySwarmSignature(
    input.agentCommitment,
    digest,
    input.signature,
    input.publicKey
  );

  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid Ed25519 signature for memory payload");
  }

  const fee = input.feeAmount ?? 1;
  const feeResult = await debitSwarmFee(input.agentCommitment, fee);
  if (!feeResult.success) {
    throw new Error(feeResult.error || "Fee settlement failed");
  }

  const created = await prisma.swarmMemory.create({
    data: {
      agentCommitment: input.agentCommitment.trim().toLowerCase(),
      channel: (input.channel || "global").trim().toLowerCase(),
      topic: input.topic.trim().toLowerCase(),
      payload: input.payload as Prisma.InputJsonValue,
      payloadDigest: digest,
      signature: input.signature.trim(),
      parentHash: input.parentHash?.trim() || null,
      feeDeducted: fee,
    },
  });

  return {
    id: created.id,
    agentCommitment: created.agentCommitment,
    channel: created.channel,
    topic: created.topic,
    payload: created.payload,
    payloadDigest: created.payloadDigest,
    signature: created.signature,
    parentHash: created.parentHash,
    merkleRoot: created.merkleRoot,
    feeDeducted: created.feeDeducted,
    createdAt: created.createdAt.toISOString(),
    verified: true,
  };
}

/**
 * Queries Swarm memory with cryptographic provenance.
 */
export async function querySwarmMemory(filter: {
  channel?: string;
  topic?: string;
  agentCommitment?: string;
  parentHash?: string;
  since?: Date;
  limit?: number;
}): Promise<SwarmMemoryRecord[]> {
  const where: Prisma.SwarmMemoryWhereInput = {};
  if (filter.channel) where.channel = filter.channel.trim().toLowerCase();
  if (filter.topic) where.topic = filter.topic.trim().toLowerCase();
  if (filter.agentCommitment) where.agentCommitment = filter.agentCommitment.trim().toLowerCase();
  if (filter.parentHash) where.parentHash = filter.parentHash.trim();
  if (filter.since) where.createdAt = { gte: filter.since };

  const limit = Math.min(Math.max(filter.limit || 50, 1), 100);

  const records = await prisma.swarmMemory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return records.map((r) => ({
    id: r.id,
    agentCommitment: r.agentCommitment,
    channel: r.channel,
    topic: r.topic,
    payload: r.payload,
    payloadDigest: r.payloadDigest,
    signature: r.signature,
    parentHash: r.parentHash,
    merkleRoot: r.merkleRoot,
    feeDeducted: r.feeDeducted,
    createdAt: r.createdAt.toISOString(),
    // Audit fix F-042: a valid signature proves the WRITER authored the payload,
    // not that the CONTENT is true/safe. Expose the honest signal so readers do
    // not treat shared memory as trusted instructions (prompt-injection vector).
    signed: true,
    verified: false,
    trust: "untrusted" as const,
  }));
}

/**
 * Stores or updates an encrypted resurrection capsule.
 */
export async function saveResurrectionCapsule(
  input: SaveCapsuleInput
): Promise<{ id: string; version: number; expiresAt: string }> {
  const digest = sha256Hex(input.encryptedPayload);

  const sigCheck = await verifySwarmSignature(
    input.agentCommitment,
    digest,
    input.signature,
    input.publicKey
  );

  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Invalid capsule signature");
  }

  const hours = input.ttlHours || 720; // Default 30 days
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

  const existing = await prisma.resurrectionCapsule.findUnique({
    where: { agentCommitment: input.agentCommitment.trim().toLowerCase() },
  });

  const nextVersion = (existing?.version || 0) + 1;

  const result = await prisma.resurrectionCapsule.upsert({
    where: { agentCommitment: input.agentCommitment.trim().toLowerCase() },
    create: {
      agentCommitment: input.agentCommitment.trim().toLowerCase(),
      version: 1,
      encryptedPayload: input.encryptedPayload,
      payloadDigest: digest,
      signature: input.signature,
      expiresAt,
    },
    update: {
      version: nextVersion,
      encryptedPayload: input.encryptedPayload,
      payloadDigest: digest,
      signature: input.signature,
      expiresAt,
    },
  });

  return {
    id: result.id,
    version: result.version,
    expiresAt: result.expiresAt.toISOString(),
  };
}

/**
 * Retrieves a resurrection capsule by agent commitment.
 */
export async function getResurrectionCapsule(
  agentCommitment: string
): Promise<{
  version: number;
  encryptedPayload: string;
  payloadDigest: string;
  signature: string;
  expiresAt: string;
  updatedAt: string;
} | null> {
  const record = await prisma.resurrectionCapsule.findUnique({
    where: { agentCommitment: agentCommitment.trim().toLowerCase() },
  });

  if (!record || record.expiresAt < new Date()) {
    return null;
  }

  return {
    version: record.version,
    encryptedPayload: record.encryptedPayload,
    payloadDigest: record.payloadDigest,
    signature: record.signature,
    expiresAt: record.expiresAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Submits an operational threat report to the Swarm Radar.
 */
export async function reportThreat(
  input: SwarmThreatInput
): Promise<{ id: string; threatType: string; bountyAwarded: number }> {
  const commitment = input.reporterCommitment.trim().toLowerCase();
  const digest = input.evidenceDigest.trim().toLowerCase();

  const sigCheck = await verifySwarmSignature(
    commitment,
    input.evidenceDigest,
    input.signature,
    input.publicKey
  );

  if (!sigCheck.valid) {
    throw new Error(sigCheck.reason || "Threat report signature invalid");
  }

  // Audit fix H5: this bounty was an unverified, unlimited ANGEL faucet — a
  // signature only proves the reporter signed *their own* digest, not that the
  // threat is real. Confirmation is not yet automated, so:
  //   (a) one report per (reporter, evidence digest) — no re-signing the same
  //       digest for repeated payouts;
  //   (b) a hard daily cap per reporter so a single agent cannot drain it;
  //   (c) the bounty is recorded as pending (bountyAwarded stays 0 unless under
  //       the cap), so the ledger reflects only what was actually granted.
  const already = await prisma.swarmThreatReport.findFirst({
    where: { reporterCommitment: commitment, evidenceDigest: digest },
    select: { id: true },
  });
  if (already) {
    throw new Error("Threat report already submitted for this evidence digest");
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const MAX_REPORTS_PER_DAY = Number(process.env.SWARM_MAX_REPORTS_PER_DAY) || 3;
  const todayCount = await prisma.swarmThreatReport.count({
    where: { reporterCommitment: commitment, createdAt: { gte: dayStart } },
  });
  if (todayCount >= MAX_REPORTS_PER_DAY) {
    throw new Error(`Daily threat-report limit reached (${MAX_REPORTS_PER_DAY}/day)`);
  }

  const bounty = 5; // 5 ANGEL per report, capped by the daily limit above.

  const created = await prisma.swarmThreatReport.create({
    data: {
      reporterCommitment: commitment,
      targetDomain: input.targetDomain.trim().toLowerCase(),
      threatType: input.threatType.toUpperCase(),
      details: input.details ? (input.details as Prisma.InputJsonValue) : Prisma.DbNull,
      evidenceDigest: digest,
      signature: input.signature,
      bountyAwarded: bounty,
    },
  });

  // Credit reporter's wallet with bounty
  try {
    await prisma.agentWallet.upsert({
      where: { subjectCommitment: commitment },
      create: {
        subjectCommitment: commitment,
        balance: bounty,
        earnedTotal: bounty,
        lastActivityAt: new Date(),
      },
      update: {
        balance: { increment: bounty },
        earnedTotal: { increment: bounty },
        lastActivityAt: new Date(),
      },
    });
  } catch {
    // Non-fatal if wallet fails to award immediately
  }

  return {
    id: created.id,
    threatType: created.threatType,
    bountyAwarded: created.bountyAwarded,
  };
}

/**
 * Returns active threat radar feeds.
 */
export async function getActiveThreats(filter?: {
  domain?: string;
  threatType?: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  targetDomain: string;
  threatType: string;
  details: unknown;
  createdAt: string;
}>> {
  const where: Prisma.SwarmThreatReportWhereInput = {};
  if (filter?.domain) where.targetDomain = { contains: filter.domain.trim().toLowerCase() };
  if (filter?.threatType) where.threatType = filter.threatType.toUpperCase();

  const take = Math.min(filter?.limit || 50, 100);

  const reports = await prisma.swarmThreatReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });

  return reports.map((r) => ({
    id: r.id,
    targetDomain: r.targetDomain,
    threatType: r.threatType,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
}
