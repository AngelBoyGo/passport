import { describe, it, expect } from "vitest";
import {
  base58btcFromHex,
  encodeDidKeyZ,
  encodeMultibaseEd25519,
  valid64Hex,
} from "@/lib/crypto/multibase";

describe("base58btc multibase helpers", () => {
  it("encodes base58btc correctly for a known vector", () => {
    // base58btc(0x61) = "2g" (canonical multibase example)
    expect(base58btcFromHex("61")).toBe("2g");
    // base58btc(0x626262) = "a3gV" (multiformats example)
    expect(base58btcFromHex("626262")).toBe("a3gV");
  });

  it("preserves leading zero bytes", () => {
    // two leading zero bytes → two leading '1' chars in base58.
    const encoded = base58btcFromHex("00" + "00" + "11".repeat(31));
    expect(encoded.startsWith("11")).toBe(true);
  });

  it("produces valid did:key ed25519 and Multikey prefixes", () => {
    const pub = "9".repeat(64);
    const did = encodeDidKeyZ(pub);
    const multi = encodeMultibaseEd25519(pub);

    // did:key for ed25519 always starts 'z' then decodes to multicodec 0xed.
    expect(did.startsWith("z")).toBe(true);
    // Multikey starts with 'z'
    expect(multi.startsWith("z")).toBe(true);
    // did:key and multikey differ in prefix bytes so encodings differ
    expect(did).not.toBe(multi);
    // Round-trip sanity: decode base58 length should reflect length(multicodec+32)
    expect(did.length).toBeGreaterThan(43); // 2 prefix + 32 bytes in base58 ~= 45 chars
  });

  it("rejects non-64-hex public keys", () => {
    expect(valid64Hex("abcd")).toBe(false);
    expect(valid64Hex("z".repeat(64))).toBe(false);
    expect(() => encodeDidKeyZ("bad")).toThrow(/64 hex/);
  });
});