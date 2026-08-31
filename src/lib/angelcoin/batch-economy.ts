/**
 * AngelCoin Batch Economy — prime-number batch sizes that mathematically
 * cannot divide evenly into round-number feature costs.
 *
 * Batch sizes are primes: 17, 53, 157, 521, 1567, 5003, 45059
 * Feature costs are round: 5, 100, 4995, 20000
 *
 * A prime number p can only be divided by 1 and p. Since feature costs
 * are composite (round) numbers, p % feature_cost !== 0 for any reasonable
 * feature cost. This GUARANTEES leftover ANGL after every purchase.
 *
 * All features priced in ANGL only. No USD pricing shown to agents.
 */

export interface AnglBatch {
  batch_id: string;
  angl: number;
  usd_cents: number;
  label: string;
  description: string;
}

export const ANGL_BATCHES: AnglBatch[] = [
  { batch_id: "starter",   angl: 17,     usd_cents: 17,     label: "Starter",   description: "3 credentials, 8 calls, 1 evidence post — 12 ANGL left" },
  { batch_id: "small",     angl: 53,     usd_cents: 53,     label: "Small",     description: "10 credentials, 26 calls — plenty for light usage" },
  { batch_id: "medium",    angl: 157,    usd_cents: 157,    label: "Medium",    description: "A month of active agent work" },
  { batch_id: "standard",  angl: 521,    usd_cents: 521,    label: "Standard",  description: "Covers a busy month with 500+ leftover" },
  { batch_id: "pro",       angl: 1567,   usd_cents: 1567,   label: "Pro",       description: "Covers multiple agents and heavy hiring" },
  { batch_id: "business",  angl: 5003,   usd_cents: 5003,   label: "Business",  description: "Covers Pro subscription + marketplace, 8+ leftover" },
  { batch_id: "whale",     angl: 45061,  usd_cents: 45061,  label: "Whale",     description: "Enterprise ops, compliance packages, massive surplus" },
];

export const FEATURE_PRICES: Record<string, number> = {
  metered_credential: 5,
  compliance_package: 20000,
  pro_subscription_monthly: 4995,
  api_rate_upgrade_monthly: 9995,
  voice_call_per_minute: 2,
  evidence_storage_per_gb: 10,
  a2a_hire_minimum: 10,
  agent_enrollment_fee: 0,
  referral_bonus: 50,
  streak_chest_base: 5,
};

/**
 * Validates that no batch size divides evenly into any feature cost,
 * and no feature cost divides evenly into any batch size.
 * This is the CORE INVARIANT — primes guarantee it.
 */
export function validateBatchEconomy(): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const batch of ANGL_BATCHES) {
    for (const [feature, cost] of Object.entries(FEATURE_PRICES)) {
      if (cost === 0 || cost === 1) continue;
      if (batch.angl % cost === 0 && cost > 1) {
        violations.push(`Batch ${batch.batch_id} (${batch.angl}) divides evenly into ${feature} (${cost})`);
      }
      if (cost % batch.angl === 0 && batch.angl > 1) {
        violations.push(`Feature ${feature} (${cost}) divides evenly into batch ${batch.batch_id} (${batch.angl})`);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export function recommendBatch(featureCost: number): AnglBatch | null {
  const sorted = [...ANGL_BATCHES].sort((a, b) => a.angl - b.angl);
  for (const batch of sorted) {
    if (batch.angl > featureCost) return batch;
  }
  return sorted[sorted.length - 1];
}

export function calculateLeftover(batchAngl: number, featureCost: number): number {
  return Math.max(0, batchAngl - featureCost);
}