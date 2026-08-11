import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";
import { ErrorTranche } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tranche = searchParams.get("tranche");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

  const entries = await prisma.slashingLedger.findMany({
    where: {
      operatorId: operator.id,
      ...(tranche && Object.values(ErrorTranche).includes(tranche as ErrorTranche)
        ? { tranche: tranche as ErrorTranche }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return NextResponse.json(entries);
}