/**
 * Fleet agent lifecycle — pure transition rules.
 *
 * Owner-approved model: one instance per Passport; spin-down releases only the
 * runtime and NEVER deletes the Passport/enrollment/wallet/evidence; a later
 * spin-up rehydrates the same identity (see fleet-service.rehydrateFleetAgent).
 *
 * Legal transitions (fail-closed: anything not listed is illegal):
 *   provisioning -> active | failed | stopped   (stop releases a stuck mint)
 *   active       -> idle | stopped | failed
 *   idle         -> active | stopped | failed
 *   stopped      -> provisioning   (rehydration re-enters via provisioning)
 *   failed       -> provisioning | stopped   (retry up, or abandon)
 *
 * The upgrade-only invariant lives in llm/tiers.ts: a re-provision must use a
 * tier whose rank is >= the previous one. lowerTierThan() is the check.
 */

import { isLlmTier, rankOf, type LlmTier } from "@/lib/llm/tiers";

export const INSTANCE_STATUSES = [
  "provisioning",
  "active",
  "idle",
  "stopped",
  "failed",
] as const;

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const LEGAL_TRANSITIONS: Record<InstanceStatus, readonly InstanceStatus[]> = {
  provisioning: ["active", "failed", "stopped"],
  active: ["idle", "stopped", "failed"],
  idle: ["active", "stopped", "failed"],
  stopped: ["provisioning"],
  failed: ["provisioning", "stopped"],
};

export function canTransition(from: InstanceStatus, to: InstanceStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isInstanceStatus(value: unknown): value is InstanceStatus {
  return (
    typeof value === "string" &&
    (INSTANCE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Upgrade-only on re-provision: spin-up must be same or stronger tier.
 * A rehydrated agent may climb (neuron -> money when the switch allows) but
 * never drop. Enforced in fleet-service.rehydrateFleetAgent.
 */
export function tierNotDowngraded(
  previous: LlmTier,
  next: LlmTier
): boolean {
  return rankOf(next) >= rankOf(previous);
}

/** Terminal-only fields validation for an instance spec. */
export function validateInstanceSpec(spec: {
  capability: string;
  llmTier: LlmTier;
  displayName?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!spec.capability || !spec.capability.trim()) {
    return { ok: false, reason: "capability_required" };
  }
  if (!spec.capability.trim().match(/^[a-z0-9_-]{1,64}$/i)) {
    return { ok: false, reason: "capability_invalid" };
  }
  if (!isLlmTier(spec.llmTier)) {
    return { ok: false, reason: "llmTier_unknown" };
  }
  if (spec.displayName && spec.displayName.length > 100) {
    return { ok: false, reason: "displayName_too_long" };
  }
  return { ok: true };
}
