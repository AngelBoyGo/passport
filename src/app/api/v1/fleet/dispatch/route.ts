/**
 * POST /api/v1/fleet/dispatch — one fleet dispatch tick.
 *
 * Executes AUTHORIZED money intents into real escrowed engagements. Auth:
 * ISSUER key or the SCHEDULER_SECRET (x-scheduler-secret) — the same trusted
 * operators that drive the brain cycle. A HOLDER (agent) key can never
 * trigger dispatch; approval of an intent does not let an agent self-execute
 * its own hire (the tick is operator/scheduler-driven, single-flight leased).
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";
import { runFleetDispatchTick } from "@/lib/fleet/fleet-executor";
import { runReputationSweepTick } from "@/lib/fleet/reputation-sweep";
import { fleetHalted } from "@/lib/fleet/fleet-service";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`fleet-dispatch:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  const sched = isSchedulerAuthorized(
    request.headers.get("x-scheduler-secret"),
    process.env.SCHEDULER_SECRET,
    process.env.NODE_ENV
  );
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  const trusted = Boolean(operator && operator.apiKeyRole !== "HOLDER");
  if (!sched && !trusted) {
    return NextResponse.json(
      { error: "Unauthorized: ISSUER key or SCHEDULER_SECRET required" },
      { status: 401, headers: NO_STORE }
    );
  }

  if (fleetHalted()) {
    return NextResponse.json({ error: "fleet_halted", halted: true }, { status: 503, headers: NO_STORE });
  }

  const dispatch = await runFleetDispatchTick();
  const sweep = await runReputationSweepTick().catch(() => ({
    ran_lease: false,
    swept: 0,
    signals_dispatched: [] as Array<{ commitment: string; kind: string; to: string }>,
  }));
  return NextResponse.json(
    { success: true, dispatch, reputation_sweep: sweep },
    { status: 200, headers: NO_STORE }
  );
}
