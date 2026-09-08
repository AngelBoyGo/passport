import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { captureManualProvisioning } from "@/lib/raillab/factory-agent";
import type { RailSpecShape } from "@/lib/raillab/types";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * POST /api/v1/raillab/runbooks/capture — record a manual provisioning session as a
 * runbook blueprint (the seed for blueprint generalization → automated provisioning).
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`raillab:runbooks:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const blueprintId = String(body.blueprint_id || body.blueprintId || "");
  const sampleSpecs = (body.sample_specs || body.sampleSpecs || []) as RailSpecShape[];

  if (!blueprintId || !Array.isArray(sampleSpecs) || sampleSpecs.length === 0) {
    return NextResponse.json(
      { error: "blueprint_id and sample_specs[] are required" },
      { status: 400 }
    );
  }

  try {
    const runbook = await captureManualProvisioning({
      blueprintId,
      sampleSpecs,
      promotedFromCandidateId: body.promoted_from_candidate_id
        ? String(body.promoted_from_candidate_id)
        : undefined,
    });
    return NextResponse.json(
      {
        success: true,
        blueprint_id: (runbook as { blueprintId: string }).blueprintId,
        captured: sampleSpecs.length,
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}