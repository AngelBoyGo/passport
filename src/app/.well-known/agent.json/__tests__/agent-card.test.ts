import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findFirst: vi.fn() },
    agentEvidence: { count: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/receipt/signer", () => ({ getPublicKeyHex: vi.fn(() => "pubkey") }));

describe("GET /.well-known/agent.json (A2A Agent Card)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("returns the Agent Card with correct structure", async () => {
    prismaMock.agentEnrollment.findFirst.mockResolvedValue({
      subjectCommitment: "87cfa2bfe15782572d40b0669d83504be9409b0475c91db646ec694f279ca2f6",
      publicKey: "09d187ff5c5d2fbea1ff2edf8f9e8b3307385a67f5fb12614f1f2ba8e5babee7",
    });
    prismaMock.agentEvidence.count.mockResolvedValue(5);
    const { GET } = await import("@/app/.well-known/agent.json/route");
    const request = new Request("https://passport.metis.gold/.well-known/agent.json");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const card = await response.json();
    expect(card).toHaveProperty("name", "Passport");
    expect(card).toHaveProperty("description");
    expect(card).toHaveProperty("url", "https://passport.metis.gold");
    expect(card).toHaveProperty("capabilities");
    expect(card.capabilities).toBeInstanceOf(Array);
    expect(card.capabilities.length).toBeGreaterThan(0);
    expect(card).toHaveProperty("agent_card_version", "1.0");
  });

  it("includes a sample agent entry from the DB", async () => {
    prismaMock.agentEnrollment.findFirst.mockResolvedValue({
      subjectCommitment: "def456",
      publicKey: "abc123",
    });
    prismaMock.agentEvidence.count.mockResolvedValue(3);

    const { GET } = await import("@/app/.well-known/agent.json/route");
    const request = new Request("https://passport.metis.gold/.well-known/agent.json");
    const response = await GET(request);
    const card = await response.json();

    expect(card.sample_agent).toBeDefined();
    expect(card.sample_agent.subject_commitment).toBe("def456");
    expect(card.sample_agent.public_key).toBe("abc123");
    expect(card.sample_agent.evidence_count).toBe(3);
  });

  it("returns 200 even when no enrolled agents exist", async () => {
    prismaMock.agentEnrollment.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/.well-known/agent.json/route");
    const request = new Request("https://passport.metis.gold/.well-known/agent.json");
    const response = await GET(request);
    expect(response.status).toBe(200);
    const card = await response.json();
    expect(card.sample_agent).toBeNull();
  });
});