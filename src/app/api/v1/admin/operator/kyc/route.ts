import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";
import { KycStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/admin/operator/kyc — set an operator's KYC status.
 * Only executive admins may approve/reject KYC. Self-declared NOT_REQUIRED is
 * allowed only in non-production (sandbox) for integration development.
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const operator = session.operator;
  const body: { operatorId?: string; status?: string } = await request.json().catch(() => ({}));
  const targetId = body.operatorId ?? operator.id;
  const status = (body.status ?? "").toUpperCase();

  if (!["PENDING", "APPROVED", "REJECTED", "NOT_REQUIRED"].includes(status)) {
    return NextResponse.json({ error: "Invalid kyc status" }, { status: 400, headers: NO_STORE });
  }

  const isSelf = targetId === operator.id;
  const admin = isExecutiveAdmin(operator);

  // Only admins may approve/reject; self-service is limited to NOT_REQUIRED and
  // only outside live.
  const selfAllowedNotRequired =
    status === "NOT_REQUIRED" && process.env.BRIDGE_ENV !== "live";
  if ((status === "APPROVED" || status === "REJECTED") && !admin) {
    return NextResponse.json(
      { error: "Forbidden: only executive admins may approve/reject KYC" },
      { status: 403, headers: NO_STORE }
    );
  }
  if (isSelf && !admin && !selfAllowedNotRequired) {
    return NextResponse.json(
      { error: "Forbidden: invalid KYC status for self-service" },
      { status: 403, headers: NO_STORE }
    );
  }

  const updated = await prisma.operator.update({
    where: { id: targetId },
    data: { kycStatus: status as KycStatus },
    select: { id: true, email: true, kycStatus: true },
  });

  return NextResponse.json(updated, { headers: NO_STORE });
}