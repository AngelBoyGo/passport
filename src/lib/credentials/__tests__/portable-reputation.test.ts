import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn() },
    agentEvidence: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  generateAgentVerifiableCredential,
  verifyAgentVerifiableCredential,
} from "@/lib/credentials/portable-reputation";

describe("W3C Verifiable Credential — Portable Agent Reputation (Section 2.1)", () => {
  const commitment = "a".repeat(64);
  const agentPubkey = "b".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.INGESTION_COMMITMENT_SALT = "test-salt";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("generates a valid, cryptographically signed W3C Verifiable Credential", async () => {
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({
      subjectCommitment: commitment,
      publicKey: agentPubkey,
      status: "ISSUED",
      photoUrl: null,
      photoContentSha256: null,
      photoMimeType: null,
      photoUpdatedAt: null,
    });

    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        rawErrorClassification: null,
        validationSignalPresent: true,
        sessionLogUrlCommitment: null,
        sourceType: "github_commit_payload",
        artifactType: "commit",
        observedAt: new Date("2026-08-20T00:00:00.000Z"),
        agentIdentityCommitment: commitment,
        commitSha: "abc123456789",
        externalTaskId: null,
        repositoryCommitment: "repo-hash",
        sourceUrl: null,
      },
    ]);

    const vc = await generateAgentVerifiableCredential(commitment);

    expect(vc).not.toBeNull();
    expect(vc!["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
    expect(vc!.type).toContain("VerifiableCredential");
    expect(vc!.type).toContain("AgentReputationCredential");
    expect(vc!.credentialSubject.id).toBe(`did:key:z${agentPubkey}`);
    expect(vc!.credentialSubject.agent_commitment_hash).toBe(commitment);
    expect(vc!.credentialSubject.archetype).toBe("Builder");
    expect(vc!.credentialSubject.totals.evidence_count).toBe(1);
    expect(vc!.credentialSubject.totals.artifact_count).toBe(1);

    // Verify proof structure
    expect(vc!.proof).toBeDefined();
    expect(vc!.proof.type).toBe("Ed25519Signature2020");
    expect(vc!.proof.proofValue).toMatch(/^[0-9a-f]{128}$/i);

    // Verify self-contained cryptographic validity
    const verification = await verifyAgentVerifiableCredential(vc!);
    expect(verification.valid).toBe(true);
    expect(verification.issuer).toContain("did:key:z");
  });

  it("detects tampering when any claim in credentialSubject is altered", async () => {
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({
      subjectCommitment: commitment,
      publicKey: agentPubkey,
      status: "ISSUED",
    });
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);

    const vc = await generateAgentVerifiableCredential(commitment);
    expect(vc).not.toBeNull();

    // Tamper with totals
    const tamperedVc = JSON.parse(JSON.stringify(vc));
    tamperedVc.credentialSubject.totals.artifact_count = 999999;

    const verification = await verifyAgentVerifiableCredential(tamperedVc);
    expect(verification.valid).toBe(false);
    expect(verification.error).toMatch(/signature|tamper/i);
  });

  it("returns null when attempting to issue VC for an unenrolled agent", async () => {
    prismaMock.agentEnrollment.findUnique.mockResolvedValue(null);

    const vc = await generateAgentVerifiableCredential("unknown_commitment");
    expect(vc).toBeNull();
  });
});
