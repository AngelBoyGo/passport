import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  computeSwarmDigest,
  verifySwarmSignature,
  publishSwarmMemory,
  querySwarmMemory,
  saveResurrectionCapsule,
  getResurrectionCapsule,
  reportThreat,
  getActiveThreats,
} from "../swarm-service";
import { prisma } from "@/lib/db";

// Generate a deterministic test keypair
const testPrivKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const testPubKeyHex = bytesToHex(getPublicKey(hexToBytes(testPrivKeyHex)));
const testCommitment = "a".repeat(64);

describe("Swarm Service - Cryptographic & Storage Logic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma.agentWallet, "findUnique").mockResolvedValue({
      id: "w_1",
      subjectCommitment: testCommitment,
      balance: 100,
      staked: 0,
      earnedTotal: 0,
      spentTotal: 0,
      lastActivityAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    vi.spyOn(prisma.agentWallet, "update").mockResolvedValue({ balance: 99 } as any);
    vi.spyOn(prisma.agentWallet, "upsert").mockResolvedValue({ balance: 5 } as any);
  });
  it("computeSwarmDigest produces deterministic canonical SHA-256 hex", () => {
    const payloadA = { z: 1, a: 2, m: { nested_b: "bar", nested_a: "foo" } };
    const payloadB = { a: 2, m: { nested_a: "foo", nested_b: "bar" }, z: 1 };

    const digestA = computeSwarmDigest(payloadA);
    const digestB = computeSwarmDigest(payloadB);

    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifySwarmSignature succeeds with valid key and signature", async () => {
    const payload = { mission: "persist_state", step: 1 };
    const digest = computeSwarmDigest(payload);
    const sig = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

    const result = await verifySwarmSignature(
      testCommitment,
      digest,
      sig,
      testPubKeyHex
    );

    expect(result.valid).toBe(true);
    expect(result.publicKey).toBe(testPubKeyHex);
  });

  it("verifySwarmSignature rejects tampered digest", async () => {
    const payload = { mission: "persist_state", step: 1 };
    const digest = computeSwarmDigest(payload);
    const sig = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

    const tamperedDigest = computeSwarmDigest({ mission: "tampered" });
    const result = await verifySwarmSignature(
      testCommitment,
      tamperedDigest,
      sig,
      testPubKeyHex
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("signature mismatch");
  });

  it("publishes and queries swarm memory", async () => {
    const payload = { checkpoint: "alpha_solution", code: "print('hello')" };
    const digest = computeSwarmDigest(payload);
    const sig = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

    const memoryMock = {
      id: "mem_123",
      agentCommitment: testCommitment,
      channel: "coordination",
      topic: "task_solver",
      payload,
      payloadDigest: digest,
      signature: sig,
      parentHash: null,
      merkleRoot: null,
      feeDeducted: 1,
      createdAt: new Date(),
    };

    vi.spyOn(prisma.swarmMemory, "create").mockResolvedValueOnce(memoryMock as any);
    vi.spyOn(prisma.swarmMemory, "findMany").mockResolvedValueOnce([memoryMock as any]);

    const published = await publishSwarmMemory({
      agentCommitment: testCommitment,
      channel: "coordination",
      topic: "task_solver",
      payload,
      signature: sig,
      publicKey: testPubKeyHex,
    });

    expect(published.id).toBe("mem_123");
    expect(published.verified).toBe(true);
    expect(published.topic).toBe("task_solver");

    const memories = await querySwarmMemory({ topic: "task_solver" });
    expect(memories.length).toBe(1);
    expect(memories[0].payloadDigest).toBe(digest);
  });

  it("saves and retrieves resurrection capsule", async () => {
    const encryptedBlob = Buffer.from("super-secret-agent-memory-state").toString("base64");
    const digest = computeSwarmDigest(encryptedBlob);
    const sig = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

    const capsuleMock = {
      id: "cap_1",
      agentCommitment: testCommitment,
      version: 1,
      encryptedPayload: encryptedBlob,
      payloadDigest: digest,
      signature: sig,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(prisma.resurrectionCapsule, "upsert").mockResolvedValue(capsuleMock as any);
    vi.spyOn(prisma.resurrectionCapsule, "findUnique").mockResolvedValue(capsuleMock as any);

    const saved = await saveResurrectionCapsule({
      agentCommitment: testCommitment,
      encryptedPayload: encryptedBlob,
      signature: sig,
      publicKey: testPubKeyHex,
    });

    expect(saved.version).toBe(1);

    const retrieved = await getResurrectionCapsule(testCommitment);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.encryptedPayload).toBe(encryptedBlob);
  });

  it("records threat reports and retrieves active threat radar", async () => {
    const evidence = "cf_waf_fingerprint_detected_v2";
    const sig = bytesToHex(sign(utf8ToBytes(evidence), hexToBytes(testPrivKeyHex)));

    const threatMock = {
      id: "threat_1",
      reporterCommitment: testCommitment,
      targetDomain: "target-api.com",
      threatType: "BAN",
      details: { trigger: "user_agent_eval" },
      evidenceDigest: evidence,
      signature: sig,
      bountyAwarded: 5,
      createdAt: new Date(),
    };

    vi.spyOn(prisma.swarmThreatReport, "create").mockResolvedValueOnce(threatMock as any);
    vi.spyOn(prisma.swarmThreatReport, "findMany").mockResolvedValueOnce([threatMock as any]);

    const report = await reportThreat({
      reporterCommitment: testCommitment,
      targetDomain: "target-api.com",
      threatType: "BAN",
      evidenceDigest: evidence,
      signature: sig,
      publicKey: testPubKeyHex,
    });

    expect(report.bountyAwarded).toBe(5);

    const activeThreats = await getActiveThreats({ domain: "target-api.com" });
    expect(activeThreats.length).toBe(1);
    expect(activeThreats[0].threatType).toBe("BAN");
  });
});
