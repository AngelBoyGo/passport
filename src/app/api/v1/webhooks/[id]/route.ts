import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const sub = await prisma.webhookSubscription.findUnique({
    where: { id },
    select: { operatorId: true },
  });

  if (!sub || sub.operatorId !== operator.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.webhookSubscription.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}