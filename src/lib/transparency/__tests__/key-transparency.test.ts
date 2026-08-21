import { describe, it, expect, beforeEach } from "vitest";
import {
  getKeyTransparencyLog,
  verifyReceiptOffline,
} from "@/lib/transparency/key-log";
import { signReceipt } from "@/lib/receipt/signer";

describe("Public Key Transparency Log & Zero-Dependency Offline Verifier Kit (Section 2.3)", () => {
  beforeEach(() => {
    process.env.SIGNING_PRIVATE_KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  });

  describe("getKeyTransparencyLog", () => {
    it("returns an append-only log with kid, validity windows, and tamper-evident commitments", () => {
      const log = getKeyTransparencyLog();
      expect(log.log_version).toBe("1.0");
      expect(log.entries).toBeInstanceOf(Array);
      expect(log.entries.length).toBeGreaterThan(0);

      const activeEntry = log.entries[0];
      expect(activeEntry).toHaveProperty("kid");
      expect(activeEntry).toHaveProperty("public_key");
      expect(activeEntry).toHaveProperty("valid_from");
      expect(activeEntry).toHaveProperty("commitment");
      expect(activeEntry.status).toBe("active");
    });
  });

  describe("verifyReceiptOffline", () => {
    it("independently verifies a genuine signed receipt offline with zero network calls", async () => {
      const draft = {
        receipt_id: "rcpt_offline_1",
        issued_at: new Date().toISOString(),
        operator_id: "op_cus_123",
        agent_id: "agent_456",
        receipt_type: "competence" as const,
        status: "success" as const,
        input_digest: "a".repeat(64),
        authority_scope: "code.review",
        expiry: new Date(Date.now() + 86400_000).toISOString(),
        revocation_status: "active" as const,
        output_hash: "b".repeat(64),
        content_hash: "",
      };

      const signed = await signReceipt(draft);
      const result = await verifyReceiptOffline(signed);

      expect(result.valid).toBe(true);
      expect(result.contentHash).toBe(signed.content_hash);
      expect(result.matchesSignature).toBe(true);
    });

    it("detects tampering in an offline verification without contacting Passport server", async () => {
      const draft = {
        receipt_id: "rcpt_offline_2",
        issued_at: new Date().toISOString(),
        operator_id: "op_cus_123",
        agent_id: "agent_456",
        receipt_type: "competence" as const,
        status: "success" as const,
        input_digest: "a".repeat(64),
        authority_scope: "code.review",
        expiry: new Date(Date.now() + 86400_000).toISOString(),
        revocation_status: "active" as const,
        output_hash: "b".repeat(64),
        content_hash: "",
      };

      const signed = await signReceipt(draft);
      const tampered = { ...signed, output_hash: "c".repeat(64) };

      const result = await verifyReceiptOffline(tampered);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/tamper|hash mismatch/i);
    });
  });
});
