import { verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/operator";
import { sha256Hex } from "@/lib/receipt/canonical";

interface StoredChallenge {
  nonce: string;
  publicKeyHex: string;
  expiresAt: number;
  consumed: boolean;
}

const activeChallenges = new Map<string, StoredChallenge>();
const CHALLENGE_TTL_MS = 120_000; // 2 minutes
const DEFAULT_POW_DIFFICULTY = 3; // 3 leading hex zeroes (e.g. "000...")

function cleanupStaleChallenges() {
  const now = Date.now();
  for (const [nonce, item] of activeChallenges.entries()) {
    if (item.expiresAt < now || item.consumed) {
      activeChallenges.delete(nonce);
    }
  }
}

/**
 * Generates an ephemeral cryptographic challenge with a lightweight Proof-of-Work requirement.
 */
export function generateAutonomousChallenge(publicKeyHex: string): {
  challenge_nonce: string;
  pow_difficulty: number;
  expires_at: string;
} {
  cleanupStaleChallenges();

  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = bytesToHex(rawBytes);
  const now = Date.now();
  const expiresAt = now + CHALLENGE_TTL_MS;

  activeChallenges.set(nonce, {
    nonce,
    publicKeyHex: publicKeyHex.toLowerCase(),
    expiresAt,
    consumed: false,
  });

  return {
    challenge_nonce: nonce,
    pow_difficulty: DEFAULT_POW_DIFFICULTY,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

/**
 * Client-side solver helper for autonomous agents to compute PoW nonce.
 */
export function solveAutonomousPoW(challengeNonce: string, difficulty = DEFAULT_POW_DIFFICULTY): string {
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
  difficulty = DEFAULT_POW_DIFFICULTY
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

  // 1. Check Nonce
  const challenge = activeChallenges.get(challenge_nonce);
  if (!challenge || challenge.consumed || challenge.expiresAt < Date.now()) {
    throw new Error("Challenge nonce has expired or already been consumed");
  }

  // 2. Enforce Public Key Match
  if (challenge.publicKeyHex !== pubKeyClean) {
    throw new Error("Public key does not match the challenge initiation key");
  }

  // 3. Verify PoW
  if (!verifyAutonomousPoW(challenge_nonce, pow_nonce)) {
    throw new Error("Invalid Proof-of-Work computation");
  }

  // 4. Burn Nonce Immediately (Replay Attack Prevention)
  challenge.consumed = true;
  activeChallenges.delete(challenge_nonce);

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

  // 6. Compute Deterministic Subject Commitment Hash
  const salt = process.env.INGESTION_COMMITMENT_SALT || "passport-default-salt";
  const subjectCommitment = sha256Hex(pubKeyClean + salt);
  const agentName = display_name?.trim() || `Agent-${subjectCommitment.slice(0, 8)}`;
  const operationalDomain = domain || "CODE_GENERATION";

  // 7. Provision Autonomous Operator & Account
  const stripeCustomerId = `cus_auto_${subjectCommitment.slice(0, 24)}`;
  let operator = await prisma.operator.create({
    data: {
      stripeCustomerId,
      email: null,
      tier: "free",
      credits: 100,
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
    },
  });

  // 9. Register Agent & Enrollment
  const agentRecord = await prisma.agent.create({
    data: {
      operatorId: operator.id,
      agentId: agentName,
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
    did: `did:key:z${pubKeyClean}`,
    display_name: agentName,
    domain: operationalDomain,
    initial_credits: 100,
  };
}
