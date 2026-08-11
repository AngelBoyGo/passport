import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/operator";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(
    request.headers.get("authorization")
  );
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [dbOperator, apiKeyCount, receiptCount] = await Promise.all([
    prisma.operator.findUnique({ where: { id: operator.id } }),
    prisma.apiKey.count({ where: { operatorId: operator.id } }),
    prisma.receipt.count({ where: { operatorId: operator.id } }),
  ]);

  if (!dbOperator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: dbOperator.id,
    stripeCustomerId: dbOperator.stripeCustomerId,
    email: dbOperator.email,
    credits: dbOperator.credits,
    tier: dbOperator.tier,
    accountStatus: dbOperator.accountStatus,
    stakeBalanceCents: dbOperator.stakeBalanceCents,
    apiKeyCount,
    receiptCount,
  });
}