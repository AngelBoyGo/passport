import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEvidence: {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
    },
    agentEnrollment: {
      findUnique: vi.fn().mockResolvedValue({ status: "ISSUED" }),
    },
    receipt: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("GET /api/v1/agents — Agent Discovery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns empty list when no agents exist", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const req = new Request("http://localhost/api/v1/agents") as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("accepts query params without error", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const req = new Request("http://localhost/api/v1/agents?domain=CODE_GENERATION&min_score=400&limit=10&sort=evidence") as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it("applies default limit of 20", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const req = new Request("http://localhost/api/v1/agents") as any;
    const res = await GET(req);
    const body = await res.json();
    expect(body.query.limit).toBe(20);
  });

  it("caps limit at 100", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const req = new Request("http://localhost/api/v1/agents?limit=999") as any;
    const res = await GET(req);
    const body = await res.json();
    expect(body.query.limit).toBe(100);
  });
});