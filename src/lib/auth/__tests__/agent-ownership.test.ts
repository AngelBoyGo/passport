import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authenticateApiKey: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/operator", () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock("@/lib/db", () => ({ prisma: { agent: { findFirst: mocks.findFirst } } }));

import { authorizeAgentCommitment } from "../agent-ownership";

const COMMITMENT = "a".repeat(64);
function req(auth: string | null = "Bearer pp_usr_x") {
  return new NextRequest("https://passport.metis.gold/api/v1/reserves/amm/swap", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("authorizeAgentCommitment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated caller (401)", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const r = await authorizeAgentCommitment(req(null), COMMITMENT);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("allows an ISSUER key to act on any commitment", async () => {
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "ISSUER" });
    const r = await authorizeAgentCommitment(req(), COMMITMENT);
    expect(r).toMatchObject({ ok: true, role: "ISSUER" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("allows a HOLDER key only when it owns the agent commitment", async () => {
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    mocks.findFirst.mockResolvedValue({ id: "agent_1" });
    const r = await authorizeAgentCommitment(req(), COMMITMENT);
    expect(r).toMatchObject({ ok: true, role: "HOLDER" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { operatorId: "op_1", agentId: COMMITMENT },
      select: { id: true },
    });
  });

  it("rejects a HOLDER key acting on a commitment it does not own (403)", async () => {
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    mocks.findFirst.mockResolvedValue(null);
    const r = await authorizeAgentCommitment(req(), COMMITMENT);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});
