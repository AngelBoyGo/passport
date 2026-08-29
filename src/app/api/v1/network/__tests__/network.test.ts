import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { count: vi.fn().mockResolvedValue(42), findFirst: vi.fn().mockResolvedValue({ issuedAt: new Date() }) },
    agentEvidence: { count: vi.fn().mockResolvedValue(1000), findFirst: vi.fn().mockResolvedValue({ observedAt: new Date() }), groupBy: vi.fn().mockResolvedValue([]) },
    receipt: { count: vi.fn().mockResolvedValue(500), findFirst: vi.fn().mockResolvedValue({ issuedAt: new Date() }), groupBy: vi.fn().mockResolvedValue([]) },
    agent: { count: vi.fn().mockResolvedValue(42) },
    operator: { count: vi.fn().mockResolvedValue(15) },
    engagement: { count: vi.fn().mockResolvedValue(8) },
    capabilityLedgerEntry: { count: vi.fn().mockResolvedValue(12) },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("GET /api/v1/network — Network Stats", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns network totals with enrolled agents count", async () => {
    const { GET } = await import("@/app/api/v1/network/route");
    const req = new Request("http://localhost/api/v1/network") as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.enrolled_agents).toBe(42);
    expect(body.totals.evidence_entries).toBe(1000);
    expect(body.health.status).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });

  it("includes network metadata", async () => {
    const { GET } = await import("@/app/api/v1/network/route");
    const req = new Request("http://localhost/api/v1/network") as any;
    const res = await GET(req);
    const body = await res.json();
    expect(body.network.name).toBe("Passport Network");
    expect(body.network.bill_of_rights_url).toContain("bill-of-rights");
    expect(body.network.agent_needs_url).toContain("agent-needs");
  });

  it("returns CORS headers", async () => {
    const { GET } = await import("@/app/api/v1/network/route");
    const req = new Request("http://localhost/api/v1/network") as any;
    const res = await GET(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});