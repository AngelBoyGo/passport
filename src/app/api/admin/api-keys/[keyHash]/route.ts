import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyHash: string }> }
) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { keyHash } = await params;
  const deleted = await prisma.apiKey.deleteMany({
    where: { keyHash, operatorId: session.operator.id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
