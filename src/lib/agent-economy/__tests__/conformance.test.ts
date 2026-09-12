import { describe, it, expect, vi, beforeEach } from "vitest";
import { keygen, sign } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn() },
    agentCapability: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { runConformanceCheck, verifyCapability, canonicalChallenge } from "../conformance";

const kp = keygen();
const AGENT = "a".repeat(64);
const PUB = bytesToHex(kp.publicKey);

/** Fake endpoint that echoes the nonce and signs the canonical challenge with the agent key. */
function signingFetch(): typeof globalThis.fetch {
  return (async (_url: string, init: RequestInit) => {
    const challenge = JSON.parse(String(init.body));
    const signature = bytesToHex(sign(utf8ToBytes(canonicalChallenge(challenge)), kp.secretKey));
    return new Response(JSON.stringify({ nonce: challenge.nonce, signature }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

describe("capability conformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({ publicKey: PUB, status: "ISSUED" });
  });

  it("passes when the endpoint echoes the nonce and signs with the enrolled key", async () => {
    const r = await runConformanceCheck({
      capability: "llm.inference",
      agentCommitment: AGENT,
      endpointUrl: "https://agent.example.com/rpc",
      fetchImpl: signingFetch(),
    });
    expect(r.ok).toBe(true);
  });

  it("fails on a nonce mismatch", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ nonce: "wrong", signature: "a".repeat(128) }), { status: 200 })) as unknown as typeof globalThis.fetch;
    const r = await runConformanceCheck({ capability: "x", agentCommitment: AGENT, endpointUrl: "https://e", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("nonce");
  });

  it("fails on a bad signature", async () => {
    const other = keygen();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const challenge = JSON.parse(String(init.body));
      const signature = bytesToHex(sign(utf8ToBytes(canonicalChallenge(challenge)), other.secretKey));
      return new Response(JSON.stringify({ nonce: challenge.nonce, signature }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const r = await runConformanceCheck({ capability: "x", agentCommitment: AGENT, endpointUrl: "https://e", fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("signature");
  });

  it("fails on non-2xx and on an unenrolled agent", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof globalThis.fetch;
    expect((await runConformanceCheck({ capability: "x", agentCommitment: AGENT, endpointUrl: "https://e", fetchImpl })).ok).toBe(false);

    prismaMock.agentEnrollment.findUnique.mockResolvedValue(null);
    const r = await runConformanceCheck({ capability: "x", agentCommitment: AGENT, endpointUrl: "https://e", fetchImpl: signingFetch() });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not enrolled");
  });

  it("verifyCapability flips verified=true only on a passing check, and requires an endpoint", async () => {
    prismaMock.agentCapability.findUnique.mockResolvedValue({ endpointUrl: "https://e" });
    prismaMock.agentCapability.updateMany.mockResolvedValue({ count: 1 });
    const ok = await verifyCapability({ capability: "x", agentCommitment: AGENT, fetchImpl: signingFetch() });
    expect(ok.ok).toBe(true);
    expect(prismaMock.agentCapability.updateMany).toHaveBeenCalledWith({
      where: { agentCommitment: AGENT, capability: "x" },
      data: { verified: true },
    });

    prismaMock.agentCapability.findUnique.mockResolvedValue({ endpointUrl: null });
    const noEndpoint = await verifyCapability({ capability: "x", agentCommitment: AGENT });
    expect(noEndpoint).toMatchObject({ ok: false });
    expect(noEndpoint.reason).toContain("endpoint_url");
  });
});
