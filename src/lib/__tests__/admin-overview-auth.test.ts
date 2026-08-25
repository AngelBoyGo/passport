import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionFromRequestMock = vi.fn();

vi.mock("@/lib/auth/cookies", () => ({
  sessionFromRequest: (...args: unknown[]) => sessionFromRequestMock(...args),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { count: vi.fn(), findMany: vi.fn() },
    agentEnrollment: { count: vi.fn() },
    agentEvidence: { count: vi.fn(), findMany: vi.fn() },
    engagement: { count: vi.fn(), findMany: vi.fn() },
    slashingLedger: { aggregate: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/receipt/signer", () => ({
  getPublicKeyHex: vi.fn(() => "pubkey-hex"),
}));

function primeHappyPrisma() {
  prismaMock.receipt.count.mockResolvedValue(3);
  prismaMock.agentEnrollment.count.mockResolvedValue(2);
  prismaMock.agentEvidence.count.mockResolvedValue(5);
  prismaMock.engagement.count.mockResolvedValue(1);
  prismaMock.slashingLedger.aggregate.mockResolvedValue({
    _sum: { penaltyCents: 0 },
    _count: 0,
  });
  prismaMock.receipt.findMany.mockResolvedValue([]);
  prismaMock.agentEvidence.findMany.mockResolvedValue([]);
  prismaMock.engagement.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);
}

function makeOperator(email: string) {
  return {
    id: "op-db-id",
    email,
    tier: "free",
    credits: 100,
    accountStatus: "ACTIVE",
    stakeBalanceCents: 0,
  };
}

describe("GET /api/admin/overview (operator-scoped)", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionFromRequestMock.mockReset();
    vi.clearAllMocks();
    delete process.env.ADMIN_OPERATOR_EMAILS;
  });

  it("rejects requests without an operator session", async () => {
    sessionFromRequestMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/overview/route");
    const response = await GET(
      new NextRequest("http://localhost/api/admin/overview")
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with scoped data for a regular operator (no 403)", async () => {
    primeHappyPrisma();
    process.env.ADMIN_OPERATOR_EMAILS = "ceo@example.com";
    sessionFromRequestMock.mockResolvedValue({
      operator: makeOperator("regular@example.com"),
    });

    const { GET } = await import("@/app/api/admin/overview/route");
    const response = await GET(
      new NextRequest("http://localhost/api/admin/overview")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.executiveAdmin).toBe(false);
    expect(body.metrics.receipts).toBe(3);
    expect(body.operator.email).toBe("regular@example.com");
    // Command Center must render: full shape (health + activity) present, and
    // sensitive global/cross-tenant fields + config-presence flags masked.
    expect(body.health).toBeDefined();
    expect(body.health.overall).toBeDefined();
    expect(Array.isArray(body.health.components)).toBe(true);
    expect(Array.isArray(body.activity)).toBe(true);
    expect(body.metrics.issuedAgents).toBeNull();
    expect(body.metrics.evidence).toBeNull();
    expect(body.health.components.find((c: { id: string }) => c.id === "signing").detail).not.toContain(
      "SIGNING_PRIVATE_KEY"
    );
  });

  it("flags executive admins in the response", async () => {
    primeHappyPrisma();
    process.env.ADMIN_OPERATOR_EMAILS = "ceo@example.com";
    sessionFromRequestMock.mockResolvedValue({
      operator: makeOperator("ceo@example.com"),
    });

    const { GET } = await import("@/app/api/admin/overview/route");
    const response = await GET(
      new NextRequest("http://localhost/api/admin/overview")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.executiveAdmin).toBe(true);
  });

  it("sends no-store cache headers so proxies never cache auth state", async () => {
    sessionFromRequestMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/overview/route");
    const response = await GET(
      new NextRequest("http://localhost/api/admin/overview")
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
