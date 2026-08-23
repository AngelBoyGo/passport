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
  const stateCheck = verifyOAuthState(request, "github", state);
  if (!stateCheck.ok) {
    return NextResponse.redirect(new URL(stateCheck.redirectTo, baseUrl));
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=github_not_configured", baseUrl));
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    return NextResponse.redirect(new URL("/login?error=github_auth_failed", baseUrl));
  }

  // Get user info from GitHub
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = await userRes.json();

  if (!user.email) {
    // Fetch emails if primary email is private
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const emails = await emailsRes.json();
    const primary = emails.find((e: { primary: boolean }) => e.primary);
    user.email = primary?.email || `${user.id}@github.user`;
  }

  // Find or create operator
  let operator = await prisma.operator.findFirst({
    where: { email: user.email.toLowerCase() },
  });

  if (!operator) {
    const stripeCustomerId = `cus_gh_${user.id}`;
    operator = await prisma.operator.create({
      data: {
        stripeCustomerId,
        email: user.email.toLowerCase(),
      },
    });
  }

  // Create session
  const session = await createSession(operator.id);

  const response = NextResponse.redirect(new URL("/welcome", baseUrl));
  clearOAuthStateCookie(response, "github");
  response.cookies.set("session_token", session.token, sessionCookieOptions(request));

  return response;
}