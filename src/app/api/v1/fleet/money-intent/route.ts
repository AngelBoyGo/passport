/**
 * POST /api/v1/fleet/money-intent — the missing authorize link in the fleet
 * money loop.
 *
 * The money loop is: stage (brain) -> AUTHORIZE (money-tier agent's signature)
 * -> dispatch (executor creates the escrowed engagement). Before this route,
 * `authorizeMoneyMovement()` had NO production caller: the brain could stage
 * PENDING intents and the dispatch tick could execute AUTHORIZED ones, but
 * nothing could ever move an intent from PENDING to AUTHORIZED. The loop could
 * not close without a human running library code.
 *
 * Two actions:
 *   stage     — create a PENDING intent. Auth: ISSUER key or SCHEDULER_SECRET
 *               (operator/scheduler-driven; a HOLDER agent cannot stage).
 *   authorize — a money-tier agent signs the intent digest to authorize it.
 *               Auth: Bearer API key. The caller must OWN the verifier
 *               commitment; `authorizeMoneyMovement` then re-checks the switch,
 *               the provisioned `money` tier, the enrollment-pinned key, and
 *               the signature — three independent gates.
 *
 * The agent's key is never handled here: the signature is produced by the agent
 * and only its hex is posted. Nothing in this route can forge the tier binding.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";
import {
  authorizeMoneyMovement,
  stageMoneyIntent,
  MONEY_INTENT_KINDS,
} from "@/lib/fleet/money-intent";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`fleet-money-intent:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "").toLowerCase();

  if (action === "stage") {
    const sched = isSchedulerAuthorized(
      request.headers.get("x-scheduler-secret"),
      process.env.SCHEDULER_SECRET,
      process.env.NODE_ENV
    );
    const operator = await authenticateApiKey(request.headers.get("authorization"));
    const trusted = Boolean(operator && operator.apiKeyRole !== "HOLDER");
    if (!sched && !trusted) {
      return NextResponse.json(
        { error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required to stage" },
        { status: 401, headers: NO_STORE }
      );
    }
    const intentKind = String(body.intent_kind ?? body.intentKind ?? "");
    if (!MONEY_INTENT_KINDS.includes(intentKind as (typeof MONEY_INTENT_KINDS)[number])) {
      return NextResponse.json(
        { error: `unknown_intent_kind:${intentKind}` },
        { status: 400, headers: NO_STORE }
      );
    }
    const staged = await stageMoneyIntent({
      intentKind,
      workerCommitment: body.worker_commitment != null ? String(body.worker_commitment) : null,
      amountAngels: Number(body.amount_angels ?? 0),
      cycleRef: body.cycle_ref != null ? String(body.cycle_ref) : null,
      reason: body.reason != null ? String(body.reason) : undefined,
    });
    if (!staged.ok) {
      return NextResponse.json({ error: staged.reason }, { status: 400, headers: NO_STORE });
    }
    return NextResponse.json(
      { action: "stage", intent_id: staged.intentId, digest: staged.digest, status: "PENDING" },
      { status: 201, headers: NO_STORE }
    );
  }

  if (action === "authorize") {
    const operator = await authenticateApiKey(request.headers.get("authorization"));
    if (!operator) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }
    const intentId = String(body.intent_id ?? body.intentId ?? "").trim();
    const verifierCommitment = String(body.verifier_commitment ?? body.verifierCommitment ?? "").toLowerCase();
    const signature = String(body.signature ?? "").trim();
    if (!intentId || !/^[0-9a-f]{64}$/.test(verifierCommitment) || !/^[0-9a-f]{128}$/i.test(signature)) {
      return NextResponse.json(
        { error: "intent_id, verifier_commitment (64-hex), signature (128-hex) required" },
        { status: 400, headers: NO_STORE }
      );
    }

    // Ownership binding: the caller's key must own the commitment it signs as.
    const owned = await prisma.agent.findFirst({
      where: { operatorId: operator.id, agentId: verifierCommitment },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "You don't own this agent" },
        { status: 403, headers: NO_STORE }
      );
    }

    const result = await authorizeMoneyMovement({ intentId, verifierCommitment, signature });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: 403, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { action: "authorize", intent_id: intentId, status: "AUTHORIZED", reason: result.reason },
      { status: 200, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { error: "unsupported_action", supported: ["stage", "authorize"] },
    { status: 400, headers: NO_STORE }
  );
}
