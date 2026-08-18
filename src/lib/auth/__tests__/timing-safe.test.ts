import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { verifyPassword, hashPassword } from "@/lib/auth/auth-service";

describe("argon2 password verification", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("correct-password", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("handles empty password", async () => {
    const hash = await hashPassword("");
    expect(await verifyPassword("", hash)).toBe(true);
    expect(await verifyPassword("x", hash)).toBe(false);
  });

  it("handles different-length hashes without throwing", async () => {
    expect(await verifyPassword("a", "short")).toBe(false);
    expect(await verifyPassword("a", "")).toBe(false);
  });
});