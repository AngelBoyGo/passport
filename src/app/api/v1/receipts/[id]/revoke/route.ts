import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
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

  const existing = await prisma.receipt.findUnique({
    where: { receiptId: id },
    select: { id: true, operatorId: true, revocationStatus: true },
  });

  if (!existing || existing.operatorId !== operator.id) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  if (existing.revocationStatus === "revoked") {
    return NextResponse.json(
      { error: "Receipt is already revoked" },
      { status: 409 }
    );
  }

  const updated = await prisma.receipt.update({
    where: { receiptId: id },
    data: { revocationStatus: "revoked" },
  });

  return NextResponse.json({
    receiptId: updated.receiptId,
    revocationStatus: updated.revocationStatus,
  });
}