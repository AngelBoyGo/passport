/**
 * Bridge compliance guardrails (F bank).
 *
 * - Sanctions/geofence screening of withdrawal targets.
 * - KYC enforcement for withdrawals in live (or when opted in).
 * - Reserve-yield policy invariant: reserve backing yield NEVER passes to
 *   AngelCoin holders — it is company revenue only.
 */

function envList(name: string): Set<string> {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** F1: block a withdrawal address (sanctions list) or country (ISO-2 geofence). */
export function shouldBlockWithdrawal(
  address: string,
  opts?: { countryCode?: string }
): boolean {
  const blocked = envList("ANGL_BLOCKED_ADDRESSES");
  if (address && blocked.has(address.trim().toLowerCase())) return true;

  if (opts?.countryCode) {
    const cc = opts.countryCode.trim().toUpperCase();
    const countries = envList("ANGL_BLOCKED_COUNTRIES");
    if (countries.has(cc.toLowerCase())) return true;
  }
  return false;
}

/** F2: is the operator KYC sufficient for withdrawals in this environment? */
export function kycGateForWithdraw(operatorKycStatus: string): boolean {
  const enforced = process.env.ANGL_WITHDRAW_KYC_ONLY === "true" || process.env.BRIDGE_ENV === "live";
  if (!enforced) return true;
  return operatorKycStatus === "APPROVED";
}

/** F3: reserve-yield policy invariant. Holder yield is forbidden. */
export function assertReserveYieldPolicy(opts: { holderYield: boolean }): void {
  if (opts.holderYield) {
    throw new Error("Reserve yield must never pass to AngelCoin holders (company revenue only)");
  }
}

/** F3b: compose mandatory audit metadata for a mint/burn journal entry. */
export function auditMetadata(input: { rail: string; bridgeRef?: string; kycStatus?: string; geofence?: string; amount?: number }): string {
  return JSON.stringify({
    rail: input.rail,
    bridgeRef: input.bridgeRef ?? null,
    kycStatus: input.kycStatus ?? "NOT_REQUIRED",
    geofence: input.geofence ?? "UNSPECIFIED",
    amount: input.amount,
  });
}