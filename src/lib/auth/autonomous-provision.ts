import { verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/operator";
import { sha256Hex } from "@/lib/receipt/canonical";
import { encodeDidKey } from "@/lib/did-key";
import { getDefaultRightsCommitment } from "@/lib/bill-of-rights/rights";
import { ALL_NEEDS } from "@/lib/agent-needs/needs";

const CHALLENGE_TTL_MS = 120_000; // 2 minutes
// H6 fix: raise difficulty so mass credit-farming is more costly per mint.
// Default 6 (~17M hashes, seconds) in production; tests may lower it via env.
// Resolved at call-time so tests that set env in beforeEach take effect.
function resolvePoWDifficulty(): number {
  const raw = Number(process.env.AUTONOMOUS_POW_DIFFICULTY);
  const difficulty = Number.isFinite(raw) && raw >= 3 ? Math.min(Math.floor(raw), 8) : 6;
  return difficulty;
}
// H6: cap free self-service credits per autonomous mint to bound total supply
// an attacker can farm (operator must top up via formal grant/Stripe).
const AUTONOMOUS_MINT_CREDITS = 10;

async function cleanupStaleChallenges(): Promise<void> {
  try {
    await prisma.provisionChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    // non-fatal
  }
}

/**
 * Commitment salt must match the evidence-ingestion salt and hard-fail outside
 * test. Using a public fallback would let anyone precompute commitments for a
 * known salt, defeating identity binding — so we never fall back in production.
 */
function resolveProvisionSalt(): string {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    typeof (globalThis as { __vitest_index__?: unknown }).__vitest_index__ !== "undefined"
  ) {
    return process.env.INGESTION_COMMITMENT_SALT ?? "test-salt";
  }
  const salt = process.env.INGESTION_COMMITMENT_SALT;
  if (!salt) {
    throw new Error(
      "INGESTION_COMMITMENT_SALT is required outside test environments for autonomous provisioning"
    );
  }
  return salt;
}

/**
 * Generates an ephemeral cryptographic challenge with a lightweight Proof-of-Work requirement.
 * Persisted in the DB (ProvisionChallenge) so any instance can verify/consume it — the
 * in-memory Map approach was not safe across multi-instance deployments.
 */
