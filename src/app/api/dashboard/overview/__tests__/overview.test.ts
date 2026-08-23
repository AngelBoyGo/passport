import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    session: { findUnique: vi.fn(), create: vi.fn() },
    operator: { findUnique: vi.fn(), findFirst: vi.fn() },
    apiKey: { findMany: vi.fn() },
    agent: { findMany: vi.fn() },
    receipt: { findMany: vi.fn(), count: vi.fn() },
    agentEvidence: { findMany: vi.fn(), count: vi.fn() },
    webhookSubscription: { count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { createSession } from "@/lib/auth/auth-service";

describe("GET /api/dashboard/overview — User Dashboard Data Aggregator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns 401 when session cookie is absent", async () => {
    const { GET } = await import("@/app/api/dashboard/overview/route");
    const req = new NextRequest("https://passport.metis.gold/api/dashboard/overview");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns comprehensive dashboard state for authenticated operator", async () => {
    const { token: sessionToken } = await createSession("op_123");

    prismaMock.session.findUnique.mockResolvedValue({
      id: "sess_row_1",
      token: sessionToken,
      operatorId: "op_123",
      expiresAt: new Date(Date.now() + 1000000),
      operator: {
        id: "op_123",
        email: "builder@example.com",
      },
    });

    prismaMock.operator.findUnique.mockResolvedValue({
      id: "op_123",
      email: "builder@example.com",
      credits: 150,
      tier: "pro",
      accountStatus: "ACTIVE",
      stakeBalanceCents: 5000,
    });

    prismaMock.apiKey.findMany.mockResolvedValue([
      { id: "key_1", keyHash: "hash1", name: "Production Key", createdAt: new Date() },
    ]);

    prismaMock.agent.findMany.mockResolvedValue([
      { id: "agent_rec_1", agentId: "agent_alpha", domain: "CODE_GENERATION" },
    ]);

    prismaMock.receipt.findMany.mockResolvedValue([
      {
        receiptId: "rcpt_123",
        issuedAt: new Date("2026-08-21T05:00:00Z"),
        status: "success",
        domain: "SYSTEM_INTEGRATION",
        inputDigest: "digest123",
        contentHash: "chash123",
        signature: "sig123",
        agentId: "agent_alpha",
      },
    ]);

    prismaMock.receipt.count.mockResolvedValue(42);
    prismaMock.agentEvidence.count.mockResolvedValue(128);
    prismaMock.agentEvidence.findMany.mockResolvedValue([]);
    prismaMock.webhookSubscription.count.mockResolvedValue(2);

    const { GET } = await import("@/app/api/dashboard/overview/route");
    const req = new NextRequest("https://passport.metis.gold/api/dashboard/overview", {
      headers: {
        cookie: `session_token=${sessionToken}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.operator.email).toBe("builder@example.com");
    expect(data.operator.tier).toBe("pro");
    expect(data.metrics.total_receipts).toBe(42);
    // Global evidence count was removed (leak); now scoped to 0.
    expect(data.metrics.total_evidence).toBe(0);
    expect(data.api_keys.length).toBe(1);
    expect(data.recent_receipts.length).toBe(1);
    expect(data.merkle_root).toBeDefined();
    expect(data.public_verifying_key).toBeDefined();
  });
});
