import { describe, it, expect } from "vitest";
import {
  parseIssueReceiptBody,
  parseFinalizeReceiptBody,
} from "@/lib/validation/receiptSchemas";
import { OperationalDomain, ErrorTranche } from "@prisma/client";
import { sha256Hex } from "@/lib/receipt/canonical";

describe("parseIssueReceiptBody", () => {
  const validBase = {
    agent_id: "agent_1",
    receipt_type: "competence",
    input_digest: sha256Hex("input"),
    authority_scope: "example.com",
    expiry: "2026-12-31T00:00:00.000Z",
  };

  it("defaults missing domain to SYSTEM_INTEGRATION", () => {
    const result = parseIssueReceiptBody(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe(OperationalDomain.SYSTEM_INTEGRATION);
    }
  });

  it("accepts a valid domain enum value", () => {
    const result = parseIssueReceiptBody({
      ...validBase,
      domain: OperationalDomain.FINANCIAL_CLEARING,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe(OperationalDomain.FINANCIAL_CLEARING);
    }
  });

  it("rejects an invalid domain string", () => {
    const result = parseIssueReceiptBody({
      ...validBase,
      domain: "NOT_A_DOMAIN",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseFinalizeReceiptBody", () => {
  it("defaults missing error_tranche to NONE", () => {
    const result = parseFinalizeReceiptBody({
      status: "refusal",
      refusal_reason: sha256Hex("policy"),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error_tranche).toBe(ErrorTranche.NONE);
    }
  });

  it("defaults error_tranche to NONE when status is success", () => {
    const result = parseFinalizeReceiptBody({
      status: "success",
      output_hash: sha256Hex("output"),
      error_tranche: ErrorTranche.DATA_LEAKAGE,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error_tranche).toBe(ErrorTranche.NONE);
    }
  });

  it("accepts a valid error_tranche enum value for non-success", () => {
    const result = parseFinalizeReceiptBody({
      status: "failure_tombstone",
      terminal_reason: sha256Hex("crash"),
      error_tranche: ErrorTranche.COMPUTE_TIMEOUT,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error_tranche).toBe(ErrorTranche.COMPUTE_TIMEOUT);
    }
  });

  it("rejects an invalid error_tranche string", () => {
    const result = parseFinalizeReceiptBody({
      status: "refusal",
      refusal_reason: sha256Hex("policy"),
      error_tranche: "BOGUS_TRANCHE",
    });
    expect(result.success).toBe(false);
  });
});
