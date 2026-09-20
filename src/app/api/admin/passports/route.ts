import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db";
import { EnrollmentStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * GET /api/admin/passports — list all agent passport enrollments with evidence counts.
 * Session-authenticated for operator console.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status")?.toUpperCase();
  const search = searchParams.get("search")?.trim().toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  let statusFilter: EnrollmentStatus | undefined = undefined;
  if (statusParam && Object.values(EnrollmentStatus).includes(statusParam as EnrollmentStatus)) {
    statusFilter = statusParam as EnrollmentStatus;
  }

  const whereClause: Record<string, unknown> = {};
  if (statusFilter) {
    whereClause.status = statusFilter;
  }
  if (search) {
    whereClause.OR = [
      { subjectCommitment: { contains: search, mode: "insensitive" } },
      { publicKey: { contains: search, mode: "insensitive" } },
      { context: { contains: search, mode: "insensitive" } },
    ];
  }

  const [total, issuedCount, pendingCount, revokedCount, enrollments] = await Promise.all([
    prisma.agentEnrollment.count(),
    prisma.agentEnrollment.count({ where: { status: EnrollmentStatus.ISSUED } }),
    prisma.agentEnrollment.count({ where: { status: EnrollmentStatus.PENDING } }),
    prisma.agentEnrollment.count({ where: { status: EnrollmentStatus.REVOKED } }),
    prisma.agentEnrollment.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        subjectCommitment: true,
        publicKey: true,
        context: true,
        status: true,
        issuedAt: true,
        createdAt: true,
        updatedAt: true,
        photoUrl: true,
      },
    }),
  ]);

  // Aggregate evidence counts per agent
  const commitments = enrollments.map((e) => e.subjectCommitment);
  const evidenceCounts = await prisma.agentEvidence.groupBy({
    by: ["agentIdentityCommitment"],
    where: { agentIdentityCommitment: { in: commitments } },
    _count: { _all: true },
  });

  const countMap = new Map(evidenceCounts.map((g) => [g.agentIdentityCommitment, g._count._all]));

  return NextResponse.json(
    {
      counts: {
        total,
        issued: issuedCount,
        pending: pendingCount,
        revoked: revokedCount,
      },
      passports: enrollments.map((e) => ({
        ...e,
        evidenceCount: countMap.get(e.subjectCommitment) ?? 0,
      })),
    },
    { headers: NO_STORE }
  );
}
