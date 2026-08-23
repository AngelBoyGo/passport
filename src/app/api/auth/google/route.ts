import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth/auth-service";
import { prisma } from "@/lib/db";
import { sessionCookieOptions } from "@/lib/auth/cookies";
import {
  getBaseUrl,
  verifyOAuthState,
  clearOAuthStateCookie,
} from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const baseUrl = getBaseUrl(request);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", baseUrl));
  }

  // Reject login-CSRF: state must match the cookie set by the config endpoint.
  const stateCheck = verifyOAuthState(request, "google", state);
  if (!stateCheck.ok) {
    return NextResponse.redirect(new URL(stateCheck.redirectTo, baseUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/login?error=google_not_configured", baseUrl)
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${baseUrl}/api/auth/google`,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return NextResponse.redirect(
      new URL("/login?error=google_auth_failed", baseUrl)
    );
  }

  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const user = await userRes.json();
  if (!user.email) {
    return NextResponse.redirect(
      new URL("/login?error=google_email_required", baseUrl)
    );
  }

  let operator = await prisma.operator.findFirst({
    where: { email: user.email.toLowerCase() },
  });
  if (!operator) {
    const stripeCustomerId = `cus_google_${user.id}`;
    operator = await prisma.operator.create({
      data: {
        stripeCustomerId,
        email: user.email.toLowerCase(),
      },
    });
  }

  const session = await createSession(operator.id);
  const response = NextResponse.redirect(new URL("/welcome", baseUrl));
  clearOAuthStateCookie(response, "google");
  response.cookies.set("session_token", session.token, sessionCookieOptions(request));
  return response;
}