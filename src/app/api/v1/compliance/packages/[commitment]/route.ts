import { NextRequest, NextResponse } from "next/server";
import { buildCompliancePackage, ComplianceFramework } from "@/lib/compliance/package-builder";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { checkInMemoryRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const VALID_FRAMEWORKS = new Set(["NIST_AI_RMF", "EU_AI_ACT", "SOC2_TYPE2", "ISO_42001"]);

/**
 * GET /api/v1/compliance/packages/:commitment — generate signed audit-grade compliance package.
 * Mapped to NIST AI RMF, EU AI Act Article 12, or SOC 2 Type II.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`compliance-pkg:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      rateLimitResponse(rate, 30)
    );
  }

  const { commitment } = await params;
  if (!isValidAgentCommitmentHash(commitment)) {
    return NextResponse.json({ error: "Invalid agent commitment hash" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const frameworkParam = (searchParams.get("framework") ?? "NIST_AI_RMF").toUpperCase();
  const framework: ComplianceFramework = VALID_FRAMEWORKS.has(frameworkParam)
    ? (frameworkParam as ComplianceFramework)
    : "NIST_AI_RMF";

  const pkg = await buildCompliancePackage(commitment, { framework });

  if (!pkg) {
    return NextResponse.json({ error: "Agent not enrolled or no evidence records found" }, { status: 404 });
  }

  return NextResponse.json(pkg, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
