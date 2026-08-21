import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
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

import { solveAutonomousPoW } from "@/lib/auth/autonomous-provision";

describe("Autonomous Agent Provisioning REST Endpoints", () => {
  const privKey = hexToBytes("1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff");
  let pubKeyHex: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    pubKeyHex = bytesToHex(await getPublicKey(privKey));
    process.env.INGESTION_COMMITMENT_SALT = "test-salt-123";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("POST /api/v1/passport/agents/autonomous/challenge — issues nonce and difficulty", async () => {
    const { POST } = await import("@/app/api/v1/passport/agents/autonomous/challenge/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/passport/agents/autonomous/challenge", {
      method: "POST",
      body: JSON.stringify({ public_key: pubKeyHex }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.challenge_nonce).toMatch(/^[0-9a-f]{64}$/i);
    expect(body.pow_difficulty).toBe(3);
  });

  it("POST /api/v1/passport/agents/autonomous/provision — verifies PoW and signature, mints pp_usr_ key", async () => {
    const { POST: challengeHandler } = await import(
      "@/app/api/v1/passport/agents/autonomous/challenge/route"
    );
    const chalReq = new NextRequest("https://passport.metis.gold/api/v1/passport/agents/autonomous/challenge", {
      method: "POST",
      body: JSON.stringify({ public_key: pubKeyHex }),
      headers: { "Content-Type": "application/json" },
    });
    const chalRes = await challengeHandler(chalReq);
    const chalBody = await chalRes.json();

    const powNonce = solveAutonomousPoW(chalBody.challenge_nonce, chalBody.pow_difficulty);
    const message = `${chalBody.challenge_nonce}:${powNonce}:${pubKeyHex}`;
    const digest = sha256(utf8ToBytes(message));
    const signatureHex = bytesToHex(await sign(digest, privKey));

    prismaMock.operator.create.mockResolvedValue({ id: "op_auto_1" });
    prismaMock.apiKey.create.mockResolvedValue({ id: "key_auto_1" });
    prismaMock.agent.create.mockResolvedValue({ id: "ag_auto_1" });
    prismaMock.agentEnrollment.upsert.mockResolvedValue({ id: "en_auto_1" });

    const { POST: provisionHandler } = await import(
      "@/app/api/v1/passport/agents/autonomous/provision/route"
    );
    const provReq = new NextRequest("https://passport.metis.gold/api/v1/passport/agents/autonomous/provision", {
      method: "POST",
      body: JSON.stringify({
        public_key: pubKeyHex,
        challenge_nonce: chalBody.challenge_nonce,
        pow_nonce: powNonce,
        signature: signatureHex,
        display_name: "SelfSovereignBot",
        domain: "CODE_GENERATION",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const provRes = await provisionHandler(provReq);
    expect(provRes.status).toBe(201);

    const provBody = await provRes.json();
    expect(provBody.success).toBe(true);
    expect(provBody.api_key).toMatch(/^pp_usr_/);
    expect(provBody.role).toBe("HOLDER");
    expect(provBody.subject_commitment).toBeDefined();
    expect(provBody.did).toBe(`did:key:z${pubKeyHex}`);
  });
});
