import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authenticateApiKeyMock = vi.hoisted(() => vi.fn());
const meterAttestationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/metering/attestation-meter", () => ({
  meterAttestation: (...args: unknown[]) => meterAttestationMock(...args),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn() },
    agentEvidence: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("POST /api/v1/metered/credentials/:commitment — Reputation-as-a-Service", () => {
  const commitment = "a".repeat(64);
  const operator = { id: "op_1", apiKeyRole: "ISSUER" };
  const vc = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "AgentReputationCredential"],
    credentialSubject: { id: "did:key:z" },
    proof: { type: "Ed25519Signature2020", proofValue: "x".repeat(128) },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns 401 without a valid key", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/metered/credentials/[commitment]/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/metered/credentials/x", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ commitment }) });
    expect(res.status).toBe(401);
  });

  it("returns 402 when the operator lacks sufficient credits", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    meterAttestationMock.mockResolvedValue({
      allowed: false,
      reason: "Insufficient credits: need 0.5, have 0",
      product: "portable_credential_issuance",
      price_micros: 500_000,
    });

    const { POST } = await import("@/app/api/v1/metered/credentials/[commitment]/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/metered/credentials/x", {
      method: "POST",
      headers: { Authorization: "Bearer pp_ent_key" },
    });
    const res = await POST(req, { params: Promise.resolve({ commitment }) });
    expect(res.status).toBe(402);
    expect(meterAttestationMock).toHaveBeenCalledWith(operator.id, "portable_credential_issuance", commitment);
  });

  it("issues a metered credential and returns the meter receipt on success", async () => {
    authenticateApiKeyMock.mockResolvedValue(operator);
    meterAttestationMock.mockResolvedValue({
      allowed: true,
      product: "portable_credential_issuance",
      price_micros: 500_000,
      credits_charged: 0.5,
      remaining_credits: 9.5,
      meter_ref: "meter_abc123",
    });

    prismaMock.agentEnrollment.findUnique.mockResolvedValue({
      subjectCommitment: commitment,
      publicKey: "b".repeat(64),
      status: "ISSUED",
    });
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);

    const { POST } = await import("@/app/api/v1/metered/credentials/[commitment]/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/metered/credentials/x", {
      method: "POST",
      headers: { Authorization: "Bearer pp_ent_key" },
    });
    const res = await POST(req, { params: Promise.resolve({ commitment }) });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.credential.type).toContain("AgentReputationCredential");
    expect(body.meter.meter_ref).toBe("meter_abc123");
    expect(body.meter.credits_charged).toBe(0.5);
  });
});
