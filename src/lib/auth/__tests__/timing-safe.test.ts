import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { verifyPassword, hashPassword, timingSafeVerifyPassword } from "@/lib/auth/auth-service";

describe("timing-safe password verification", () => {
  it("accepts the correct password", () => {
    const hash = hashPassword("correct-password");
    expect(verifyPassword("correct-password", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct-password");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("handles empty password", () => {
    const hash = hashPassword("");
    expect(verifyPassword("", hash)).toBe(true);
    expect(verifyPassword("x", hash)).toBe(false);
  });

  it("handles different-length hashes without throwing", () => {
    expect(verifyPassword("a", "short")).toBe(false);
    expect(verifyPassword("a", "")).toBe(false);
  });

  it("uses timingSafeEqual internally", () => {
    const hash = hashPassword("test");
    expect(timingSafeVerifyPassword("test", hash)).toBe(true);
    expect(timingSafeVerifyPassword("wrong", hash)).toBe(false);
  });
});