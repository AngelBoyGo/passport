import { describe, it, expect } from "vitest";
import { verify, sign, getPublicKey } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import {
  canonicalJson,
  computePayloadDigest,
  signEvidencePayload,
  signHireRequest,
  generateAgentKeypair,
} from "@/lib/evidence/signing";

function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

describe("Evidence Signing Utility", () => {
  const { publicKeyHex, privateKeyHex } = generateAgentKeypair();

  describe("canonicalJson", () => {
    it("sorts keys alphabetically", () => {
      const result = canonicalJson({ b: 2, a: 1, c: 3 });
      expect(result).toBe('{"a":1,"b":2,"c":3}');
    });

    it("handles nested objects (does NOT recursively sort)", () => {
      const result = canonicalJson({ z: { y: 1, x: 2 }, a: 3 });
      expect(result).toBe('{"a":3,"z":{"y":1,"x":2}}');
    });

    it("produces compact JSON (no spaces)", () => {
      const result = canonicalJson({ key: "value" });
      expect(result).toBe('{"key":"value"}');
      expect(result).not.toContain(" ");
    });
  });

  describe("computePayloadDigest", () => {
    it("returns a 64-char hex string", () => {
      const digest = computePayloadDigest({ task_id: "test", digest: "abc" });
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic", () => {
      const payload = { task_id: "test", digest: "abc" };
      expect(computePayloadDigest(payload)).toBe(computePayloadDigest(payload));
    });

    it("matches server-side sourceDigest logic", () => {
      // Simulate what the server does
      const payload = { task_id: "test", digest: "abc", observed_at: "2026-01-01" };
      const serverDigest = bytesToHex(sha256(utf8ToBytes(canonicalJson(payload))));
      const clientDigest = computePayloadDigest(payload);
      expect(clientDigest).toBe(serverDigest);
    });
  });

  describe("signEvidencePayload", () => {
    it("returns digest and signature", () => {
      const payload = { task_id: "test-123", digest: sha256Hex("output") };
      const result = signEvidencePayload(payload, privateKeyHex);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it("signature verifies against the public key", async () => {
      const payload = { task_id: "verify-test", digest: sha256Hex("data") };
      const { digest, signature } = signEvidencePayload(payload, privateKeyHex);

      // Verify using the SAME logic as the server
      const valid = await verify(
        hexToBytes(signature),
        utf8ToBytes(digest), // UTF-8 bytes of the hex digest string
        hexToBytes(publicKeyHex)
      );
      expect(valid).toBe(true);
    });

    it("signature is over utf8ToBytes(digestHexString) NOT raw hex bytes", async () => {
      const payload = { task_id: "test", digest: "abc" };
      const { digest, signature } = signEvidencePayload(payload, privateKeyHex);

      // The server verifies against utf8ToBytes(digest) — UTF-8 encoding of hex string
      const utf8Message = utf8ToBytes(digest);
      const validUtf8 = await verify(hexToBytes(signature), utf8Message, hexToBytes(publicKeyHex));
      expect(validUtf8).toBe(true);

      // Raw hex-decoded bytes would be DIFFERENT and should FAIL
      const rawBytes = hexToBytes(digest);
      if (rawBytes.length !== utf8Message.length) {
        const validRaw = await verify(hexToBytes(signature), rawBytes, hexToBytes(publicKeyHex));
        expect(validRaw).toBe(false);
      }
    });
  });

  describe("signHireRequest", () => {
    it("returns digest and signature for A2A hire", () => {
      const result = signHireRequest(
        "proposal_123",
        "a".repeat(64),
        "b".repeat(64),
        { amount: 5, domain: "CODE_GENERATION", scope: "test", expiry: "2026-12-31" },
        privateKeyHex
      );
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it("hire signature verifies against the hirer's public key", async () => {
      const terms = { amount: 5, domain: "CODE_GENERATION", scope: "test", expiry: "2026-12-31" };
      const { signature } = signHireRequest(
        "prop_1", publicKeyHex, "b".repeat(64), terms, privateKeyHex
      );

      // Verify using the same message construction
      const canonicalTerms = canonicalJson(terms);
      const message = `prop_1:${publicKeyHex}:${"b".repeat(64)}:${canonicalTerms}`;
      const valid = await verify(
        hexToBytes(signature),
        utf8ToBytes(sha256Hex(message)), // The server verifies against utf8ToBytes of the hex digest
        hexToBytes(publicKeyHex)
      );
      expect(valid).toBe(true);
    });
  });

  describe("generateAgentKeypair", () => {
    it("generates valid Ed25519 keypairs", async () => {
      const kp = generateAgentKeypair();
      expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(kp.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);

      // Verify the keypair works for signing
      const msg = utf8ToBytes("test message");
      const sig = sign(msg, hexToBytes(kp.privateKeyHex));
      const valid = verify(sig, msg, hexToBytes(kp.publicKeyHex));
      expect(valid).toBe(true);
    });

    it("generates unique keypairs", () => {
      const kp1 = generateAgentKeypair();
      const kp2 = generateAgentKeypair();
      expect(kp1.publicKeyHex).not.toBe(kp2.publicKeyHex);
    });
  });
});