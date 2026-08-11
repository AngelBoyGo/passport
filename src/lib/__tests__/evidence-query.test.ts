import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const evidenceFindManyMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEvidence: {
      findMany: (...args: unknown[]) => evidenceFindManyMock(...args),
    },
  },
}));

const operator = { id: "op_test_cuid", stripeCustomerId: "cus_test" };
const COMMITMENT = "a".repeat(64);

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  evidenceFindManyMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
});

describe("GET /api/v1/passport/agents/:id/evidence", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/evidence/route");
    const request = new Request("http://localhost/api/v1/passport/agents/x/evidence");
    const response = await GET(request as never, {
      params: Promise.resolve({ id: COMMITMENT }),
    });
    expect(response.status).toBe(401);
  });

  it("returns evidence entries for a commitment hash", async () => {
    const entries = [
      {
        id: "ev1",
        agentIdentityCommitment: COMMITMENT,
        sourceType: "github_push_webhook",
        eventCommitmentHash: "evhash1",
        observedAt: new Date(),
        createdAt: new Date(),
      },
    ];
    evidenceFindManyMock.mockResolvedValue(entries);
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/evidence/route");
    const request = new Request(
      `http://localhost/api/v1/passport/agents/${COMMITMENT}/evidence`,
      { headers: { Authorization: "Bearer pp_test" } }
    );
    const response = await GET(request as never, {
      params: Promise.resolve({ id: COMMITMENT }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].sourceType).toBe("github_push_webhook");
  });

  it("accepts source_type filter query param", async () => {
    evidenceFindManyMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/v1/passport/agents/[id]/evidence/route");
    const request = new Request(
      `http://localhost/api/v1/passport/agents/${COMMITMENT}/evidence?source_type=task_deliverable`,
      { headers: { Authorization: "Bearer pp_test" } }
    );
    await GET(request as never, {
      params: Promise.resolve({ id: COMMITMENT }),
    });
    expect(evidenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceType: "task_deliverable" }),
      })
    );
  });
});