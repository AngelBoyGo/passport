import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findUnique: vi.fn() },
    agentEvidence: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("GET /api/v1/badge/:hash/attestation — 'Passport Verified' authenticity card", () => {
  const commitment = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
    prismaMock.agentEnrollment.findUnique.mockResolvedValue({
      subjectCommitment: commitment,
      publicKey: "b".repeat(64),
      status: "ISSUED",
      issuedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  function seedEvidence(opts?: { includeFailure?: boolean }): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [
      {
        id: "ev1",
        sourceType: "github_commit_payload",
        artifactType: "commit",
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        rawErrorClassification: null,
        observedAt: new Date("2026-08-10T00:00:00.000Z"),
        agentIdentityCommitment: commitment,
        repositoryCommitment: "repo1",
        branchCommitment: null,
        commitSha: "sha1",
        sessionLogUrlCommitment: null,
        sourceUrl: "https://github.com/acme/repo",
        executionStartedAt: null,
        executionFinishedAt: null,
        tokenUsageInput: null,
        tokenUsageOutput: null,
        toolCallCount: null,
        validationSignalPresent: true,
        eventCommitmentHash: "h".repeat(64),
        sourceDigest: null,
      },
    ];
    if (opts?.includeFailure) {
      rows.push({
        id: "ev2",
        sourceType: "github_commit_payload",
        artifactType: "commit",
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        observedAt: new Date("2026-08-11T00:00:00.000Z"),
        agentIdentityCommitment: commitment,
        repositoryCommitment: "repo",
        branchCommitment: null,
        commitSha: "sha2",
        sessionLogUrlCommitment: null,
        sourceUrl: null,
        executionStartedAt: null,
        executionFinishedAt: null,
        tokenUsageInput: null,
        tokenUsageOutput: null,
        toolCallCount: null,
        validationSignalPresent: false,
        eventCommitmentHash: "j".repeat(64),
        sourceDigest: null,
      });
    }
    return rows;
  }

  it("returns JSON metadata framing the authenticity claim for an enrolled agent", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue(seedEvidence({}));

    const { GET } = await import("@/app/api/v1/badge/[hash]/attestation/route");
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/badge/${commitment}/attestation?format=json`
    );
    const res = await GET(req, { params: Promise.resolve({ hash: commitment }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.archetype).toBeTruthy();
    expect(body.evidence_count).toBe(1);
    expect(body.artifact_count).toBe(1);
    expect(body.short).toContain("…");
    expect(body.claim).toMatch(/Authenticated AI Build/i);
    expect(body.profile_url).toContain(`/profiles/${commitment}`);
    expect(body.verify_url).toContain(commitment);
  });

  it("returns a readable SVG card with content-type image/svg+xml", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue(seedEvidence({}));

    const { GET } = await import("@/app/api/v1/badge/[hash]/attestation/route");
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/badge/${commitment}/attestation`
    );
    const res = await GET(req, { params: Promise.resolve({ hash: commitment }) });

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(svg).toContain("PASSPORT VERIFIED");
    expect(svg).toContain("signed receipt");
    expect(svg).toContain("Authenticated AI Build");
    expect(svg).toContain("passport.metis.gold");
  });

  it("returns not-found card for an unknown commitment", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    prismaMock.agentEnrollment.findUnique.mockResolvedValue(null);

    const { GET } = await import("@/app/api/v1/badge/[hash]/attestation/route");
    const req = new NextRequest(`https://passport.metis.gold/api/v1/badge/${commitment}/attestation`);
    const res = await GET(req, { params: Promise.resolve({ hash: commitment }) });

    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain("not found");
  });

  it("returns invalid JSON metadata for a non-hex commitment", async () => {
    const { GET } = await import("@/app/api/v1/badge/[hash]/attestation/route");
    const req = new NextRequest(
      "https://passport.metis.gold/api/v1/badge/bad/attestation?format=json"
    );
    const res = await GET(req, { params: Promise.resolve({ hash: "bad" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toBe("invalid");
  });
});