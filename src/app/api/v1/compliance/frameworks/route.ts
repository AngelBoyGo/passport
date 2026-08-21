import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/compliance/frameworks — list supported compliance frameworks.
 */
export async function GET() {
  return NextResponse.json({
    frameworks: [
      {
        id: "NIST_AI_RMF",
        name: "NIST Artificial Intelligence Risk Management Framework (AI RMF 1.0)",
        controls: ["GOVERN_1.1", "MAP_1.2", "MEASURE_2.3", "MANAGE_3.1"],
      },
      {
        id: "EU_AI_ACT",
        name: "EU AI Act — Article 12 & 14 High-Risk AI Obligations",
        controls: ["ART_12_1", "ART_14_HUMAN_OVERSIGHT", "ART_15_ROBUSTNESS"],
      },
      {
        id: "SOC2_TYPE2",
        name: "AICPA SOC 2 Type II — Trust Services Criteria",
        controls: ["CC6.1", "CC7.2"],
      },
      {
        id: "ISO_42001",
        name: "ISO/IEC 42001:2023 Artificial Intelligence Management System",
        controls: ["CC6.1", "CC7.2"],
      },
    ],
  });
}
