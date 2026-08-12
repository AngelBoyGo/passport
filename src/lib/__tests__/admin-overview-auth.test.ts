import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getSessionFromTokenMock = vi.fn();

vi.mock("@/lib/auth/auth-service", () => ({
  getSessionFromToken: (...args: unknown[]) => getSessionFromTokenMock(...args),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/receipt/signer", () => ({ getPublicKeyHex: vi.fn() }));

describe("GET /api/admin/overview", () => {
  beforeEach(() => {
    vi.resetModules();
    getSessionFromTokenMock.mockReset();
  });

  it("rejects requests without an operator session", async () => {
    const { GET } = await import("@/app/api/admin/overview/route");
    const response = await GET(new NextRequest("http://localhost/api/admin/overview"));
    expect(response.status).toBe(401);
  });
});
