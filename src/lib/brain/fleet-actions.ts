/**
 * Brain fleet actions — the Command Brain's decisions ABOUT the fleet.
 *
 * Design rule: the brain only PROPOSES. Every mutation goes through the fleet
 * service, whose own governance (cap FLEET_MAX_AGENTS, money-mint switch,
 * FLEET_HALT kill switch, fail-closed transitions) stays authoritative. The
 * brain cannot mint a money-tier agent while the switch is off — its request
 * hits the service gate and records ACTION_FAILED, visible in the playbook.
 *
 * All actions here are reversible (mint more, rehydrate later) or read-only,
 * preserving the "reversible/advisory" action space of the Command Brain.
 */

import { isLlmTier, type LlmTier } from "@/lib/llm/tiers";
import {
  mintFleetAgent,
  stopFleetAgent,
} from "@/lib/fleet/fleet-service";

/** Bounded blast radius per brain cycle. */
export const MAX_SCALE_PER_CYCLE = 3;

export async function runScaleFleetUp(params: {
  capability: string;
  llm_tier: string;
  count?: number;
}): Promise<string> {
  const tier = params.llm_tier as LlmTier;
  if (!isLlmTier(tier)) {
    return `error: unknown_llm_tier:${String(params.llm_tier)}`;
  }
  const count = Number(params.count ?? 1);
  if (!Number.isInteger(count) || count < 1) {
    return "error: invalid_count";
  }
  const bounded = Math.min(count, MAX_SCALE_PER_CYCLE);

  const created: string[] = [];
  for (let i = 0; i < bounded; i++) {
    try {
      const minted = await mintFleetAgent({
        capability: String(params.capability ?? ""),
        llmTier: tier,
      });
      created.push(`${minted.commitment.slice(0, 12)}:${tier}`);
    } catch (err) {
      // Partial report beats silent failure; the service gate names the reason
      // (fleet_cap_reached / money_tier_mint_disabled / fleet_halted / spec).
      return created.length > 0
        ? `ok: created=${created.length} stopped_at=${String(err instanceof Error ? err.message : err)}`
        : `error: ${String(err instanceof Error ? err.message : err)}`;
    }
  }
  return `ok: created=${created.length}`;
}

export async function runRetireAgent(params: {
  commitment: string;
  reason?: string;
}): Promise<string> {
  const commitment = String(params.commitment ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(commitment)) {
    return "error: invalid_commitment";
  }
  try {
    await stopFleetAgent(commitment, {
      reason: `brain_retire:${String(params.reason ?? "unspecified").slice(0, 160)}`,
    });
    return "ok";
  } catch (err) {
    return `error: ${String(err instanceof Error ? err.message : err)}`;
  }
}
