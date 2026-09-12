import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { keygen, sign } from "@noble/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    authenticateApiKey: vi.fn(),
    agentFindFirst: vi.fn(),
    escrowFindUnique: vi.fn(),
    railFindUnique: vi.fn(),
    enrollmentFindUnique: vi.fn(),
    nonceCreate: vi.fn(),
  },
}));

vi.mock("@/lib/operator", () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock("@/lib/db", () => ({
  prisma: {
    agent: { findFirst: mocks.agentFindFirst },
    commodityEscrow: { findUnique: mocks.escrowFindUnique },
    railSpec: { findUnique: mocks.railFindUnique },
    agentEnrollment: { findUnique: mocks.enrollmentFindUnique },
    agentIntentNonce: { create: mocks.nonceCreate },
  },
}));

import {
  authorizeResource,
  verifyAgentIntent,
  canonicalIntentPayload,
  AGENT_INTENT_MAX_TTL_MS,
  type AgentIntent,
} from "../authorize";

const AGENT = "a".repeat(64);
const OTHER = "b".repeat(64);

function req(auth = "Bearer pp_usr_x") {
  return new NextRequest("https://passport.metis.gold/api/v1/reserves/amm/swap", {
    method: "POST",
    headers: { authorization: auth },
  });
}

describe("authorizeResource (object-level authorization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "HOLDER" });
  });

  it("rejects an unauthenticated caller (401)", async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const r = await authorizeResource(req(), { kind: "agent", id: AGENT });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("lets an ISSUER bypass ownership entirely", async () => {
    mocks.authenticateApiKey.mockResolvedValue({ id: "op_1", apiKeyRole: "ISSUER" });
    const r = await authorizeResource(req(), { kind: "agent", id: AGENT });
    expect(r).toMatchObject({ ok: true, role: "ISSUER" });
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();
  });

  it("agent: HOLDER owns vs does not own", async () => {
    mocks.agentFindFirst.mockResolvedValue({ id: "agent_1" });
    expect(await authorizeResource(req(), { kind: "agent", id: AGENT })).toMatchObject({ ok: true });
    mocks.agentFindFirst.mockResolvedValue(null);
    expect(await authorizeResource(req(), { kind: "agent", id: AGENT })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("escrow: only a party may act; missing escrow → 404", async () => {
    mocks.escrowFindUnique.mockResolvedValue({
      escrowId: "e1",
      buyerCommitment: AGENT,
      sellerCommitment: OTHER,
    });
    mocks.agentFindFirst.mockResolvedValueOnce({ id: "agent_1" }); // owns buyer
    expect(await authorizeResource(req(), { kind: "escrow", id: "e1" })).toMatchObject({ ok: true });

    mocks.agentFindFirst.mockResolvedValue(null); // owns neither
    expect(await authorizeResource(req(), { kind: "escrow", id: "e1" })).toMatchObject({
      ok: false,
      status: 403,
    });

    mocks.escrowFindUnique.mockResolvedValue(null);
    expect(await authorizeResource(req(), { kind: "escrow", id: "e1" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("rail: only the authorizing operator may act", async () => {
    mocks.railFindUnique.mockResolvedValue({ railKey: "rail-1", authorizedBy: "op_1" });
    expect(await authorizeResource(req(), { kind: "rail", id: "rail-1" })).toMatchObject({ ok: true });

    mocks.railFindUnique.mockResolvedValue({ railKey: "rail-1", authorizedBy: "op_other" });
    expect(await authorizeResource(req(), { kind: "rail", id: "rail-1" })).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("verifyAgentIntent (signed agent intents)", () => {
  const kp = keygen();
  const agentCommitment = AGENT;

  function makeIntent(overrides: Partial<AgentIntent> = {}): AgentIntent {
    const base: Omit<AgentIntent, "signature"> = {
      action: "amm.swap",
      agent_commitment: agentCommitment,
      resource_kind: "agent",
      resource_id: agentCommitment,
      params: { pool_id: "POOL-1", input_token: "ANGEL", input_amount: 10 },
      nonce: `nonce-${Math.random().toString(36).slice(2)}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const merged = { ...base, ...overrides };
    const signature = bytesToHex(sign(utf8ToBytes(canonicalIntentPayload(merged)), kp.secretKey));
    return { ...merged, signature } as AgentIntent;
  }

  function verify(intent: unknown) {
    return verifyAgentIntent({
      intent,
      expectAction: "amm.swap",
      expectResource: { kind: "agent", id: agentCommitment },
      expectParams: { pool_id: "POOL-1", input_token: "ANGEL", input_amount: 10 },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enrollmentFindUnique.mockResolvedValue({
      publicKey: bytesToHex(kp.publicKey),
      status: "ISSUED",
    });
    mocks.nonceCreate.mockResolvedValue({ id: "n_1" });
  });

  it("accepts a correctly signed, well-formed intent", async () => {
    const r = await verify(makeIntent());
    expect(r).toMatchObject({ ok: true, agentCommitment });
    expect(mocks.nonceCreate).toHaveBeenCalledOnce();
  });

  it("rejects a tampered param (signature no longer binds)", async () => {
    const intent = makeIntent();
    intent.params = { ...intent.params, input_amount: 9999 };
    const r = await verify(intent);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(mocks.nonceCreate).not.toHaveBeenCalled();
  });

  it("rejects an intent whose params do not match the operation", async () => {
    const r = await verify(makeIntent({ params: { pool_id: "OTHER", input_token: "ANGEL", input_amount: 10 } }));
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("pool_id") });
  });

  it("rejects an expired intent", async () => {
    const r = await verify(makeIntent({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("expired") });
  });

  it("rejects an intent with an excessive TTL", async () => {
    const r = await verify(
      makeIntent({ expires_at: new Date(Date.now() + AGENT_INTENT_MAX_TTL_MS * 10).toISOString() })
    );
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("TTL") });
  });

  it("rejects a replayed nonce (DB-unique)", async () => {
    mocks.nonceCreate.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const r = await verify(makeIntent());
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("replay") });
  });

  it("rejects an unenrolled agent", async () => {
    mocks.enrollmentFindUnique.mockResolvedValue(null);
    const r = await verify(makeIntent());
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("not enrolled") });
  });

  it("rejects a signature by a different key", async () => {
    const other = keygen();
    const intent = makeIntent();
    intent.signature = bytesToHex(sign(utf8ToBytes("something else"), other.secretKey));
    const r = await verify(intent);
    expect(r).toMatchObject({ ok: false, status: 403, error: expect.stringContaining("signature") });
  });

  it("rejects a missing intent", async () => {
    const r = await verify(undefined);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
