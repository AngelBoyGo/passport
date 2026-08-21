import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, createApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { operatorId: operator.id },
    select: { id: true, keyHash: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(keys);
}

export async function POST(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; role?: "ISSUER" | "HOLDER" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawKey = body.role
    ? await createApiKey(operator.id, body.name, body.role)
    : await createApiKey(operator.id, body.name);

  return NextResponse.json(
    { rawKey, name: body.name ?? null, ...(body.role ? { role: body.role } : {}) },
    { status: 201 }
  );
}
