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

  // C4: a HOLDER-role key may only mint HOLDER keys for its own operator.
  // Only ISSUER-role (or session-authenticated human) callers may mint ISSUER.
  const requestedRole = body.role ?? "ISSUER";
  if (requestedRole === "ISSUER" && operator.apiKeyRole === "HOLDER") {
    return NextResponse.json(
      { error: "Forbidden: Holder keys cannot mint Issuer keys" },
      { status: 403 }
    );
  }

  const rawKey = requestedRole
    ? await createApiKey(operator.id, body.name, requestedRole as "ISSUER" | "HOLDER")
    : await createApiKey(operator.id, body.name);

  return NextResponse.json(
    { rawKey, name: body.name ?? null, role: requestedRole },
    { status: 201 }
  );
}
