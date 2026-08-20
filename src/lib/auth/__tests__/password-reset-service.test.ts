import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    operator: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    passwordResetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  createPasswordResetToken,
  verifyAndConsumeResetToken,
} from "@/lib/auth/password-reset-service";

describe("Password Reset Service (Resend Integration & Invalidation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPasswordResetToken", () => {
    it("returns generic success without creating token when operator does not exist (prevents email enumeration)", async () => {
      prismaMock.operator.findFirst.mockResolvedValue(null);

      const result = await createPasswordResetToken("unknown@example.com");
      expect(result.ok).toBe(true);
      expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it("generates a signed 15-minute reset token when operator exists", async () => {
      prismaMock.operator.findFirst.mockResolvedValue({
        id: "op_123",
        email: "user@example.com",
      });
      prismaMock.passwordResetToken.create.mockResolvedValue({
        id: "prt_1",
        email: "user@example.com",
        token: "prt_tok_123",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      const result = await createPasswordResetToken("user@example.com");
      expect(result.ok).toBe(true);
      expect(prismaMock.passwordResetToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "user@example.com",
            token: expect.stringMatching(/^prt_/),
            expiresAt: expect.any(Date),
          }),
        })
      );
    });
  });

  describe("verifyAndConsumeResetToken", () => {
    it("rejects expired or invalid reset tokens", async () => {
      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt_expired",
        email: "user@example.com",
        token: "prt_expired_token",
        expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
      });

      const result = await verifyAndConsumeResetToken("prt_expired_token", "newpassword123");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/expired|invalid/i);
      expect(prismaMock.operator.update).not.toHaveBeenCalled();
    });

    it("updates password with Argon2id, deletes token, and invalidates all existing sessions", async () => {
      const futureDate = new Date(Date.now() + 600_000);
      prismaMock.passwordResetToken.findUnique.mockResolvedValue({
        id: "prt_valid",
        email: "user@example.com",
        token: "prt_valid_token",
        expiresAt: futureDate,
      });
      prismaMock.operator.findFirst.mockResolvedValue({
        id: "op_123",
        email: "user@example.com",
      });

      const result = await verifyAndConsumeResetToken("prt_valid_token", "supersecret123");
      expect(result.ok).toBe(true);

      // Verify operator password updated with Argon2 hash
      expect(prismaMock.operator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "op_123" },
          data: {
            passwordHash: expect.stringMatching(/^\$argon2/),
          },
        })
      );

      // Verify one-time token deletion
      expect(prismaMock.passwordResetToken.delete).toHaveBeenCalledWith({
        where: { id: "prt_valid" },
      });

      // Verify all sessions for operator invalidated
      expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
        where: { operatorId: "op_123" },
      });
    });
  });
});
