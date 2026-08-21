import { NextRequest, NextResponse } from "next/server";
import { buildAuditEvidencePackage } from "@/lib/compliance/audit-evidence-package";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * GET /api/v1/compliance/audit-package/:commitment — assemble a stream of
 * compliance_report evidence receipts into a signed, audit-grade evidence
 * package mapped to a real control framework (SOC 2, ISO 27001, ISO 42001).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ commitment: string }> }
) {
  const { commitment } = await params;
  if (!isValidAgentCommitmentHash(commitment)) {
    return NextResponse.json(
      { error: "Invalid agent commitment hash" },
      { status: 400, headers: CORS }
    );
  }

  const { searchParams } = new URL(request.url);
  const frameworkRaw = searchParams.get("framework") ?? "SOC2_TYPE2";
  const framework = ["SOC2_TYPE2", "ISO_27001", "ISO_42001"].includes(frameworkRaw)
    ? (frameworkRaw as "SOC2_TYPE2" | "ISO_27001" | "ISO_42001")
    : "SOC2_TYPE2";

  const pkg = await buildAuditEvidencePackage(commitment, framework);
  if (!pkg) {
    return NextResponse.json(
      { error: "No compliance_report evidence found for this commitment" },
      { status: 404, headers: CORS }
    );
  }

  return NextResponse.json(pkg, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      ...CORS,
    },
  });
}
