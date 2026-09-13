/**
 * Economy Health (Phase 37).
 *
 * The Black Paper's Q9/Q63 health signals, computed from real rows and signed: is the economy
 * externally funded (external USD revenue) rather than self-minted, and is money actually
 * circulating (velocity) rather than hoarded? Signed like every other assurance surface so a
 * third party can verify the numbers offline.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { parityStatus } from "@/lib/monetary/parity";
import { signReportPayload } from "@/lib/raillab/report-signing";

const DAY_MS = 24 * 3600_000;
const TOPUP_KINDS = ["stablecoin_topup", "angelcoin_topup", "angelcoin_on_behalf", "external_revenue"];

export const ECONOMY_HEALTH_MAX_SCAN = 100_000;

export const ECONOMY_HEALTH_VERIFY_INSTRUCTIONS =
  "Recompute content_hash = sha256(canonicalJson(response without `snapshot`, top-level keys sorted)), then verify the ed25519 `signature` over utf8(content_hash) with `public_key`. If it verifies, the economy-health numbers were not tampered with.";

export interface EconomyHealthInput {
  wallets: { balance: number; staked: number }[];
  reserveEntries: { deltaMicros: number }[];
  revenue: { grossUsdCents: number }[];
  purchases: { totalAngel: number; status: string; createdAt: Date; verificationVerdict: string | null }[];
  engagements: { amount: number; createdAt: Date; status: string }[];
  disputes: { status: string }[];
  capabilities: { active: boolean; verified: boolean }[];
  offers: { status: string; remainingUnits: number }[];
  jobs: { status: string }[];
}

export interface EconomyHealth {
  supply_angel: number;
  staked_angel: number;
  reserve_usd: number;
  coverage_ratio: number;
  reserve_adequate: boolean;
  external_revenue_usd: number;
  external_revenue_entries: number;
  /** Fraction of the reserve that came from outside the system (0..1). */
  external_reserve_share: number;
  settled_volume_angel_30d: number;
  velocity_30d: number;
  disputes: { open: number; resolved: number };
  verifications: number;
  capabilities: { declared: number; verified: number };
  compute_offers_active: number;
  pipeline_jobs: { submitted: number; sold: number };
  generated_at: string;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Pure aggregation over already-fetched rows. */
export function computeEconomyHealth(
  input: EconomyHealthInput,
  now: Date = new Date()
): EconomyHealth {
  const nowMs = now.getTime();
  const since30 = nowMs - 30 * DAY_MS;

  const supply = input.wallets.reduce((s, w) => s + w.balance, 0);
  const staked = input.wallets.reduce((s, w) => s + w.staked, 0);
  const reserveUsd = input.reserveEntries.reduce((s, r) => s + Math.abs(r.deltaMicros) / 10_000 / 100, 0);
  const externalUsd = input.revenue.reduce((s, r) => s + r.grossUsdCents / 100, 0);

  const parity = parityStatus({ supplyAngel: supply, reserveUsd });

  const settledVolume30 = input.purchases
    .filter((p) => p.createdAt.getTime() >= since30)
    .reduce((s, p) => s + p.totalAngel, 0);
  const engagementVolume30 = input.engagements
    .filter((e) => e.createdAt.getTime() >= since30)
    .reduce((s, e) => s + e.amount, 0);
  const volume30 = settledVolume30 + engagementVolume30;

  return {
    supply_angel: supply,
    staked_angel: staked,
    reserve_usd: round(reserveUsd, 2),
    coverage_ratio: parity.coverageRatio,
    reserve_adequate: parity.reserveAdequate,
    external_revenue_usd: round(externalUsd, 2),
    external_revenue_entries: input.revenue.length,
    external_reserve_share: reserveUsd > 0 ? round(externalUsd / reserveUsd) : 0,
    settled_volume_angel_30d: volume30,
    velocity_30d: supply > 0 ? round(volume30 / supply) : 0,
    disputes: {
      open: input.disputes.filter((d) => d.status === "OPEN").length,
      resolved: input.disputes.filter((d) => d.status === "RESOLVED").length,
    },
    verifications: input.purchases.filter((p) => p.verificationVerdict !== null).length,
    capabilities: {
      declared: input.capabilities.filter((c) => c.active).length,
      verified: input.capabilities.filter((c) => c.active && c.verified).length,
    },
    compute_offers_active: input.offers.filter((o) => o.status === "ACTIVE" && o.remainingUnits > 0).length,
    pipeline_jobs: {
      submitted: input.jobs.filter((j) => j.status === "SUBMITTED").length,
      sold: input.jobs.filter((j) => j.status === "SOLD").length,
    },
    generated_at: now.toISOString(),
  };
}

