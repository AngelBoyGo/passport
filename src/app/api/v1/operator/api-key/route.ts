import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/operator/api-key — returns the operator's first API key.
 * Uses session cookie auth (no pp_ key required).
 * Admin pages call this to auto-populate the API key input.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: { operatorId: session.operator.id },
    select: { keyHash: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ keyHash: apiKey?.keyHash ?? null, name: apiKey?.name ?? null });
}