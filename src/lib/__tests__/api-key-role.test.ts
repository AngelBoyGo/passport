import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    apiKey: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { authenticateApiKey } from "@/lib/operator";
import { hashApiKey } from "@/lib/operator";

describe("API-key role resolution (C4 + F7 backfill downgrade)", () => {
  const operator = { id: "op_1", stripeCustomerId: "cus_1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("honors a persisted HOLDER role", async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({ role: "HOLDER", operator });
    const result = await authenticateApiKey("Bearer pp_usr_ab");
    expect(result!.apiKeyRole).toBe("HOLDER");
  });

  it("honors a persisted ISSUER role for a pp_ent_ key", async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({ role: "ISSUER", operator });
    const result = await authenticateApiKey("Bearer pp_ent_ab");
    expect(result!.apiKeyRole).toBe("ISSUER");
  });

  it("downgrades a legacy pp_usr_-prefixed key to HOLDER even if the stored row says ISSUER (F7)", async () => {
    // Pre-column backfill: row defaulted to ISSUER, but the presented key is a
    // Holder (pp_usr_) key. It must NOT escalate to Issuer privileges.
    prismaMock.apiKey.findUnique.mockResolvedValue({ role: "ISSUER", operator });
    const result = await authenticateApiKey("Bearer pp_usr_deadbeef");
    expect(result!.apiKeyRole).toBe("HOLDER");
  });

  it("never wrongly downgrades a minted ISSUER key (pp_ent_ keys stay ISSUER)", async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({ role: "ISSUER", operator });
    const result = await authenticateApiKey("Bearer pp_ent_cafe");
    expect(result!.apiKeyRole).toBe("ISSUER");
  });

  it("returns null for an unknown key", async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(null);
    const result = await authenticateApiKey("Bearer pp_ent_unknown");
    expect(result).toBeNull();
  });
});