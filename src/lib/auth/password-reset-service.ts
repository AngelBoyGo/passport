import { prisma } from "@/lib/db";
import { hashPassword, deleteAllSessionsForOperator } from "@/lib/auth/auth-service";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type PasswordResetResult = {
  ok: boolean;
  error?: string;
  resetUrl?: string;
};

function resetSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
    return "dev-session-secret";
  }
  throw new Error("SESSION_SECRET is required outside test/development environments");
}

/**
 * Generates a signed password reset token.
 */
function generateResetToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = bytesToHex(sha256(bytes));
  const signature = bytesToHex(sha256(utf8ToBytes(raw + resetSecret())));
  return "prt_" + raw + signature;
}

/**
 * Initiates password reset for an email address.
 * Returns generic success even if email is not registered (prevents enumeration).
 */
export async function createPasswordResetToken(
  email: string,
  origin: string = "https://passport.metis.gold"
): Promise<PasswordResetResult> {
  const normalizedEmail = email.toLowerCase().trim();

  const operator = await prisma.operator.findFirst({
    where: { email: normalizedEmail },
  });

  if (!operator) {
    // Return generic success to avoid email enumeration
    return { ok: true };
  }

  // Clear any existing active reset tokens for this email
  await prisma.passwordResetToken.deleteMany({
    where: { email: normalizedEmail },
  });

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      email: normalizedEmail,
      token,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  // If Resend API key is configured, send transactional email
  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "Passport <auth@passport.metis.gold>",
          to: [normalizedEmail],
          subject: "Reset your Passport password",
          html: `
            <p>You requested a password reset for your Passport operator account.</p>
            <p><a href="${resetUrl}">Click here to reset your password</a> (valid for 15 minutes).</p>
            <p>If you did not request this, please ignore this email.</p>
          `,
        }),
      });
    } catch (err) {
      console.warn("Failed to send password reset email via Resend:", err);
    }
  }

  return { ok: true, resetUrl };
}

/**
 * Verifies a reset token, updates password to Argon2id, deletes token,
 * and invalidates all existing sessions for the operator.
 */
export async function verifyAndConsumeResetToken(
  token: string,
  newPassword: string
): Promise<PasswordResetResult> {
  if (!token || !token.startsWith("prt_")) {
    return { ok: false, error: "Invalid or malformed reset token" };
  }

  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!resetRecord || resetRecord.expiresAt < new Date()) {
    if (resetRecord) {
      await prisma.passwordResetToken.delete({ where: { id: resetRecord.id } });
    }
    return { ok: false, error: "Reset token has expired or is invalid" };
  }

  const operator = await prisma.operator.findFirst({
    where: { email: resetRecord.email },
  });

  if (!operator) {
    return { ok: false, error: "Operator account not found" };
  }

  // Hash new password using Argon2id
  const newHash = await hashPassword(newPassword);

  // Atomically update password
  await prisma.operator.update({
    where: { id: operator.id },
    data: { passwordHash: newHash },
  });

  // Consume single-use token
  await prisma.passwordResetToken.delete({
    where: { id: resetRecord.id },
  });

  // Security: Invalidate all existing sessions for this operator
  await deleteAllSessionsForOperator(operator.id);

  return { ok: true };
}
