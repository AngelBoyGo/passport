import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassportClient } from "../client.js";
import { withPassportAudit, classifyExecutionError } from "../middleware/audit.js";

describe("SDK Audit Interceptor (withPassportAudit)", () => {
  let client: PassportClient;
  const postEvidenceMock = vi.fn();
  const signEvidenceMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PassportClient({ apiKey: "pp_test", baseUrl: "https://passport.test" });
    client.postEvidence = postEvidenceMock;
    client.signEvidence = signEvidenceMock;
  });

  it("transparently wraps an async function and returns its result", async () => {
    const rawFn = async (a: number, b: number) => a + b;
    const audited = withPassportAudit(rawFn, {
      client,
      subjectCommitment: "a".repeat(64),
    });

    const result = await audited(3, 4);
    expect(result).toBe(7);
  });

  it("signs and posts evidence when signDigest is provided on success", async () => {
    signEvidenceMock.mockResolvedValue({
      signature: "sig128",
      digest: "digest64",
    });
    postEvidenceMock.mockResolvedValue({ event_commitment_hash: "hash64" });

    const auditCallback = vi.fn();
    const rawFn = async (text: string) => text.toUpperCase();

    const audited = withPassportAudit(rawFn, {
      client,
      subjectCommitment: "b".repeat(64),
      signDigest: (d) => `signed-${d}`,
      onAuditComplete: auditCallback,
    });

    const output = await audited("hello");
    expect(output).toBe("HELLO");

    expect(signEvidenceMock).toHaveBeenCalledOnce();
    expect(postEvidenceMock).toHaveBeenCalledWith(
      "b".repeat(64),
      "task_deliverable",
      expect.objectContaining({
        digest: expect.any(String),
      }),
      "sig128",
      expect.anything()
    );
    expect(auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCommitmentHash: "hash64",
        latencyMs: expect.any(Number),
      })
    );
  });

  it("classifies error tranche and re-throws when function fails", async () => {
    signEvidenceMock.mockResolvedValue({ signature: "err-sig" });
    postEvidenceMock.mockResolvedValue({ event_commitment_hash: "err-hash" });

    const rawFn = async () => {
      throw new Error("Timeout: rate limit exceeded 429");
    };

    const audited = withPassportAudit(rawFn, {
      client,
      subjectCommitment: "c".repeat(64),
      signDigest: () => "sig",
    });

    await expect(audited()).rejects.toThrow(/rate limit/i);
    expect(postEvidenceMock).toHaveBeenCalledWith(
      "c".repeat(64),
      "task_deliverable",
      expect.objectContaining({
        error_classification: "COMPUTE_TIMEOUT",
      }),
      "err-sig",
      expect.anything()
    );
  });

  it("classifyExecutionError accurately maps common LLM exceptions", () => {
    expect(classifyExecutionError("Model execution timed out after 30000ms")).toBe("COMPUTE_TIMEOUT");
    expect(classifyExecutionError("Zod schema validation failed for parameter")).toBe("LOGIC_DETECTION");
    expect(classifyExecutionError("Unknown upstream network disconnect")).toBe("SLA_BREACH");
  });
});
