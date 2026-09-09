import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    agentEnrollment: { findFirst: vi.fn() },
    agentEvidence: { count: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/receipt/signer", () => ({ getPublicKeyHex: vi.fn(() => "pubkey") }));

describe("GET /.well-known/agent-card.json (alternate agent card endpoint)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://passport.metis.gold";
  });

  it("serves the same canonical card as agent.json", async () => {
    prismaMock.agentEnrollment.findFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/.well-known/agent-card.json/route");
    const request = new Request("https://passport.metis.gold/.well-known/agent-card.json");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const card = await response.json();
    expect(card.name).toBe("Passport");
    expect(card.license).toBe("MIT");
    expect(card.open_source).toBe(true);
    expect(card.url).toBe("https://passport.metis.gold");
    expect(card.llms_txt).toBe("https://passport.metis.gold/llms.txt");
    expect(card.capabilities).toBeInstanceOf(Array);
    expect(card.capabilities.length).toBeGreaterThan(0);
    expect(card.sdks).toBeInstanceOf(Array);
  });
});