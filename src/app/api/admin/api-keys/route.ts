import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { createApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const keys = await prisma.apiKey.findMany({
    where: { operatorId: session.operator.id },
    select: { id: true, keyHash: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(keys, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawKey = await createApiKey(session.operator.id, body.name);

  return NextResponse.json(
    { rawKey, name: body.name ?? null },
    { status: 201, headers: NO_STORE }
  );
}
