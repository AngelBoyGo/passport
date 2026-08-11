import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> }
) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { keyHash } = await params;

  const existing = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: { operatorId: true },
  });

  if (!existing || existing.operatorId !== operator.id) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  await prisma.apiKey.delete({ where: { keyHash } });
  return new NextResponse(null, { status: 204 });
}