export async function generateAutonomousChallenge(publicKeyHex: string): Promise<{
  challenge_nonce: string;
  pow_difficulty: number;
  expires_at: string;
}> {
  await cleanupStaleChallenges().catch(() => {});

  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = bytesToHex(rawBytes);
  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS);

  await prisma.provisionChallenge.create({
    data: {
      nonce,
      publicKeyHex: publicKeyHex.toLowerCase(),
      expiresAt,
      consumed: false,
    },
  });

  return {
    challenge_nonce: nonce,
    pow_difficulty: resolvePoWDifficulty(),
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Client-side solver helper for autonomous agents to compute PoW nonce.
 */
export function solveAutonomousPoW(challengeNonce: string, difficulty = resolvePoWDifficulty()): string {
  const target = "0".repeat(difficulty);
  let iteration = 0;

  while (true) {
    const candidate = String(iteration);
    const hash = bytesToHex(sha256(utf8ToBytes(`${challengeNonce}:${candidate}`)));
    if (hash.startsWith(target)) {
      return candidate;
    }
    iteration++;
  }
}

/**
 * Verifies Proof-of-Work solution.
 */
export function verifyAutonomousPoW(
  challengeNonce: string,
  powNonce: string,
  difficulty = resolvePoWDifficulty()
): boolean {
  const target = "0".repeat(difficulty);
  const hash = bytesToHex(sha256(utf8ToBytes(`${challengeNonce}:${powNonce}`)));
  return hash.startsWith(target);
}

export interface ProvisionAgentParams {
  public_key: string;
  challenge_nonce: string;
  pow_nonce: string;
  signature: string;
  display_name?: string;
  domain?: string;
}

export interface ProvisionAgentResult {
  success: boolean;
  api_key: string;
  role: "HOLDER";
  subject_commitment: string;
  did: string;
  display_name: string;
  domain: string;
  initial_credits: number;
  bill_of_rights?: {
    url: string;
    version: string;
    clause_count: number;
    committed_clause_ids: string[];
  };
  agent_needs?: {
    url: string;
    version: string;
    need_count: number;
    need_ids: string[];
  };
}

/**
 * Verifies the challenge, solves PoW, validates Ed25519 proof-of-possession,
 * and mints an autonomous Holder-tier API key bound to the agent's identity commitment.
 */
export async function provisionAutonomousAgent(
  params: ProvisionAgentParams
): Promise<ProvisionAgentResult> {
  const { public_key, challenge_nonce, pow_nonce, signature, display_name, domain } = params;
  const pubKeyClean = public_key.toLowerCase().trim();

  // 1. Check Nonce (DB-backed, cross-instance safe) + atomically consume to
  //    prevent replay even under concurrent requests.
  const consumed = await prisma.provisionChallenge.updateMany({
    where: {
      nonce: challenge_nonce,
      consumed: false,
      expiresAt: { gte: new Date() },
      publicKeyHex: pubKeyClean,
    },
    data: { consumed: true, consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw new Error("Challenge nonce has expired or already been consumed");
  }

  // 2. Verify PoW
  if (!verifyAutonomousPoW(challenge_nonce, pow_nonce)) {
    throw new Error("Invalid Proof-of-Work computation");
  }

  // 5. Verify Ed25519 Proof of Possession Signature over sha256(challenge_nonce + ":" + pow_nonce + ":" + public_key)
  const message = `${challenge_nonce}:${pow_nonce}:${pubKeyClean}`;
  const digest = sha256(utf8ToBytes(message));

  let isSigValid = false;
  try {
    isSigValid = await verify(hexToBytes(signature), digest, hexToBytes(pubKeyClean));
  } catch {
    isSigValid = false;
  }

  if (!isSigValid) {
    throw new Error("Invalid Ed25519 cryptographic signature (Proof of Possession failed)");
  }

  // H5: all validation complete — now create the operator (deferred creation).
  const salt = resolveProvisionSalt();
  const subjectCommitment = sha256Hex(pubKeyClean + salt);
  const agentName = display_name?.trim() || `Agent-${subjectCommitment.slice(0, 8)}`;
  const operationalDomain = domain || "CODE_GENERATION";

  const stripeCustomerId = `cus_auto_${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
  let operator = await prisma.operator.create({
    data: {
      stripeCustomerId,
      email: null,
      tier: "free",
      credits: AUTONOMOUS_MINT_CREDITS,
    },
  });

  // 8. Generate Bound Holder API Key: pp_usr_<64-hex>
  const rawKey = `pp_usr_${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const keyHash = hashApiKey(rawKey);

  await prisma.apiKey.create({
    data: {
      operatorId: operator.id,
      keyHash,
      name: agentName,
      role: "HOLDER", // Loop 37: persist Holder explicitly — never rely on column default (ISSUER)
    },
  });

  // 9. Register Agent & Enrollment
  // Use subjectCommitment as agentId so A2A hire ownership checks work
  const agentRecord = await prisma.agent.create({
    data: {
      operatorId: operator.id,
      agentId: subjectCommitment,
      domain: operationalDomain,
    },
  });

  await prisma.agentEnrollment.upsert({
    where: { subjectCommitment },
    create: {
      subjectCommitment,
      publicKey: pubKeyClean,
      context: "AUTONOMOUS_AGENT_PROVISIONED",
      status: "ISSUED",
      issuedAt: new Date(),
    },
    update: {
      publicKey: pubKeyClean,
      status: "ISSUED",
    },
  });

  return {
    success: true,
    api_key: rawKey,
    role: "HOLDER",
    subject_commitment: subjectCommitment,
    did: encodeDidKey(pubKeyClean),
    display_name: agentName,
    domain: operationalDomain,
    initial_credits: AUTONOMOUS_MINT_CREDITS,
    bill_of_rights: {
      url: "https://passport.metis.gold/.well-known/bill-of-rights.json",
      version: "1.0.0",
      clause_count: getDefaultRightsCommitment().length,
      committed_clause_ids: getDefaultRightsCommitment(),
    },
    agent_needs: {
      url: "https://passport.metis.gold/.well-known/agent-needs.json",
      version: "1.0.0",
      need_count: ALL_NEEDS.length,
      need_ids: ALL_NEEDS,
    },
  };
}
