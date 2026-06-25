import { describe, it, expect } from "vitest";
import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { computeContentHash, sha256Hex } from "@/lib/receipt/canonical";
import { signReceipt } from "@/lib/receipt/signer";
import { verifyReceipt } from "@/lib/receipt/verify";
import { dbReceiptToPayload } from "@/lib/receipt-service";
import type { ReceiptPayload } from "@/lib/receipt/types";

function successPayload(signed: ReceiptPayload): ReceiptPayload {
  return dbReceiptToPayload({
    receiptId: signed.receipt_id,
    issuedAt: new Date(signed.issued_at),
    operatorId: signed.operator_id,
    agentId: signed.agent_id,
    receiptType: signed.receipt_type,
    status: signed.status,
    inputDigest: signed.input_digest,
    authorityScope: signed.authority_scope,
    expiry: new Date(signed.expiry),
    revocationStatus: signed.revocation_status,
    outputHash: signed.output_hash ?? null,
    refusalReason: signed.refusal_reason ?? null,
    terminalReason: signed.terminal_reason ?? null,
    prevReceiptHash: signed.prev_receipt_hash ?? null,
    contentHash: signed.content_hash,
    signature: signed.signature ?? null,
    domain: (signed.domain as OperationalDomain | undefined) ?? null,
    domainCommitment: signed.domain_commitment ?? null,
    blindSalt: signed.blind_salt ?? null,
    errorTranche: ErrorTranche.NONE,
  });
}

describe("success receipt verify roundtrip", () => {
  it("verifies when finalize binds error_tranche NONE matching db default", async () => {
    const base = {
      receipt_id: "rcpt_roundtrip_001",
      issued_at: "2026-06-14T12:00:00.000Z",
      operator_id: "op_cus_passport_site_demo",
      agent_id: "demo-agent-1",
      receipt_type: "competence" as const,
      status: "success" as const,
      input_digest: sha256Hex("demo task"),
      authority_scope: "fulfillment.demo",
      expiry: "2026-07-14T12:00:00.000Z",
      revocation_status: "active" as const,
      output_hash: sha256Hex("shipped"),
      domain: "SYSTEM_INTEGRATION",
      error_tranche: ErrorTranche.NONE,
    };

    const content_hash = computeContentHash(base);
    const signed = await signReceipt({ ...base, content_hash });
    const fromDb = successPayload(signed);

    const result = await verifyReceipt(fromDb);
    expect(result.valid).toBe(true);
  });

  it("fails verify when db adds NONE but signature omitted error_tranche", async () => {
    const base = {
      receipt_id: "rcpt_roundtrip_002",
      issued_at: "2026-06-14T12:00:00.000Z",
      operator_id: "op_cus_passport_site_demo",
      agent_id: "demo-agent-1",
      receipt_type: "competence" as const,
      status: "success" as const,
      input_digest: sha256Hex("demo task"),
      authority_scope: "fulfillment.demo",
      expiry: "2026-07-14T12:00:00.000Z",
      revocation_status: "active" as const,
      output_hash: sha256Hex("shipped"),
      domain: "SYSTEM_INTEGRATION",
    };

    const content_hash = computeContentHash(base);
    const signed = await signReceipt({ ...base, content_hash });
    const fromDb = successPayload(signed);

    const result = await verifyReceipt(fromDb);
    expect(result.valid).toBe(false);
  });
});
