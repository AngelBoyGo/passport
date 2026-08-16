import { NextRequest, NextResponse } from "next/server";
import { signup, createSession } from "@/lib/auth/auth-service";
import { sessionCookieOptions } from "@/lib/auth/cookies";
import {
  signupBodySchema,
  zodValidationErrorResponse,
} from "@/lib/validation/enrollmentSchemas";
import {
  checkInMemoryRateLimit,
  clientIpFromRequest,
  rateLimitResponse,
} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`auth-signup:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      rateLimitResponse(rate, 5)
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = signupBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodValidationErrorResponse(parsed.error), {
      status: 400,
    });
  }

  const result = await signup(parsed.data.email, parsed.data.password);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const session = await createSession(result.operator!.id);

  const response = NextResponse.json(
    { operator: { id: result.operator!.id, email: result.operator!.email } },
    { status: 201 }
  );

  response.cookies.set("session_token", session.token, sessionCookieOptions(request));

  return response;
}