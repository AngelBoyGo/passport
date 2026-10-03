import { describe, it, expect } from "vitest";
import { verifyPkceS256, setRevoked, getRevokedBefore, isRevoked } from "../oidc";
import { sha256Hex } from "@/lib/receipt/canonical";
import { bytesToHex } from "@noble/hashes/utils.js";

function fakeDb() {
  const rows: Record<string, { value: unknown }> = {};
  return {
    rows,
    collection: () => ({
      async updateOne(q: any, u: any) { rows[q.key] = { value: u.$set.value }; return {}; },
      async findOne(q: any) { return rows[q.key] ?? null; },
    }),
  };
}

/** base64url(sha256(verifier)) as the S256 challenge. */
function challengeFor(verifier: string): string {
  return Buffer.from(sha256Hex(verifier), "hex").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("PKCE S256 (RFC 7636)", () => {
  it("accepts a matching verifier", () => {
    const verifier = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    expect(verifyPkceS256(verifier, challengeFor(verifier))).toBe(true);
  });
  it("rejects a mismatched verifier", () => {
    const verifier = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const other = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    expect(verifyPkceS256(other, challengeFor(verifier))).toBe(false);
  });
  it("rejects empty inputs", () => {
    expect(verifyPkceS256("", "x")).toBe(false);
    expect(verifyPkceS256("x", "")).toBe(false);
  });
});

describe("revocation (kill one agent, not the owner)", () => {
  it("setRevoked then getRevokedBefore returns the timestamp", async () => {
    const db = fakeDb();
    const sub = "a".repeat(64);
    await setRevoked(db as never, sub, 1000);
    expect(await getRevokedBefore(db as never, sub)).toBe(1000);
  });

  it("tokens issued before revocation are invalid; after are valid", () => {
    const revokedBefore = 5000;
    expect(isRevoked(4000, revokedBefore)).toBe(true);   // issued before => revoked
    expect(isRevoked(6000, revokedBefore)).toBe(false);  // issued after => valid
    expect(isRevoked(4000, null)).toBe(false);           // no revocation => valid
  });

  it("a fresh agent with no revocation record is not revoked", async () => {
    const db = fakeDb();
    expect(isRevoked(100, await getRevokedBefore(db as never, "b".repeat(64)))).toBe(false);
  });
});
