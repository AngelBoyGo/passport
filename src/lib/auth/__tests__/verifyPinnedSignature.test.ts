import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, getPublicKey } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "@/lib/receipt/canonical";
import {
  verifyPinnedSignature,
  signaturesEnforced,
} from "../verifyPinnedSignature";

const privA = hexToBytes("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
const pubA = bytesToHex(getPublicKey(privA));
const privB = hexToBytes("ff".repeat(32));
const pubB = bytesToHex(getPublicKey(privB));

const payload = { action: "ADD_VAULT", batch: "BKO-01" };
const canonical = canonicalJson(payload);
const sigA = bytesToHex(sign(utf8ToBytes(canonical), privA));

describe("verifyPinnedSignature — signer provenance matrix", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid signature against the pinned key (object payload)", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      signatureHex: sigA,
      signPayload: payload,
      context: "test.object",
      commitment: "c".repeat(64),
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a valid signature against the pinned key (raw string payload)", async () => {
    const digest = "a".repeat(64);
    const sig = bytesToHex(sign(utf8ToBytes(digest), privA));
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      signatureHex: sig,
      signPayload: digest,
      context: "test.raw",
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts an absent provided key when the pinned key verifies", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      providedKey: null,
      signatureHex: sigA,
      signPayload: payload,
      context: "test.absent",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a provided key that differs from the pinned key (forgery)", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      providedKey: pubB,
      signatureHex: sigA,
      signPayload: payload,
      context: "test.mismatch",
    });
    expect(result).toEqual({ valid: false, reason: "provided_key_mismatch" });
  });

  it("accepts a provided key that matches the pinned key", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      providedKey: pubA.toUpperCase(),
      signatureHex: sigA,
      signPayload: payload,
      context: "test.match",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects when no pinned key is available (fail closed)", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: undefined,
      providedKey: pubA,
      signatureHex: sigA,
      signPayload: payload,
      context: "test.missing",
    });
    expect(result).toEqual({ valid: false, reason: "missing_pinned_key" });
  });

  it("rejects a malformed pinned key", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: "not-hex",
      signatureHex: sigA,
      signPayload: payload,
      context: "test.badkey",
    });
    expect(result).toEqual({ valid: false, reason: "malformed_key" });
  });

  it("rejects a malformed signature", async () => {
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      signatureHex: "sig",
      signPayload: payload,
      context: "test.badsig",
    });
    expect(result).toEqual({ valid: false, reason: "malformed_signature" });
  });

  it("rejects a valid-length signature over different content", async () => {
    const otherSig = bytesToHex(sign(utf8ToBytes(canonicalJson({ action: "OTHER" })), privA));
    const result = await verifyPinnedSignature({
      pinnedKey: pubA,
      signatureHex: otherSig,
      signPayload: payload,
      context: "test.tamper",
    });
    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });
});

describe("signaturesEnforced — fail-closed gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off in test/dev by default", () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.ENFORCE_SIGNATURES;
    expect(signaturesEnforced()).toBe(false);
  });

  it("is on in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(signaturesEnforced()).toBe(true);
  });

  it("is on in staging when ENFORCE_SIGNATURES=1", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENFORCE_SIGNATURES", "1");
    expect(signaturesEnforced()).toBe(true);
  });
});
