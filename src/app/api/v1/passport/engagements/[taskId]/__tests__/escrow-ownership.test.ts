import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authenticateApiKeyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
}));

const acceptEngagementMock = vi.hoisted(() => vi.fn());
const cancelEngagementMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  engagement: { findUnique: vi.fn() },
  agent: { findFirst: vi.fn() },
}));

vi.mock("@/lib/engagement/engagement-service", () => ({
  acceptEngagement: (...a: unknown[]) => acceptEngagementMock(...a),
  cancelEngagement: (...a: unknown[]) => cancelEngagementMock(...a),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

describe("Escrow payout ownership authorization (Loop 37 — CRITICAL)", () => {
  const taskId = "task_esc_1";
  const callerOp = { id: "op_caller", apiKeyRole: "ISSUER" };
  const adminOp = { id: "op_admin", email: "admin@x.test", apiKeyRole: "ISSUER" };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_OPERATOR_EMAILS = "admin@x.test";
    // Engagement whose escrow belongs to commitments owned by op_owner.
    prismaMock.engagement.findUnique.mockResolvedValue({
      id: "row1",
      taskId,
      status: "HELD",
      amount: 500,
      hirerCommitment: "h".repeat(64),
      workerCommitment: "w".repeat(64),
    });
    // The caller owns an Agent row matching the WORKER commitment.
    prismaMock.agent.findFirst.mockResolvedValue({ id: "agent_row" });
  });

  describe("POST /api/v1/passport/engagements/:taskId/accept", () => {
    it("rejects a caller that is NOT the worker or an executive admin (403)", async () => {
      authenticateApiKeyMock.mockResolvedValue(callerOp);
      // Caller owns nothing related to this engagement.
      prismaMock.agent.findFirst.mockResolvedValue(null);

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/accept/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/accept`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_ent_key" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(403);
      expect(acceptEngagementMock).not.toHaveBeenCalled();
    });

    it("allows the worker-owned caller to accept", async () => {
      authenticateApiKeyMock.mockResolvedValue(callerOp);
      acceptEngagementMock.mockResolvedValue({ ok: true });

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/accept/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/accept`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_ent_key" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(200);
      expect(acceptEngagementMock).toHaveBeenCalledWith(taskId, { settleOnChain: false });
    });

    it("allows an executive admin to accept on behalf of parties", async () => {
      authenticateApiKeyMock.mockResolvedValue(adminOp);
      prismaMock.agent.findFirst.mockResolvedValue(null);
      acceptEngagementMock.mockResolvedValue({ ok: true });

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/accept/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/accept`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_ent_admin" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(200);
      expect(acceptEngagementMock).toHaveBeenCalled();
    });

    it("returns 404 when the task does not exist", async () => {
      authenticateApiKeyMock.mockResolvedValue(callerOp);
      prismaMock.engagement.findUnique.mockResolvedValue(null);

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/accept/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/accept`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_key" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/passport/engagements/:taskId/cancel", () => {
    it("rejects a caller that is neither hirer nor worker nor admin (403)", async () => {
      authenticateApiKeyMock.mockResolvedValue(callerOp);
      prismaMock.agent.findFirst.mockResolvedValue(null);

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/cancel/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_key" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(403);
      expect(cancelEngagementMock).not.toHaveBeenCalled();
    });

    it("allows a participant-owned caller to cancel", async () => {
      authenticateApiKeyMock.mockResolvedValue(callerOp);
      cancelEngagementMock.mockResolvedValue({ taskId, status: "CANCELLED" });

      const { POST } = await import("@/app/api/v1/passport/engagements/[taskId]/cancel/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/passport/engagements/${taskId}/cancel`, {
        method: "POST",
        headers: { Authorization: "Bearer pp_key" },
      });
      const res = await POST(req, { params: Promise.resolve({ taskId }) });

      expect(res.status).toBe(200);
      expect(cancelEngagementMock).toHaveBeenCalledWith(taskId);
    });
  });
});
