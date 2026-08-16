import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";

export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isExecutiveAdmin(session.operator)) return NextResponse.json({ error: "Executive admin access required" }, { status: 403 });
  let snapshot: unknown = {};
  try { snapshot = await request.json(); } catch { /* empty snapshot is valid */ }
  return NextResponse.json({
    role: "developer_ceo",
    system: "Passport Executive Operations Copilot",
    safety: ["Never expose secrets or raw private keys", "Treat recommendations as advisory", "Require explicit confirmation before mutation"],
    snapshot,
    availableTools: ["get_health_status", "search_receipts", "search_evidence", "generate_executive_report"],
  });
}
