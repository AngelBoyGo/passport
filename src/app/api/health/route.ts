import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 2000;

/**
 * GET /api/health — DB-backed liveness probe for Coolify.
 */
export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("health timeout")), HEALTH_TIMEOUT_MS)
      ),
    ]);
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
