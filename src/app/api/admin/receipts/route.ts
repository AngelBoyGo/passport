import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { OperationalDomain } from "@prisma/client";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/receipts — search receipts for the logged-in operator session.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

  const where: Prisma.ReceiptWhereInput = { operatorId: session.operator.id };
  if (domain && Object.values(OperationalDomain).includes(domain as OperationalDomain)) {
    where.domain = domain as OperationalDomain;
  }
  if (status) where.status = status;
  if (from || to) {
    where.issuedAt = {};
    if (from) where.issuedAt.gte = new Date(from);
    if (to) where.issuedAt.lte = new Date(to);
  }

  const receipts = await prisma.receipt.findMany({
    where,
    orderBy: { issuedAt: "desc" },
    take: limit,
  });

  return NextResponse.json(receipts, { headers: NO_STORE });
}
