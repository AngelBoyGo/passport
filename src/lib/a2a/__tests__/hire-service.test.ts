import { describe, it, expect, vi } from "vitest";
import { hireWorker, type HireServiceDeps, type HireInput } from "@/lib/a2a/hire-service";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const HIRER = "a".repeat(64);
const WORKER = "b".repeat(64);
const PROPOSAL = "prop_abc12345";
const FUTURE = new Date(Date.now() + 86400000).toISOString();

function validInput(overrides: Partial<HireInput> = {}): HireInput {
  return {
    hirer_commitment: HIRER,
    worker_commitment: WORKER,
    proposal_id: PROPOSAL,
    terms: {
      amount: 100,
      domain: "CODE_GENERATION",
      scope: "Build a data pipeline for agent analytics",
      expiry: FUTURE,
    },
    signature: "c".repeat(128),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<HireServiceDeps> = {}): HireServiceDeps {
  return {
    verifySignature: vi.fn().mockResolvedValue(true),
    verifyGatePass: vi.fn().mockResolvedValue({ allow_invocation: true }),
    createEngagement: vi.fn().mockResolvedValue({ taskId: PROPOSAL, status: "HELD" }),
    findWorker: vi.fn().mockResolvedValue({ operatorId: "op_worker", commitment: WORKER, enrolled: true }),
    findHirer: vi.fn().mockResolvedValue({ operatorId: "op_hirer", commitment: HIRER, credits: 500 }),
    logAudit: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn(),
    isRateLimited: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe("hireWorker", () => {
  it("1. success: valid input creates engagement, returns hired", async () => {
    const deps = makeDeps();
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(true);
    expect(result.status).toBe("hired");
    expect(result.proposal_id).toBe(PROPOSAL);
    expect(result.engagement_id).toBe(PROPOSAL);
    expect(result.worker_trust_report_url).toContain(WORKER);
    expect(deps.createEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: PROPOSAL, amount: 100 })
    );
    expect(deps.logAudit).toHaveBeenCalled();
  });

  it("2. insufficient escrow: hirer with 0 credits returns insufficient_escrow", async () => {
    const deps = makeDeps({
      findHirer: vi.fn().mockResolvedValue({ operatorId: "op_hirer", commitment: HIRER, credits: 0 }),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("insufficient_escrow");
    expect(deps.createEngagement).not.toHaveBeenCalled();
  });

  it("3. gate denied: worker with low tier returns gate_denied", async () => {
    const deps = makeDeps({
      verifyGatePass: vi.fn().mockResolvedValue({ allow_invocation: false, reason: "SLA_BREACH_THRESHOLD_EXCEEDED" }),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("gate_denied");
    expect(deps.createEngagement).not.toHaveBeenCalled();
  });

  it("4. duplicate proposal: same proposal_id returns duplicate_proposal", async () => {
    const deps = makeDeps({
      createEngagement: vi.fn().mockRejectedValue(new Error("DuplicateEngagement")),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("duplicate_proposal");
  });

  it("5. invalid signature: wrong signature returns invalid_signature", async () => {
    const deps = makeDeps({
      verifySignature: vi.fn().mockResolvedValue(false),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("invalid_signature");
    expect(deps.createEngagement).not.toHaveBeenCalled();
  });

  it("6. self-hire: same commitment for both returns self_hire", async () => {
    const result = await hireWorker(validInput({ worker_commitment: HIRER }), makeDeps());
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("self_hire");
  });

  it("7. negative amount: returns negative_amount", async () => {
    const result = await hireWorker(validInput({ terms: { amount: -50, domain: "CODE_GENERATION", scope: "work", expiry: FUTURE } }), makeDeps());
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("negative_amount");
  });

  it("8. past expiry: returns past_expiry", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    const result = await hireWorker(validInput({ terms: { amount: 100, domain: "CODE_GENERATION", scope: "work", expiry: past } }), makeDeps());
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("past_expiry");
  });

  it("9. worker not found: unknown commitment returns worker_not_found", async () => {
    const deps = makeDeps({
      findWorker: vi.fn().mockResolvedValue(null),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("worker_not_found");
  });

  it("10. rate limited: too many requests returns rate_limited", async () => {
    const deps = makeDeps({
      isRateLimited: vi.fn().mockReturnValue(true),
    });
    const result = await hireWorker(validInput(), deps);
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("rate_limited");
  });
});