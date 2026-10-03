import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, schedAuthMock, authorizeMock, stageMock, agentFindFirstMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  schedAuthMock: vi.fn(),
  authorizeMock: vi.fn(),
  stageMock: vi.fn(),
  agentFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/operator", () => ({ authenticateApiKey: authenticateMock }));
vi.mock("@/lib/scheduler/auth", () => ({ isSchedulerAuthorized: schedAuthMock }));
vi.mock("@/lib/db", () => ({
  prisma: { agent: { findFirst: agentFindFirstMock } },
}));
vi.mock("@/lib/fleet/money-intent", () => ({
  authorizeMoneyMovement: authorizeMock,
  stageMoneyIntent: stageMock,
  MONEY_INTENT_KINDS: ["hire_agent", "treasury_transfer", "fund_compute"],
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  clientIpFromRequest: vi.fn(() => "127.0.0.1"),
  rateLimitResponse: vi.fn(),
}));

const { POST } = await import("@/app/api/v1/fleet/money-intent/route");

const COMMIT = "a".repeat(64);
const SIG = "b".repeat(128);

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("https://passport.test/api/v1/fleet/money-intent", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authenticateMock.mockReset();
  schedAuthMock.mockReset();
  authorizeMock.mockReset();
  stageMock.mockReset();
  agentFindFirstMock.mockReset();
});

describe("money-intent route — stage", () => {
  it("rejects anonymous staging (401)", async () => {
    authenticateMock.mockResolvedValue(null);
    schedAuthMock.mockReturnValue(false);
    const res = await POST(post({ action: "stage", intent_kind: "hire_agent", amount_angels: 5 }));
    expect(res.status).toBe(401);
    expect(stageMock).not.toHaveBeenCalled();
  });

  it("rejects a HOLDER key staging (401)", async () => {
    authenticateMock.mockResolvedValue({ apiKeyRole: "HOLDER" });
    schedAuthMock.mockReturnValue(false);
    const res = await POST(post({ action: "stage", intent_kind: "hire_agent", amount_angels: 5 }));
    expect(res.status).toBe(401);
  });

  it("scheduler secret stages a PENDING intent (201)", async () => {
    authenticateMock.mockResolvedValue(null);
    schedAuthMock.mockReturnValue(true);
    stageMock.mockResolvedValue({ ok: true, intentId: "mi_1", digest: "d".repeat(64) });
    const res = await POST(post({ action: "stage", intent_kind: "hire_agent", worker_commitment: COMMIT, amount_angels: 12 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("PENDING");
    expect(data.intent_id).toBe("mi_1");
  });

  it("rejects an unknown intent kind (400)", async () => {
    authenticateMock.mockResolvedValue({ apiKeyRole: "ISSUER" });
    schedAuthMock.mockReturnValue(false);
    const res = await POST(post({ action: "stage", intent_kind: "dark_pool", amount_angels: 5 }));
    expect(res.status).toBe(400);
    expect(stageMock).not.toHaveBeenCalled();
  });
});

describe("money-intent route — authorize", () => {
  it("rejects a non-owner commitment (403)", async () => {
    authenticateMock.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    agentFindFirstMock.mockResolvedValue(null);
    const res = await POST(post({ action: "authorize", intent_id: "mi_1", verifier_commitment: COMMIT, signature: SIG }));
    expect(res.status).toBe(403);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it("owner + money-tier signature authorizes (200)", async () => {
    authenticateMock.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    agentFindFirstMock.mockResolvedValue({ id: "agent_row" });
    authorizeMock.mockResolvedValue({ ok: true, reason: "authorized:mi_1" });
    const res = await POST(post({ action: "authorize", intent_id: "mi_1", verifier_commitment: COMMIT, signature: SIG }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("AUTHORIZED");
    expect(authorizeMock).toHaveBeenCalledWith({
      intentId: "mi_1",
      verifierCommitment: COMMIT,
      signature: SIG,
    });
  });

  it("gate refusal (switch off / wrong tier / bad signature) surfaces as 403", async () => {
    authenticateMock.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    agentFindFirstMock.mockResolvedValue({ id: "agent_row" });
    authorizeMock.mockResolvedValue({ ok: false, reason: "money_movement_disabled" });
    const res = await POST(post({ action: "authorize", intent_id: "mi_1", verifier_commitment: COMMIT, signature: SIG }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("money_movement_disabled");
  });

  it("rejects malformed signature before any DB work (400)", async () => {
    authenticateMock.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
    const res = await POST(post({ action: "authorize", intent_id: "mi_1", verifier_commitment: COMMIT, signature: "short" }));
    expect(res.status).toBe(400);
    expect(agentFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("money-intent route — misc", () => {
  it("unknown action → 400", async () => {
    authenticateMock.mockResolvedValue({ apiKeyRole: "ISSUER" });
    schedAuthMock.mockReturnValue(false);
    const res = await POST(post({ action: "execute" }));
    expect(res.status).toBe(400);
  });
});
