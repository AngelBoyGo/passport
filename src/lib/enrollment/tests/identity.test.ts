import { describe, it, expect } from "vitest";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
  generateChallengeNonce,
  isValidPublicKeyHex,
} from "@/lib/enrollment/identity";

describe("deriveAgentCommitment", () => {
  it("is deterministic for the same public key and context", () => {
    const pk = "a".repeat(64);
    const a = deriveAgentCommitment(pk, DEFAULT_ENROLLMENT_CONTEXT);
    const b = deriveAgentCommitment(pk, DEFAULT_ENROLLMENT_CONTEXT);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when context changes", () => {
    const pk = "b".repeat(64);
    const defaultCtx = deriveAgentCommitment(pk, DEFAULT_ENROLLMENT_CONTEXT);
    const customCtx = deriveAgentCommitment(pk, "custom-context");
    expect(defaultCtx).not.toBe(customCtx);
  });

  it("changes when public key changes", () => {
    const ctx = DEFAULT_ENROLLMENT_CONTEXT;
    const a = deriveAgentCommitment("c".repeat(64), ctx);
    const b = deriveAgentCommitment("d".repeat(64), ctx);
    expect(a).not.toBe(b);
  });
});

describe("isValidPublicKeyHex", () => {
  it("accepts 64-hex ed25519 public keys", () => {
    expect(isValidPublicKeyHex("e".repeat(64))).toBe(true);
    expect(isValidPublicKeyHex("E".repeat(64))).toBe(true);
  });

  it("rejects malformed keys", () => {
    expect(isValidPublicKeyHex("")).toBe(false);
    expect(isValidPublicKeyHex("abc")).toBe(false);
    expect(isValidPublicKeyHex("g".repeat(64))).toBe(false);
    expect(isValidPublicKeyHex("a".repeat(63))).toBe(false);
  });
});

describe("generateChallengeNonce", () => {
  it("returns 64-hex nonces", () => {
    const nonce = generateChallengeNonce();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates distinct nonces", () => {
    const a = generateChallengeNonce();
    const b = generateChallengeNonce();
    expect(a).not.toBe(b);
  });
});
