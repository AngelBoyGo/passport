import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("GET /api/v1/artifacts/:commitment/:artifact/attestation — per-artifact authenticity", () => {
  const commitment = "a".repeat(64);
  const artifact = "c".repeat(40);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns verified JSON metadata binding a specific artifact to the agent", async () => {
    prismaMock.agentEvidence.findFirst.mockResolvedValue({
      id: "ev1",
      normalizedEventType: "AGENT_ARTIFACT_CREATED",
      commitSha: artifact,
      eventCommitmentHash: "ef".repeat(32),
      sourceType: "github_commit_payload",
      observedAt: new Date("2026-08-10T00:00:00.000Z"),
      validationSignalPresent: true,
    });

    const { GET } = await import("@/app/api/v1/artifacts/[commitment]/[artifact]/attestation/route");
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/artifacts/${commitment}/${artifact}/attestation?format=json`
    );
    const res = await GET(req, { params: Promise.resolve({ commitment, artifact }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.artifact).toBe(artifact);
    expect(body.agent_commitment_hash).toBe(commitment);
    expect(body.event_type).toBe("AGENT_ARTIFACT_CREATED");
    expect(body.claim).toMatch(/authenticated agent/i);
    expect(body.profile_url).toContain(`/profiles/${commitment}`);
  });

  it("returns 404 JSON when the artifact is not found under the agent", async () => {
    prismaMock.agentEvidence.findFirst.mockResolvedValue(null);

    const { GET } = await import(
      "@/app/api/v1/artifacts/[commitment]/[artifact]/attestation/route"
    );
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/artifacts/${commitment}/${artifact}/attestation?format=json`
    );
    const res = await GET(req, { params: Promise.resolve({ commitment, artifact }) });

    expect(res.status).toBe(200); // not-found JSON still 200, verified:false
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toMatch(/not found/i);
  });

  it("accepts an eventCommitmentHash as the artifact", async () => {
    const eventHash = "e".repeat(64);
    prismaMock.agentEvidence.findFirst.mockResolvedValue({
      id: "ev2",
      normalizedEventType: "VALIDATION_OBSERVED",
      commitSha: null,
      eventCommitmentHash: eventHash,
      sourceType: "otel_genai_trace",
      observedAt: new Date("2026-08-10T00:00:00.000Z"),
      validationSignalPresent: true,
    });

    const { GET } = await import(
      "@/app/api/v1/artifacts/[commitment]/[artifact]/attestation/route"
    );
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/artifacts/${commitment}/${eventHash}/attestation?format=json`
    );
    const res = await GET(req, { params: Promise.resolve({ commitment, artifact: eventHash }) });

    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.event_type).toBe("VALIDATION_OBSERVED");
  });

  it("returns an SVG card for default format", async () => {
    prismaMock.agentEvidence.findFirst.mockResolvedValue({
      id: "ev1",
      normalizedEventType: "AGENT_ARTIFACT_CREATED",
      commitSha: artifact,
      eventCommitmentHash: "f".repeat(64),
      sourceType: "github_commit_payload",
      observedAt: new Date("2026-08-10T00:00:00.000Z"),
      validationSignalPresent: true,
    });

    const { GET } = await import(
      "@/app/api/v1/artifacts/[commitment]/[artifact]/attestation/route"
    );
    const req = new NextRequest(
      `https://passport.metis.gold/api/v1/artifacts/${commitment}/${artifact}/attestation`
    );
    const res = await GET(req, { params: Promise.resolve({ commitment, artifact }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("PASSPORT VERIFIED");
    expect(svg).toContain("authenticated AI build");
  });

  it("rejects an invalid commitment with verified:false", async () => {
    const { GET } = await import(
      "@/app/api/v1/artifacts/[commitment]/[artifact]/attestation/route"
    );
    const req = new NextRequest(
      "https://passport.metis.gold/api/v1/artifacts/bad/abc/attestation?format=json"
    );
    const res = await GET(req, { params: Promise.resolve({ commitment: "bad", artifact: "abc" }) });
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.reason).toMatch(/invalid/i);
  });
});