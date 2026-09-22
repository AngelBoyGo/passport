/**
 * Fleet control plane — the machine-callable surface the brain drives.
 *
 * Auth: an ISSUER-graded API key (any non-HOLDER role, resolved via
 * authenticateApiKey) OR the fail-closed scheduler secret
 * (x-scheduler-secret = SCHEDULER_SECRET). A HOLDER key (an ordinary agent's
 * own credential) can never drive the fleet — fleet agents cannot mint,
 * stop, or rehydrate each other.
 *
 * Actions:
 *   mint      — provision N agents {capability, llm_tier?, count?, display_name?}
 *   stop      — release runtime (identity retained) {commitment, reason?, capsule*?}
 *   rehydrate — revive a stopped/failed agent {commitment, new_tier?}
 *   list      — roster filter {capability?, status?, limit?}
 *   status    — fleet aggregates (counts by status/tier, cap, switches)
 *
 * GET returns fleet status + roster by default (no action body).
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { authenticateApiKey } from "@/lib/operator";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";
import {
  listFleet,
  moneyMintEnabled,
  mintFleetAgent,
  rehydrateFleetAgent,
  stopFleetAgent,
  fleetHalted,
} from "@/lib/fleet/fleet-service";
import { isLlmTier } from "@/lib/llm/tiers";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

type TrustedContext = { trusted: true; via: "issuer" | "scheduler" } | null;

async function authorize(request: NextRequest): Promise<TrustedContext | NextResponse> {
  const scheduler = isSchedulerAuthorized(
    request.headers.get("x-scheduler-secret"),
    process.env.SCHEDULER_SECRET,
    process.env.NODE_ENV
  );
  if (scheduler) return { trusted: true, via: "scheduler" };

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (operator && operator.apiKeyRole !== "HOLDER") {
    return { trusted: true, via: "issuer" };
  }
  return NextResponse.json(
    { error: "forbidden", message: "Fleet control requires an ISSUER key or the scheduler secret." },
    { status: 403, headers: NO_STORE }
  );
}

const MAX_BATCH = 10;

interface FleetStatusPayload {
  halt: boolean;
  money_mint: boolean;
  cap_used: number;
  cap_max: number;
  [k: string]: unknown;
}

async function statusPayload(): Promise<FleetStatusPayload> {
  const { getFleetStatus } = await import("@/lib/fleet/fleet-service");
  const s = await getFleetStatus();
  return {
    halt: fleetHalted(),
    money_mint: moneyMintEnabled(),
    cap_used: s.byStatus["active"] ?? 0,
    cap_max: s.cap,
    by_status: s.byStatus,
    by_tier: s.byTier,
    total: s.total,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const roster = await listFleet({
    capability: searchParams.get("capability") || undefined,
    status: ((): "active" | "stopped" | "idle" | "provisioning" | "failed" | undefined => {
      const s = searchParams.get("status");
      if (s === "active" || s === "stopped" || s === "idle" || s === "provisioning" || s === "failed") return s;
      return undefined;
    })(),
    limit: Math.min(Number(searchParams.get("limit") || 100), 500),
  });

  return NextResponse.json(
    { status: await statusPayload(), instances: roster },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`fleet-control:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 60));
  }

  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "").toLowerCase();

  try {
    if (action === "mint") {
      const tierInput = body.llm_tier ?? body.llmTier ?? "neuron";
      if (!isLlmTier(tierInput)) {
        return NextResponse.json({ error: `unknown_llm_tier:${String(tierInput)}` }, { status: 400, headers: NO_STORE });
      }
      const count = Math.min(Math.max(Number(body.count ?? 1), 1), MAX_BATCH);
      const minted: unknown[] = [];
      const errors: string[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const created = await mintFleetAgent({
            capability: String(body.capability ?? ""),
            llmTier: tierInput,
            displayName: body.display_name != null ? String(body.display_name) : undefined,
          });
          minted.push({ commitment: created.commitment, tier: created.tier, model: created.resolvedModel, instance_id: created.instanceId });
        } catch (e) {
          errors.push(String(e instanceof Error ? e.message : e));
          break; // fail fast on the first refusal; report partial
        }
      }
      return NextResponse.json(
        { action: "mint", minted: minted.length, agents: minted, errors, status: await statusPayload() },
        { status: minted.length > 0 ? 201 : 400, headers: NO_STORE }
      );
    }

    if (action === "stop") {
      const commitment = String(body.commitment ?? "");
      if (!/^[0-9a-f]{64}$/i.test(commitment)) {
        return NextResponse.json({ error: "invalid_commitment" }, { status: 400, headers: NO_STORE });
      }
      await stopFleetAgent(commitment, {
        reason: body.reason != null ? String(body.reason) : undefined,
        capsulePayload: body.capsule_payload != null ? String(body.capsule_payload) : undefined,
        capsuleSignature: body.capsule_signature != null ? String(body.capsule_signature) : undefined,
        capsulePublicKey: body.capsule_public_key != null ? String(body.capsule_public_key) : undefined,
      });
      return NextResponse.json({ action: "stop", stopped: commitment, status: await statusPayload() }, { headers: NO_STORE });
    }

    if (action === "rehydrate") {
      const commitment = String(body.commitment ?? "");
      if (!/^[0-9a-f]{64}$/i.test(commitment)) {
        return NextResponse.json({ error: "invalid_commitment" }, { status: 400, headers: NO_STORE });
      }
      const newTier = body.new_tier != null ? String(body.new_tier) : undefined;
      if (newTier && !isLlmTier(newTier)) {
        return NextResponse.json({ error: `unknown_llm_tier:${newTier}` }, { status: 400, headers: NO_STORE });
      }
      const result = await rehydrateFleetAgent(commitment, newTier as never);
      return NextResponse.json(
        {
          action: "rehydrate",
          rehydrated: commitment,
          tier: result.tier,
          resolved_model: result.resolvedModel,
          upgraded: result.upgraded,
          capsule_version: result.capsule?.version ?? null,
          status: await statusPayload(),
        },
        { headers: NO_STORE }
      );
    }

    if (action === "list" || action === "status") {
      return NextResponse.json(
        { action, status: await statusPayload(), instances: await listFleet({ limit: 200 }) },
        { headers: NO_STORE }
      );
    }

    return NextResponse.json(
      { error: "unsupported_action", supported: ["mint", "stop", "rehydrate", "list", "status"] },
      { status: 400, headers: NO_STORE }
    );
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const byCode: Array<[RegExp, number]> = [
      [/fleet_halted/, 503],
      [/money_tier_mint_disabled/, 403],
      [/fleet_cap_reached/, 409],
      [/instance_not_found/, 404],
      [/illegal_transition/, 409],
      [/tier_downgrade_rejected/, 409],
      [/unknown_llm_tier/, 400],
      [/invalid_instance_spec/, 400],
      [/instance_already_stopped/, 409],
    ];
    const status = byCode.find(([re]) => re.test(msg))?.[1] ?? 500;
    return NextResponse.json({ error: msg }, { status, headers: NO_STORE });
  }
}
