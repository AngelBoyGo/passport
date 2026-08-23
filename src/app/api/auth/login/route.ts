import { NextRequest, NextResponse } from "next/server";
import { login, createSession } from "@/lib/auth/auth-service";
import { sessionCookieOptions } from "@/lib/auth/cookies";
import {
  loginBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { verifyTurnstileToken } from "@/lib/security/turnstile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`auth-login:${ip}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      rateLimitResponse(rate, 10)
    );
  }

  let body: { email?: string; password?: string; turnstile_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Turnstile bot protection check
  if (process.env.TURNSTILE_SECRET_KEY) {
    // Security: when Turnstile is configured, the token is REQUIRED in
    // production — omitting it must fail, not silently skip the challenge.
    if (!body.turnstile_token) {
      return NextResponse.json({ error: "Bot verification required." }, { status: 403 });
    }
    const turnstileResult = await verifyTurnstileToken(body.turnstile_token);
    if (!turnstileResult.success) {
      return NextResponse.json({ error: "Bot verification failed. Please try again." }, { status: 403 });
    }
  }

  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  const result = await login(parsed.data.email, parsed.data.password);
  if (result.error) {
    // Use generic message — don't leak whether email exists
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const session = await createSession(result.operator!.id);

  const response = NextResponse.json({
    operator: { id: result.operator!.id, email: result.operator!.email },
  });

  response.cookies.set("session_token", session.token, sessionCookieOptions(request));

  return response;
}