import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/password-reset-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { z } from "zod";
import { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";

export const dynamic = "force-dynamic";

const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email address required"),
});

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`forgot-pwd:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many reset attempts. Try again later." },
      rateLimitResponse(rate, 5)
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), { status: 400 });
  }

  // Always build reset URLs from the allow-listed production base URL, never
  // from the request Origin header (which is attacker-controllable and could
  // phish a victim's reset token onto a fake site).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://passport.metis.gold";
  const result = await createPasswordResetToken(parsed.data.email, baseUrl);

  return NextResponse.json({
    ok: true,
    message: "If that email is registered, a password reset link has been sent.",
    // In dev without Resend key, return resetUrl to assist testing
    ...(process.env.NODE_ENV !== "production" && result.resetUrl ? { resetUrl: result.resetUrl } : {}),
  });
}
