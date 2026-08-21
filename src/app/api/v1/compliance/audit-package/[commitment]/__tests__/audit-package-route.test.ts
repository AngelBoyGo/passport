import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("GET /api/v1/compliance/audit-package/:commitment", () => {
  const commitment = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  });

  it("returns 400 for an invalid commitment", async () => {
    const { GET } = await import("@/app/api/v1/compliance/audit-package/[commitment]/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/compliance/audit-package/bad");
    const res = await GET(req, { params: Promise.resolve({ commitment: "not-a-hash" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when no compliance_report evidence exists", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/compliance/audit-package/[commitment]/route");
    const req = new NextRequest("https://passport.metis.gold/api/v1/compliance/audit-package/x");
    const res = await GET(req, { params: Promise.resolve({ commitment }) });
    expect(res.status).toBe(404);
  });

  it("assembles a signed audit package from compliance_report receipts", async () => {
    prismaMock.agentEvidence.findMany.mockResolvedValue([
      {
        id: "ev_1",
        sourceType: "compliance_report",
        observedAt: new Date("2026-08-01T00:00:00Z"),
        sourceDigest: JSON.stringify({ report: { id: "r1" }, control_domain: "CC6.1" }),
      },
    ]);

    const { GET } = await import("@/app/api/v1/compliance/audit-package/[commitment]/route");
    const req = new NextRequest(
      "https://passport.metis.gold/api/v1/compliance/audit-package/x?framework=SOC2_TYPE2"
    );
    const res = await GET(req, { params: Promise.resolve({ commitment }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.framework).toBe("SOC2_TYPE2");
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/i);
    expect(body.evidence_events_analyzed).toBe(1);
  });
});
