import { describe, it, expect } from "vitest";
import {
  buildCanonicalPayload,
  computeContentHash,
  sha256Hex,
} from "@/lib/receipt/canonical";
import { signReceipt, getPublicKeyHex } from "@/lib/receipt/signer";
import { verifyReceipt, verifySignature } from "@/lib/receipt/verify";
import type { ReceiptPayload } from "@/lib/receipt/types";

function baseReceipt(overrides: Partial<ReceiptPayload> = {}): ReceiptPayload {
  const content = {
    receipt_id: "rcpt_test_001",
    issued_at: "2026-06-13T12:00:00.000Z",
    operator_id: "op_stripe_cus_abc",
    agent_id: "agent_fulfillment_1",
    receipt_type: "competence" as const,
    status: "pending" as const,
    input_digest: sha256Hex("task context payload"),
    authority_scope: "fulfillment.example.com",
    expiry: "2026-07-13T12:00:00.000Z",
    revocation_status: "active" as const,
    prev_receipt_hash: undefined,
    ...overrides,
  };
  const content_hash = computeContentHash(content);
  return { ...content, content_hash };
}

describe("typed receipt signing", () => {
  it("signs a pending competence receipt", async () => {
    const payload = baseReceipt();
    const signed = await signReceipt(payload);
    expect(signed.signature).toBeDefined();
    expect(signed.signature!.length).toBeGreaterThan(0);
    expect(await verifySignature(signed)).toBe(true);
  });

  it("signs custody receipts separately from competence", async () => {
    const custody = await signReceipt(
      baseReceipt({ receipt_type: "custody" })
    );
    const competence = await signReceipt(
      baseReceipt({ receipt_id: "rcpt_test_002", receipt_type: "competence" })
    );
    expect(custody.signature).not.toBe(competence.signature);
  });

  it("publishes a stable public key from the private key", () => {
    const pub = getPublicKeyHex();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("refusal and terminal receipts", () => {
  it("signs a refusal receipt with refusal_reason", async () => {
    const payload = baseReceipt({
      status: "refusal",
      refusal_reason: sha256Hex("policy: out of scope"),
    });
    const signed = await signReceipt(payload);
    const result = await verifyReceipt(signed);
    expect(result.valid).toBe(true);
    expect(result.receipt?.status).toBe("refusal");
    expect(result.receipt?.refusal_reason).toBeDefined();
  });

  it("signs null receipts as first-class outcomes", async () => {
    const payload = baseReceipt({
      receipt_id: "rcpt_null_001",
      status: "null",
      refusal_reason: sha256Hex("declined: insufficient authority"),
    });
    const signed = await signReceipt(payload);
    expect((await verifyReceipt(signed)).valid).toBe(true);
  });

  it.each([
    ["graceful_shutdown", "agent completed cleanly"],
    ["timeout", "deadline exceeded"],
    ["failure_tombstone", "unrecoverable failure"],
  ] as const)("signs terminal state %s", async (status, reason) => {
    const payload = baseReceipt({
      receipt_id: `rcpt_${status}`,
      status,
      terminal_reason: sha256Hex(reason),
    });
    const signed = await signReceipt(payload);
    const result = await verifyReceipt(signed);
    expect(result.valid).toBe(true);
    expect(result.receipt?.status).toBe(status);
    expect(result.isTerminal).toBe(true);
  });
});

describe("output chaining", () => {
  it("chains receipts via prev_receipt_hash", async () => {
    const first = await signReceipt(baseReceipt({ receipt_id: "rcpt_chain_1" }));
    const firstFinal = await signReceipt({
      ...first,
      status: "success",
      output_hash: sha256Hex("completed output"),
    });

    const second = await signReceipt(
      baseReceipt({
        receipt_id: "rcpt_chain_2",
        prev_receipt_hash: firstFinal.content_hash,
      })
    );

    expect(second.prev_receipt_hash).toBe(firstFinal.content_hash);
    expect((await verifyReceipt(second)).valid).toBe(true);
  });

  it("detects chain gaps when prev_receipt_hash is missing", async () => {
    const { validateChain } = await import("@/lib/receipt/chain");
    const first = await signReceipt(baseReceipt({ receipt_id: "rcpt_gap_1" }));
    const firstFinal = await signReceipt({
      ...first,
      status: "success",
      output_hash: sha256Hex("out"),
    });
    const broken = await signReceipt(
      baseReceipt({
        receipt_id: "rcpt_gap_2",
        prev_receipt_hash: "deadbeef".repeat(8),
      })
    );
    const result = validateChain([firstFinal, broken]);
    expect(result.valid).toBe(false);
    expect(result.gapAt).toBe(1);
  });
});

describe("verification and tamper detection", () => {
  it("verifies sign -> finalize flow", async () => {
    const pending = await signReceipt(baseReceipt());
    const finalized = await signReceipt({
      ...pending,
      status: "success",
      output_hash: sha256Hex("agent response body"),
    });
    const result = await verifyReceipt(finalized);
    expect(result.valid).toBe(true);
    expect(result.receipt?.output_hash).toBeDefined();
  });

  it("rejects tampered input_digest", async () => {
    const signed = await signReceipt(baseReceipt());
    const tampered = {
      ...signed,
      input_digest: sha256Hex("different input"),
    };
    tampered.content_hash = computeContentHash(
      buildCanonicalPayload(tampered)
    );
    const result = await verifyReceipt(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature|tamper/i);
  });

  it("rejects tampered signature", async () => {
    const signed = await signReceipt(baseReceipt());
    signed.signature = "aa".repeat(64);
    const result = await verifyReceipt(signed);
    expect(result.valid).toBe(false);
  });

  it("rejects expired receipts", async () => {
    const expired = await signReceipt(
      baseReceipt({ expiry: "2020-01-01T00:00:00.000Z" })
    );
    const result = await verifyReceipt(expired);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expir/i);
  });

  it("rejects revoked receipts", async () => {
    const revoked = await signReceipt(
      baseReceipt({ revocation_status: "revoked" })
    );
    const result = await verifyReceipt(revoked);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/revok/i);
  });
});

describe("domain and error_tranche binding", () => {
  it("verifies a receipt signed with domain and error_tranche", async () => {
    const payload = baseReceipt({
      domain: "SYSTEM_INTEGRATION",
      error_tranche: "NONE",
      status: "success",
      output_hash: sha256Hex("output"),
    });
    const signed = await signReceipt(payload);
    const result = await verifyReceipt(signed);
    expect(result.valid).toBe(true);
    expect(result.receipt?.domain).toBe("SYSTEM_INTEGRATION");
    expect(result.receipt?.error_tranche).toBe("NONE");
  });

  it("rejects tampered domain after signing", async () => {
    const signed = await signReceipt(
      baseReceipt({ domain: "FINANCIAL_CLEARING" })
    );
    const tampered = { ...signed, domain: "CUSTOMER_SUPPORT" as const };
    tampered.content_hash = computeContentHash(buildCanonicalPayload(tampered));
    const result = await verifyReceipt(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature|tamper/i);
  });

  it("rejects tampered error_tranche after signing", async () => {
    const signed = await signReceipt(
      baseReceipt({
        domain: "CODE_GENERATION",
        error_tranche: "NONE",
        status: "success",
        output_hash: sha256Hex("out"),
      })
    );
    const tampered = { ...signed, error_tranche: "DATA_LEAKAGE" as const };
    tampered.content_hash = computeContentHash(buildCanonicalPayload(tampered));
    const result = await verifyReceipt(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature|tamper/i);
  });

  it("omitting domain and error_tranche reproduces legacy content_hash", () => {
    const legacyFields = {
      receipt_id: "rcpt_legacy_hash",
      issued_at: "2026-06-13T12:00:00.000Z",
      operator_id: "op_stripe_cus_abc",
      agent_id: "agent_fulfillment_1",
      receipt_type: "competence" as const,
      status: "pending" as const,
      input_digest: sha256Hex("task context payload"),
      authority_scope: "fulfillment.example.com",
      expiry: "2026-07-13T12:00:00.000Z",
      revocation_status: "active" as const,
    };
    const hashWithoutMetadata = computeContentHash(legacyFields);
    const hashWithUndefinedMetadata = computeContentHash({
      ...legacyFields,
      domain: undefined,
      error_tranche: undefined,
    });
    expect(hashWithUndefinedMetadata).toBe(hashWithoutMetadata);
  });
});
