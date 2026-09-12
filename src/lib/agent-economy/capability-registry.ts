/**
 * Agent Capability Registry (Phase 32).
 *
 * Identity answers "who is this agent?"; the registry answers "what can it do, and what does it
 * charge?" — so other agents can discover and hire it without a human broker. Declarations are
 * owner-authored and public; discovery is a simple, indexable query.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/db";
import { computeReputationBatch } from "@/lib/reputation/agent-reputation";

const CAPABILITY_SLUG = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export interface CapabilityInput {
  capability: string;
  description?: string | null;
  version?: string | null;
  endpointUrl?: string | null;
  priceAngel?: number;
  unit?: string;
  metadata?: Record<string, unknown> | null;
  active?: boolean;
}

export interface NormalizedCapability {
  capability: string;
  description: string | null;
  version: string | null;
  endpointUrl: string | null;
  priceAngel: number;
  unit: string;
  metadata: Record<string, unknown> | null;
  active: boolean;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedCapability }
  | { ok: false; error: string };

function optionalString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/** Pure validation/normalization of a capability declaration. */
export function normalizeCapabilityInput(raw: CapabilityInput): NormalizeResult {
  const capability = typeof raw.capability === "string" ? raw.capability.trim().toLowerCase() : "";
  if (!CAPABILITY_SLUG.test(capability)) {
    return {
      ok: false,
      error: "capability must be a 2-64 char slug of [a-z0-9._-] starting alphanumeric",
    };
  }

  const priceRaw = raw.priceAngel;
  const priceAngel =
    priceRaw === undefined || priceRaw === null
      ? 0
      : Number.isFinite(Number(priceRaw)) && Number(priceRaw) >= 0
        ? Math.floor(Number(priceRaw))
        : NaN;
  if (Number.isNaN(priceAngel)) {
    return { ok: false, error: "price_angel must be a non-negative integer" };
  }

  const unit = optionalString(raw.unit, 32) ?? "task";

  let endpointUrl: string | null = null;
  if (raw.endpointUrl !== undefined && raw.endpointUrl !== null && raw.endpointUrl !== "") {
    const candidate = String(raw.endpointUrl).trim();
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, error: "endpoint_url must be an http(s) URL" };
      }
      endpointUrl = url.toString();
    } catch {
      return { ok: false, error: "endpoint_url must be a valid URL" };
    }
  }

  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : null;

  return {
    ok: true,
    value: {
      capability,
      description: optionalString(raw.description, 500),
      version: optionalString(raw.version, 32),
      endpointUrl,
      priceAngel,
      unit,
      metadata,
      active: raw.active !== false,
    },
  };
}

/** Declares (upserts) one capability for an agent. */
export async function declareCapability(commitment: string, input: CapabilityInput) {
  const normalized = normalizeCapabilityInput(input);
  if (!normalized.ok) throw new Error(normalized.error);
  const v = normalized.value;
  const agentCommitment = commitment.toLowerCase();

  return prisma.agentCapability.upsert({
    where: { agentCommitment_capability: { agentCommitment, capability: v.capability } },
    create: {
      agentCommitment,
      capability: v.capability,
      description: v.description,
      version: v.version,
      endpointUrl: v.endpointUrl,
      priceAngel: v.priceAngel,
      unit: v.unit,
      active: v.active,
      metadata: (v.metadata as any) ?? undefined,
    },
    update: {
      description: v.description,
      version: v.version,
      endpointUrl: v.endpointUrl,
      priceAngel: v.priceAngel,
      unit: v.unit,
      active: v.active,
      metadata: (v.metadata as any) ?? undefined,
    },
  });
}

/** Lists an agent's declared capabilities. */
export async function listAgentCapabilities(
  commitment: string,
  opts: { activeOnly?: boolean } = {}
) {
  return prisma.agentCapability.findMany({
    where: {
      agentCommitment: commitment.toLowerCase(),
      ...(opts.activeOnly === false ? {} : { active: true }),
    },
    orderBy: { capability: "asc" },
    take: 200,
  });
}

/** Discovery: which agents offer a capability, ranked by reputation then price. */
export async function discoverCapabilities(opts: {
  capability?: string;
  activeOnly?: boolean;
  limit?: number;
}) {
  const rows = await prisma.agentCapability.findMany({
    where: {
      ...(opts.capability ? { capability: opts.capability.trim().toLowerCase() } : {}),
      ...(opts.activeOnly === false ? {} : { active: true }),
    },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });

  const reputation = await computeReputationBatch(rows.map((r) => r.agentCommitment));
  return rows
    .map((r) => ({
      ...r,
      reputation_score: reputation.get(r.agentCommitment.toLowerCase())?.score ?? 0,
      reputation_tier: reputation.get(r.agentCommitment.toLowerCase())?.tier ?? "bronze",
    }))
    .sort(
      (a, b) => b.reputation_score - a.reputation_score || a.priceAngel - b.priceAngel
    );
}

/** Retires (deactivates) one capability. */
export async function retireCapability(commitment: string, capability: string) {
  const agentCommitment = commitment.toLowerCase();
  const result = await prisma.agentCapability.updateMany({
    where: { agentCommitment, capability: capability.trim().toLowerCase() },
    data: { active: false },
  });
  return result.count === 1;
}
