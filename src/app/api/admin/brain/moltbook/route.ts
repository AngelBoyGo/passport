import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import {
  registerMoltbookAgent,
  moltbookRead,
  moltbookConfigured,
  recentMoltbookItems,
} from "@/lib/brain/moltbook";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/** GET /api/admin/brain/moltbook — config status + recently learned items. */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const items = await recentMoltbookItems(20);
  return NextResponse.json(
    { configured: moltbookConfigured(), items },
    { headers: NO_STORE }
  );
}

/**
 * POST /api/admin/brain/moltbook — actions:
 *   register — create the Moltbook agent (returns claim_url for the owner)
 *   read     — force an immediate read/learn pass
 * Executive-admin only, audit-logged.
 */
export async function POST(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session || !isExecutiveAdmin(session.operator)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    description?: string;
  };
  const action = String(body.action ?? "").toLowerCase();

  if (action === "read") {
    const r = await moltbookRead();
    await audit(session.operator.id, "moltbook_read", `${r.fetched} fetched, ${r.stored} stored`);
    return NextResponse.json({ ok: true, ...r }, { headers: NO_STORE });
  }

  if (action === "register") {
    const result = await registerMoltbookAgent({
      name: String(body.name ?? "PassportCommandBrain"),
      description: String(
        body.description ?? "Autonomous economic agent for a commodity-backed AI-agent economy."
      ),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400, headers: NO_STORE });
    }
    await audit(
      session.operator.id,
      "moltbook_register",
      `registered; claim_url=${result.claimUrl} code=${result.verificationCode} (api_key withheld)`
    );
    // The api_key is returned ONCE so the operator can set MOLTBOOK_API_KEY.
    // It is never logged.
    return NextResponse.json(
      {
        ok: true,
        claim_url: result.claimUrl,
        verification_code: result.verificationCode,
        api_key: result.apiKey,
        next_step: "Set MOLTBOOK_API_KEY in the environment, then complete the human claim via claim_url.",
      },
      { headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { error: "unsupported_action", supported: ["register", "read"] },
    { status: 400, headers: NO_STORE }
  );
}

async function audit(operatorId: string, action: string, details: string): Promise<void> {
  const { prisma } = await import("@/lib/db");
  await prisma.adminAuditLog
    .create({ data: { operatorId, action, targetId: "moltbook", details: details.slice(0, 500) } })
    .catch(() => undefined);
}