async function safeScan<T>(table: string, fn: () => Promise<T[]>, reasons: string[]): Promise<T[]> {
  try {
    const rows = await fn();
    if (rows.length >= ECONOMY_HEALTH_MAX_SCAN) reasons.push(`${table}: scan truncated`);
    return rows;
  } catch (err) {
    reasons.push(`${table}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function fetchInput(reasons: string[]): Promise<EconomyHealthInput> {
  const [wallets, reserveEntries, revenue, purchases, engagements, disputes, capabilities, offers, jobs] =
    await Promise.all([
      safeScan("agentWallet", () => prisma.agentWallet.findMany({ select: { balance: true, staked: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("operatorLedgerEntry", () => prisma.operatorLedgerEntry.findMany({ where: { kind: { in: TOPUP_KINDS } }, select: { deltaMicros: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("agentRevenue", () => prisma.agentRevenue.findMany({ select: { grossUsdCents: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("computePurchase", () => prisma.computePurchase.findMany({ select: { totalAngel: true, status: true, createdAt: true, verificationVerdict: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("engagement", () => prisma.engagement.findMany({ select: { amount: true, createdAt: true, status: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("computeDispute", () => prisma.computeDispute.findMany({ select: { status: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("agentCapability", () => prisma.agentCapability.findMany({ select: { active: true, verified: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("computeOffer", () => prisma.computeOffer.findMany({ select: { status: true, remainingUnits: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
      safeScan("pipelineJob", () => prisma.pipelineJob.findMany({ select: { status: true }, take: ECONOMY_HEALTH_MAX_SCAN }), reasons),
    ]);

  return {
    wallets: wallets.map((w: any) => ({ balance: w.balance ?? 0, staked: w.staked ?? 0 })),
    reserveEntries: reserveEntries.map((r: any) => ({ deltaMicros: r.deltaMicros ?? 0 })),
    revenue: revenue.map((r: any) => ({ grossUsdCents: r.grossUsdCents ?? 0 })),
    purchases: purchases.map((p: any) => ({ totalAngel: p.totalAngel ?? 0, status: p.status, createdAt: p.createdAt, verificationVerdict: p.verificationVerdict ?? null })),
    engagements: engagements.map((e: any) => ({ amount: e.amount ?? 0, createdAt: e.createdAt, status: e.status })),
    disputes: disputes.map((d: any) => ({ status: d.status })),
    capabilities: capabilities.map((c: any) => ({ active: Boolean(c.active), verified: Boolean(c.verified) })),
    offers: offers.map((o: any) => ({ status: o.status, remainingUnits: o.remainingUnits ?? 0 })),
    jobs: jobs.map((j: any) => ({ status: j.status })),
  };
}

export interface EconomyHealthResponse {
  success: true;
  health: EconomyHealth;
  degraded: boolean;
  degraded_reasons: string[];
  verify_instructions: string;
  snapshot: { content_hash: string; signature: string; public_key: string; algorithm: "ed25519" };
}

export async function buildEconomyHealth(now: Date = new Date()): Promise<EconomyHealthResponse> {
  const reasons: string[] = [];
  const input = await fetchInput(reasons);
  const health = computeEconomyHealth(input, now);

  const signedBody: Record<string, unknown> = {
    success: true,
    health,
    degraded: reasons.length > 0,
    degraded_reasons: reasons,
    verify_instructions: ECONOMY_HEALTH_VERIFY_INSTRUCTIONS,
  };
  const snapshot = signReportPayload(signedBody);

  return {
    success: true,
    health,
    degraded: reasons.length > 0,
    degraded_reasons: reasons,
    verify_instructions: ECONOMY_HEALTH_VERIFY_INSTRUCTIONS,
    snapshot: { ...snapshot, algorithm: "ed25519" },
  };
}