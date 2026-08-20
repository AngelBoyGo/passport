import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    apiKey: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    receipt: {
      findMany: vi.fn(),
    },
    webhookSubscription: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const sessionFromRequestMock = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/cookies", () => ({
  sessionFromRequest: (...args: unknown[]) => sessionFromRequestMock(...args),
}));

describe("Session-Authenticated Admin Routes", () => {
  const operatorSession = {
    operator: {
      id: "op_session_123",
      email: "operator@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionFromRequestMock.mockReset();
  });

  describe("GET /api/admin/api-keys", () => {
    it("returns 401 when not authenticated via session", async () => {
      sessionFromRequestMock.mockResolvedValue(null);
      const { GET } = await import("@/app/api/admin/api-keys/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/api-keys"));
      expect(res.status).toBe(401);
    });

    it("returns operator API keys when session is valid", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.apiKey.findMany.mockResolvedValue([
        { id: "k1", keyHash: "hash1", name: "Default Key", createdAt: new Date() },
      ]);

      const { GET } = await import("@/app/api/admin/api-keys/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/api-keys"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Default Key");
      expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { operatorId: "op_session_123" } })
      );
    });
  });

  describe("GET /api/admin/receipts", () => {
    it("returns receipts scoped to authenticated operator session", async () => {
      sessionFromRequestMock.mockResolvedValue(operatorSession);
      prismaMock.receipt.findMany.mockResolvedValue([
        { receiptId: "rcpt_test", status: "success", issuedAt: new Date() },
      ]);

      const { GET } = await import("@/app/api/admin/receipts/route");
      const res = await GET(new NextRequest("https://passport.test/api/admin/receipts"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(prismaMock.receipt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ operatorId: "op_session_123" }) })
      );
    });
  });
});
