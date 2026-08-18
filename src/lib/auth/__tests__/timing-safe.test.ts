import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  verifyPassword,
  hashPassword,
  legacySha256HashPassword,
} from "@/lib/auth/auth-service";

describe("Password verification (Argon2id + legacy SHA-256 backwards compatibility)", () => {
  it("accepts a correct password with Argon2id hash", async () => {
    const hash = await hashPassword("correct-password");
    expect(hash.startsWith("$argon2")).toBe(true);
    expect(await verifyPassword("correct-password", hash)).toBe(true);
  });

  it("rejects an incorrect password with Argon2id hash", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("accepts a correct password with legacy 100k SHA-256 hash", async () => {
    const legacyHash = legacySha256HashPassword("legacy-pass-123");
    expect(/^[0-9a-f]{64}$/i.test(legacyHash)).toBe(true);
    expect(await verifyPassword("legacy-pass-123", legacyHash)).toBe(true);
  });

  it("rejects an incorrect password with legacy 100k SHA-256 hash", async () => {
    const legacyHash = legacySha256HashPassword("legacy-pass-123");
    expect(await verifyPassword("wrong-pass", legacyHash)).toBe(false);
  });

  it("handles empty and malformed hashes safely without throwing", async () => {
    expect(await verifyPassword("a", "short")).toBe(false);
    expect(await verifyPassword("a", "")).toBe(false);
    expect(await verifyPassword("a", "not-a-hash-at-all")).toBe(false);
  });
});
