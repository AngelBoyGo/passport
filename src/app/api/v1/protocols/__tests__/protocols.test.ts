import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    engagement: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    agentEnrollment: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    agent: {
      findFirst: vi.fn(),
    },
    capabilityLedgerEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    operator: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/operator", () => ({
  authenticateApiKey: vi.fn(async (auth: string | null) => {
    if (auth === "Bearer pp_valid_key") {
      return { id: "op_123", email: "test@example.com" };
    }
    return null;
  }),
}));
vi.mock("@/lib/receipt/signer", () => ({
  getPublicKeyHex: vi.fn(() => "54b38000c534187cfd5fc6d3a41a8614e7c59ef67d83078b5aa18d2374b4f081"),
}));
vi.mock("@/lib/admin/admin-auth", () => ({
  isExecutiveAdmin: vi.fn(() => false),
}));
vi.mock("@/lib/engagement/engagement-service", () => ({
  createEngagement: vi.fn(async (input: { taskId: string; hirerCommitment: string; workerCommitment: string; amount: number }) => ({
    taskId: input.taskId,
    hirerCommitment: input.hirerCommitment,
    workerCommitment: input.workerCommitment,
    amount: input.amount,
    status: "HELD",
    deliverableDigest: null,
    evidenceEventHash: null,
    receiptId: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  acceptEngagement: vi.fn(async (taskId: string) => ({
    engagement: { taskId, status: "PAID", paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    payout: null,
    receipt_id: "rcpt_acp_1",
  })),
}));

describe("Protocol Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  describe("A2A Protocol (JSON-RPC 2.0 over HTTP)", () => {
    it("handles tasks/send JSON-RPC method", async () => {
      prismaMock.engagement.create.mockResolvedValue({
        taskId: "a2a-task-001",
        hirerCommitment: "a".repeat(64),
        workerCommitment: "b".repeat(64),
        amount: 500,
        status: "HELD",
      });

      const { POST } = await import("@/app/api/v1/a2a/tasks/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/a2a/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pp_valid_key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-1",
          method: "tasks/send",
          params: {
            task_id: "a2a-task-001",
            hirer_commitment: "a".repeat(64),
            worker_commitment: "b".repeat(64),
            amount: 500,
            description: "Translate document to Spanish",
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jsonrpc).toBe("2.0");
      expect(data.id).toBe("req-1");
      expect(data.result.task_id).toBe("a2a-task-001");
      expect(data.result.status).toBe("held");
    });

    it("handles tasks/get JSON-RPC method", async () => {
      prismaMock.agent.findFirst.mockResolvedValue({ id: "agent_row" }); // caller is a participant
      prismaMock.engagement.findUnique.mockResolvedValue({
        taskId: "a2a-task-001",
        status: "DELIVERED",
        amount: 500,
        deliverableDigest: "c".repeat(64),
        receiptId: "rcpt_999",
      });

      const { POST } = await import("@/app/api/v1/a2a/tasks/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/a2a/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pp_valid_key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-2",
          method: "tasks/get",
          params: { task_id: "a2a-task-001" },
        }),
      });

      const res = await POST(req);
      const data = await res.json();
      expect(data.result.status).toBe("delivered");
      expect(data.result.receipt_id).toBe("rcpt_999");
    });

    it("hides delivery proof from non-participants (Loop 37)", async () => {
      prismaMock.agent.findFirst.mockResolvedValue(null); // caller owns no party
      prismaMock.engagement.findUnique.mockResolvedValue({
        taskId: "a2a-task-002",
        status: "DELIVERED",
        amount: 500,
        deliverableDigest: "d".repeat(64),
        receiptId: "rcpt_secret",
      });

      const { POST } = await import("@/app/api/v1/a2a/tasks/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/a2a/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pp_valid_key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-3",
          method: "tasks/get",
          params: { task_id: "a2a-task-002" },
        }),
      });

      const res = await POST(req);
      const data = await res.json();
      expect(data.result.status).toBe("delivered");
      expect(data.result.receipt_id).toBeUndefined();
      expect(data.result.deliverable_digest).toBeUndefined();
      expect(data.result.amount).toBeUndefined();
    });

    it("rejects unauthenticated A2A requests (C3)", async () => {
      const { POST } = await import("@/app/api/v1/a2a/tasks/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/a2a/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-anon",
          method: "tasks/send",
          params: {
            task_id: "a2a-anon-001",
            hirer_commitment: "a".repeat(64),
            worker_commitment: "b".repeat(64),
            amount: 1,
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe(-32001);
      expect(prismaMock.engagement.create).not.toHaveBeenCalled();
    });
  });

  describe("ACP Protocol (Agent Communication Protocol)", () => {
    it("creates an ACP task via REST", async () => {
      prismaMock.engagement.create.mockResolvedValue({
        taskId: "acp-task-100",
        hirerCommitment: "a".repeat(64),
        workerCommitment: "b".repeat(64),
        amount: 250,
        status: "HELD",
      });

      const { POST } = await import("@/app/api/v1/acp/task/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/acp/task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pp_valid_key",
        },
        body: JSON.stringify({
          task_id: "acp-task-100",
          hirer_commitment: "a".repeat(64),
          worker_commitment: "b".repeat(64),
          amount: 250,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.acp_version).toBe("1.0");
      expect(data.status).toBe("held");
    });

    it("gets an ACP task status by taskId", async () => {
      prismaMock.engagement.findUnique.mockResolvedValue({
        taskId: "acp-task-100",
        status: "PAID",
        amount: 250,
        deliverableDigest: "f".repeat(64),
        evidenceEventHash: "e".repeat(64),
        receiptId: "rcpt_100",
        paidAt: new Date("2026-08-19T00:00:00.000Z"),
      });

      const { GET } = await import("@/app/api/v1/acp/task/[taskId]/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/acp/task/acp-task-100");
      const res = await GET(req, { params: Promise.resolve({ taskId: "acp-task-100" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.acp_version).toBe("1.0");
      expect(data.status).toBe("paid");
      expect(data.receipt_id).toBe("rcpt_100");
    });
  });

  describe("ANP Protocol (Agent Network Protocol / DIDs)", () => {
    it("returns an agent DID Document with Multikey verification methods", async () => {
      const commitment = "a".repeat(64);
      const pubkey = "b".repeat(64);
      prismaMock.agentEnrollment.findUnique.mockResolvedValue({
        subjectCommitment: commitment,
        publicKey: pubkey,
        status: "ISSUED",
        issuedAt: new Date("2026-08-19T00:00:00.000Z"),
      });

      const { GET } = await import("@/app/api/v1/anp/agents/[commitment]/route");
      const req = new NextRequest(`https://passport.metis.gold/api/v1/anp/agents/${commitment}`);
      const res = await GET(req, { params: Promise.resolve({ commitment }) });

      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v1");
      // did:key + Multikey must be valid base58btc multibase (starts with 'z'),
      // and the did must NOT the truncated hex scraps of the old buggy format.
      expect(doc.id.startsWith("did:key:z")).toBe(true);
      expect(doc.id.length).toBeGreaterThan(50);
      expect(doc.verificationMethod[0].type).toBe("Multikey");
      expect(doc.verificationMethod[0].publicKeyMultibase.startsWith("z")).toBe(true);
      expect(doc.verificationMethod[0].publicKeyMultibase).not.toBe(`z${pubkey}`);
      expect(doc.service.some((s: { type: string }) => s.type === "PassportAgentProfile")).toBe(true);
    });
  });

  describe("AGORA Protocol (Negotiation & Interaction)", () => {
    it("records a negotiation proposal", async () => {
      prismaMock.capabilityLedgerEntry.create.mockResolvedValue({
        id: "cap-1",
        operatorId: "agora",
        agentId: "a".repeat(64),
        eventType: "agora:offer",
        metadata: "{}",
        createdAt: new Date(),
      });

      const { POST } = await import("@/app/api/v1/agora/negotiate/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/agora/negotiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pp_valid_key",
        },
        body: JSON.stringify({
          proposal_id: "prop-001",
          from_commitment: "a".repeat(64),
          action: "offer",
          terms: { priceCents: 500, slaHours: 24 },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.agora_version).toBe("1.0");
      expect(data.proposal_id).toBe("prop-001");
      expect(data.status).toBe("proposed");
    });

    it("rejects UNAUTHENTICATED negotiation (H13)", async () => {
      const { POST } = await import("@/app/api/v1/agora/negotiate/route");
      const req = new NextRequest("https://passport.metis.gold/api/v1/agora/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: "prop-anon",
          from_commitment: "a".repeat(64),
          action: "offer",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(prismaMock.capabilityLedgerEntry.create).not.toHaveBeenCalled();
    });
  });
});
