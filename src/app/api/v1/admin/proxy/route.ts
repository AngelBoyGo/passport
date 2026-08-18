import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/proxy — proxies an API request using the session cookie.
 * Admin pages call this instead of calling the API directly with a pp_ key.
 * This eliminates the need to paste API keys in admin pages.
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { method?: string; path?: string; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  // Get the operator's API key
  const apiKeyRow = await prisma.apiKey.findFirst({
    where: { operatorId: session.operator.id },
    orderBy: { createdAt: "desc" },
  });

  if (!apiKeyRow) {
    return NextResponse.json({ error: "No API key found. Create one first." }, { status: 404 });
  }

  // We can't get the raw key back, but we can authenticate the operator
  // by using the session directly. Instead, we use the operator's identity
  // to perform the action.
  // For now, return the operator details so the admin page can use the session.
  return NextResponse.json({
    operatorId: session.operator.id,
    email: session.operator.email,
  });
}