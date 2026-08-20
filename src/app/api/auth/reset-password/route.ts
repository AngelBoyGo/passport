import { NextRequest, NextResponse } from "next/server";
import { verifyAndConsumeResetToken } from "@/lib/auth/password-reset-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { z } from "zod";
import { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";

export const dynamic = "force-dynamic";

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`reset-pwd:${ip}`, 5, 60_000);
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

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), { status: 400 });
  }

  const result = await verifyAndConsumeResetToken(parsed.data.token, parsed.data.newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Password reset failed" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: "Password reset successfully. Please sign in with your new password.",
  });
}
