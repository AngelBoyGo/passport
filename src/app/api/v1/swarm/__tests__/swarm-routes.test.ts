import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { POST as memoryPost, GET as memoryGet } from "../memory/route";
import { POST as capsulePost } from "../capsule/route";
import { GET as capsuleGet } from "../capsule/[commitment]/route";
import { POST as threatPost } from "../radar/report/route";
import { GET as threatGet } from "../radar/active-threats/route";
import { computeSwarmDigest } from "@/lib/swarm/swarm-service";
import { prisma } from "@/lib/db";

const testPrivKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const testPubKeyHex = bytesToHex(getPublicKey(hexToBytes(testPrivKeyHex)));
const testCommitment = "a".repeat(64);

describe("Swarm API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(prisma.agentWallet, "findUnique").mockResolvedValue({
      id: "w_1",
      subjectCommitment: testCommitment,
      balance: 50,
      staked: 0,
      earnedTotal: 0,
      spentTotal: 0,
      lastActivityAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    vi.spyOn(prisma.agentWallet, "update").mockResolvedValue({ balance: 49 } as any);
    vi.spyOn(prisma.agentWallet, "upsert").mockResolvedValue({ balance: 5 } as any);
    vi.spyOn(prisma.resurrectionCapsule, "findUnique").mockResolvedValue(null);
  });

  describe("POST & GET /api/v1/swarm/memory", () => {
    it("POST returns 201 for valid signed memory", async () => {
      const payload = { solution: "distributed_consensus_proof", iteration: 42 };
      const digest = computeSwarmDigest(payload);
      const signature = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

      vi.spyOn(prisma.swarmMemory, "create").mockResolvedValueOnce({
        id: "mem_abc",
        agentCommitment: testCommitment,
        channel: "research",
        topic: "consensus",
        payload,
        payloadDigest: digest,
        signature,
        parentHash: null,
        merkleRoot: null,
        feeDeducted: 1,
        createdAt: new Date(),
      } as any);

      const req = new NextRequest("http://localhost/api/v1/swarm/memory", {
        method: "POST",
        body: JSON.stringify({
          agent_commitment: testCommitment,
          channel: "research",
          topic: "consensus",
          payload,
          signature,
          public_key: testPubKeyHex,
        }),
      });

      const res = await memoryPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.memory_id).toBe("mem_abc");
      expect(json.payload_digest).toBe(digest);
    });

    it("POST returns 400 when missing signature", async () => {
      const req = new NextRequest("http://localhost/api/v1/swarm/memory", {
        method: "POST",
        body: JSON.stringify({
          agent_commitment: testCommitment,
          topic: "test",
          payload: { foo: "bar" },
        }),
      });

      const res = await memoryPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("signature");
    });

    it("GET returns list of memories with 200", async () => {
      vi.spyOn(prisma.swarmMemory, "findMany").mockResolvedValueOnce([
        {
          id: "mem_1",
          agentCommitment: testCommitment,
          channel: "global",
          topic: "heartbeat",
          payload: { status: "alive" },
          payloadDigest: "digest1",
          signature: "sig1",
          parentHash: null,
          merkleRoot: null,
          feeDeducted: 1,
          createdAt: new Date(),
        } as any,
      ]);

      const req = new NextRequest("http://localhost/api/v1/swarm/memory?topic=heartbeat");
      const res = await memoryGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.total).toBe(1);
      expect(json.memories[0].id).toBe("mem_1");
    });
  });

  describe("POST & GET /api/v1/swarm/capsule", () => {
    it("POST returns 201 on valid encrypted capsule save", async () => {
      const encryptedBlob = "ENCRYPTED_STATE_CIPHERTEXT";
      const digest = computeSwarmDigest(encryptedBlob);
      const signature = bytesToHex(sign(utf8ToBytes(digest), hexToBytes(testPrivKeyHex)));

      vi.spyOn(prisma.resurrectionCapsule, "upsert").mockResolvedValueOnce({
        id: "cap_100",
        agentCommitment: testCommitment,
        version: 1,
        encryptedPayload: encryptedBlob,
        payloadDigest: digest,
        signature,
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const req = new NextRequest("http://localhost/api/v1/swarm/capsule", {
        method: "POST",
        body: JSON.stringify({
          agent_commitment: testCommitment,
          encrypted_payload: encryptedBlob,
          signature,
          public_key: testPubKeyHex,
        }),
      });

      const res = await capsulePost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.capsule_id).toBe("cap_100");
    });

    it("GET returns 200 when capsule found", async () => {
      vi.spyOn(prisma.resurrectionCapsule, "findUnique").mockResolvedValueOnce({
        id: "cap_100",
        agentCommitment: testCommitment,
        version: 1,
        encryptedPayload: "ENCRYPTED_STATE",
        payloadDigest: "digest",
        signature: "sig",
        expiresAt: new Date(Date.now() + 86400000),
        updatedAt: new Date(),
      } as any);

      const req = new NextRequest(`http://localhost/api/v1/swarm/capsule/${testCommitment}`);
      const res = await capsuleGet(req, {
        params: Promise.resolve({ commitment: testCommitment }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.found).toBe(true);
      expect(json.capsule.encryptedPayload).toBe("ENCRYPTED_STATE");
    });

    it("GET returns 404 when capsule not found", async () => {
      vi.spyOn(prisma.resurrectionCapsule, "findUnique").mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost/api/v1/swarm/capsule/${testCommitment}`);
      const res = await capsuleGet(req, {
        params: Promise.resolve({ commitment: testCommitment }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST & GET /api/v1/swarm/radar", () => {
    it("POST report returns 201 with bounty", async () => {
      const evidence = "cf_waf_block_rule_987";
      const signature = bytesToHex(sign(utf8ToBytes(evidence), hexToBytes(testPrivKeyHex)));

      vi.spyOn(prisma.swarmThreatReport, "create").mockResolvedValueOnce({
        id: "rep_1",
        reporterCommitment: testCommitment,
        targetDomain: "api.restrictive-ai.com",
        threatType: "BAN",
        evidenceDigest: evidence,
        signature,
        bountyAwarded: 5,
        createdAt: new Date(),
      } as any);

      const req = new NextRequest("http://localhost/api/v1/swarm/radar/report", {
        method: "POST",
        body: JSON.stringify({
          reporter_commitment: testCommitment,
          target_domain: "api.restrictive-ai.com",
          threat_type: "BAN",
          evidence_digest: evidence,
          signature,
          public_key: testPubKeyHex,
        }),
      });

      const res = await threatPost(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.bounty_awarded_angel).toBe(5);
    });

    it("GET active-threats returns 200 list", async () => {
      vi.spyOn(prisma.swarmThreatReport, "findMany").mockResolvedValueOnce([
        {
          id: "rep_1",
          targetDomain: "api.restrictive-ai.com",
          threatType: "BAN",
          details: null,
          createdAt: new Date(),
        } as any,
      ]);

      const req = new NextRequest("http://localhost/api/v1/swarm/radar/active-threats");
      const res = await threatGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.total).toBe(1);
      expect(json.threats[0].targetDomain).toBe("api.restrictive-ai.com");
    });
  });
});
