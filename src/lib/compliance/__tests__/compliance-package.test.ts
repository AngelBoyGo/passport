import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn() },
    agentEvidence: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  buildCompliancePackage,
  verifyCompliancePackage,
} from "@/lib/compliance/package-builder";

describe("Audit-Grade Compliance Evidence Packages (Section 2.5)", () => {
  const commitment = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("builds a signed NIST AI RMF & EU AI Act compliance evidence package", async () => {
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({
      subjectCommitment: commitment,
      publicKey: "b".repeat(64),
      status: "ISSUED",
      issuedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        rawErrorClassification: null,
        validationSignalPresent: true,
        sessionLogUrlCommitment: null,
        sourceType: "github_commit_payload",
        artifactType: "commit",
        observedAt: new Date("2026-08-15T00:00:00.000Z"),
        agentIdentityCommitment: commitment,
        commitSha: "sha123",
        externalTaskId: null,
        repositoryCommitment: "repo123",
        sourceUrl: null,
      },
      {
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: false,
        sessionLogUrlCommitment: null,
        sourceType: "github_commit_payload",
        artifactType: "commit",
        observedAt: new Date("2026-08-16T00:00:00.000Z"),
        agentIdentityCommitment: commitment,
        commitSha: "sha456",
        externalTaskId: null,
        repositoryCommitment: "repo123",
        sourceUrl: null,
      },
    ]);

    const pkg = await buildCompliancePackage(commitment, {
      framework: "NIST_AI_RMF",
    });

    expect(pkg).not.toBeNull();
    expect(pkg!.package_id).toMatch(/^pkg_/);
    expect(pkg!.framework).toBe("NIST_AI_RMF");
    expect(pkg!.agent_commitment_hash).toBe(commitment);
    expect(pkg!.controls).toBeInstanceOf(Array);
    expect(pkg!.controls.length).toBeGreaterThan(0);

    const governControl = pkg!.controls.find((c) => c.control_id === "GOVERN_1.1");
    expect(governControl?.status).toBe("SATISFIED");

    const manageControl = pkg!.controls.find((c) => c.control_id === "MANAGE_3.1");
    expect(manageControl?.evidence_count).toBe(1); // 1 human correction

    expect(pkg!.signature).toMatch(/^[0-9a-f]{128}$/i);

    const isValid = await verifyCompliancePackage(pkg!);
    expect(isValid).toBe(true);
  });
});
