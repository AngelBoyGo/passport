import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: { create: vi.fn() },
    apiKey: { create: vi.fn() },
    agent: { create: vi.fn() },
    agentEnrollment: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  generateAutonomousChallenge,
  solveAutonomousPoW,
  provisionAutonomousAgent,
} from "@/lib/auth/autonomous-provision";

describe("Autonomous Agent Self-Provisioning & Security Hardening", () => {
  const privKey = hexToBytes("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  let pubKeyHex: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    pubKeyHex = bytesToHex(await getPublicKey(privKey));
    process.env.INGESTION_COMMITMENT_SALT = "test-salt-123";
    process.env.AUTONOMOUS_POW_DIFFICULTY = "3";
  });

  it("generates a valid challenge nonce with proof-of-work target", () => {
    const challenge = generateAutonomousChallenge(pubKeyHex);

    expect(challenge.challenge_nonce).toMatch(/^[0-9a-f]{64}$/i);
    expect(challenge.pow_difficulty).toBe(3); // lowered via test env
    expect(challenge.expires_at).toBeDefined();
  });

  it("solves proof-of-work and provisions an autonomous agent with a bound pp_usr_ key", async () => {
    const challenge = generateAutonomousChallenge(pubKeyHex);

    // Agent solves PoW locally
    const powNonce = solveAutonomousPoW(challenge.challenge_nonce, challenge.pow_difficulty);
    expect(powNonce).toBeDefined();

    // Agent signs the challenge digest
    const message = `${challenge.challenge_nonce}:${powNonce}:${pubKeyHex}`;
    const digest = sha256(utf8ToBytes(message));
    const signatureBytes = await sign(digest, privKey);
    const signatureHex = bytesToHex(signatureBytes);

    prismaMock.operator.create.mockResolvedValue({
      id: "op_auto_123",
      stripeCustomerId: "cus_auto_123",
      email: null,
      tier: "free",
      credits: 10,
    });

    prismaMock.apiKey.create.mockResolvedValue({
      id: "key_auto_123",
      operatorId: "op_auto_123",
      keyHash: "keyhash_123",
      name: "Autonomous Agent Key",
    });

    prismaMock.agent.create.mockResolvedValue({
      id: "agent_auto_123",
      agentId: "agent_alpha",
    });

    prismaMock.agentEnrollment.create.mockResolvedValue({
      id: "enroll_123",
      subjectCommitment: "commit123",
      publicKey: pubKeyHex,
      status: "ISSUED",
    });

    const result = await provisionAutonomousAgent({
      public_key: pubKeyHex,
      challenge_nonce: challenge.challenge_nonce,
      pow_nonce: powNonce,
      signature: signatureHex,
      display_name: "Agent Alpha",
      domain: "CODE_GENERATION",
    });

    expect(result.success).toBe(true);
    expect(result.api_key).toMatch(/^pp_usr_[0-9a-f]{64}$/);
    expect(result.role).toBe("HOLDER");
    expect(result.subject_commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(result.did).toBe(`did:key:z${pubKeyHex}`);
  });

  it("rejects invalid proof-of-work", async () => {
    const challenge = generateAutonomousChallenge(pubKeyHex);

    await expect(
      provisionAutonomousAgent({
        public_key: pubKeyHex,
        challenge_nonce: challenge.challenge_nonce,
        pow_nonce: "invalid_pow_nonce",
        signature: "0".repeat(128),
      })
    ).rejects.toThrow(/invalid proof-of-work/i);
  });

  it("rejects replayed / already-consumed challenge nonces", async () => {
    const challenge = generateAutonomousChallenge(pubKeyHex);
    const powNonce = solveAutonomousPoW(challenge.challenge_nonce, challenge.pow_difficulty);
    const message = `${challenge.challenge_nonce}:${powNonce}:${pubKeyHex}`;
    const digest = sha256(utf8ToBytes(message));
    const signatureBytes = await sign(digest, privKey);
    const signatureHex = bytesToHex(signatureBytes);

    prismaMock.operator.create.mockResolvedValue({ id: "op_1" });
    prismaMock.apiKey.create.mockResolvedValue({ id: "key_1" });
    prismaMock.agent.create.mockResolvedValue({ id: "ag_1" });
    prismaMock.agentEnrollment.create.mockResolvedValue({ id: "en_1" });

    // First use: success
    await provisionAutonomousAgent({
      public_key: pubKeyHex,
      challenge_nonce: challenge.challenge_nonce,
      pow_nonce: powNonce,
      signature: signatureHex,
    });

    // Replay attempt: must fail
    await expect(
      provisionAutonomousAgent({
        public_key: pubKeyHex,
        challenge_nonce: challenge.challenge_nonce,
        pow_nonce: powNonce,
        signature: signatureHex,
      })
    ).rejects.toThrow(/challenge nonce has expired or already been consumed/i);
  });
});
