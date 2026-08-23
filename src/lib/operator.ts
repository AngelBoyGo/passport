import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type PrismaTx = Prisma.TransactionClient;

/**
 * SHA-256 hash of an API key for storage (never store raw keys).
 */
export function hashApiKey(key: string): string {
  return bytesToHex(sha256(utf8ToBytes(key)));
}

/**
 * Derives operator_id from Stripe customer ID (Sybil-resistant anchor).
 */
export function operatorIdFromStripe(stripeCustomerId: string): string {
  return `op_${stripeCustomerId}`;
}

/**
 * Ensures an operator exists for a Stripe customer, creating if needed.
 */
export async function ensureOperator(
  stripeCustomerId: string,
  email?: string | null,
  client: PrismaTx | typeof prisma = prisma
) {
  return client.operator.upsert({
    where: { stripeCustomerId },
    create: {
      stripeCustomerId,
      email: email ?? undefined,
      credits: 100,
      tier: "free",
    },
    update: email ? { email } : {},
  });
}

/**
 * Parses a public operator id (`op_cus_...`) into the Stripe customer id.
 */
export function parsePublicOperatorId(token: string): string | null {
  const match = /^op_(cus_[A-Za-z0-9_]+)$/.exec(token);
  return match ? match[1] : null;
}

/**
 * Resolves an operator from a public operator id token.
 */
export async function resolveOperatorByPublicId(token: string) {
  const stripeCustomerId = parsePublicOperatorId(token);
  if (!stripeCustomerId) return null;
  return prisma.operator.findUnique({ where: { stripeCustomerId } });
}

/**
 * Registers or retrieves an agent under an operator.
 */
export async function ensureAgent(
  operatorId: string,
  agentId: string,
  domain?: string,
  client: PrismaTx | typeof prisma = prisma
) {
  return client.agent.upsert({
    where: {
      operatorId_agentId: { operatorId, agentId },
    },
    create: { operatorId, agentId, domain },
    update: domain ? { domain } : {},
  });
}

/**
 * Authenticates a Bearer API key and returns the operator with role information.
 */
export async function authenticateApiKey(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const key = authHeader.slice(7).trim();
  if (!key) return null;

  const keyHash = hashApiKey(key);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { operator: true },
  });

  if (!apiKey?.operator) return null;

  // C4: role comes from the PERSISTED row, never inferred from the presented
  // key prefix (an attacker could self-label a fabricated pp_ent_ prefix).
  const role: "ISSUER" | "HOLDER" = apiKey.role === "HOLDER" ? "HOLDER" : "ISSUER";
  return {
    ...apiKey.operator,
    apiKeyRole: role,
    apiKeyRow: apiKey,
  };
}

/**
 * Creates a new API key for an operator (Enterprise Issuer or Subject Holder); returns the raw key once.
 * Persists the role ON THE ROW (C4), so RBAC is enforced from stored state.
 * Gracefully supports (operatorId, name, role, client) or (operatorId, name, client).
 */
export async function createApiKey(
  operatorId: string,
  name?: string,
  roleOrClient?: "ISSUER" | "HOLDER" | PrismaTx | typeof prisma,
  clientArg?: PrismaTx | typeof prisma
) {
  let role: "ISSUER" | "HOLDER" = "ISSUER";
  let client: PrismaTx | typeof prisma = prisma;

  if (typeof roleOrClient === "string") {
    role = roleOrClient;
    if (clientArg) client = clientArg;
  } else if (roleOrClient) {
    client = roleOrClient;
  }

  const prefix = role === "HOLDER" ? "pp_usr_" : "pp_ent_";
  const rawKey = `${prefix}${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  await client.apiKey.create({
    data: {
      operatorId,
      keyHash: hashApiKey(rawKey),
      name,
      role,
    },
  });
  return rawKey;
}

/**
 * Decrements operator credits atomically; returns false if insufficient.
 * Uses an atomic conditional update (H7): WHERE credits >= amount, so
 * concurrent spends cannot push the balance negative (double-spend fix).
 */
export async function decrementCredits(
  operatorId: string,
  amount = 1,
  client: PrismaTx | typeof prisma = prisma
) {
  const result = await client.operator.updateMany({
    where: { id: operatorId, credits: { gte: amount } },
    data: { credits: { decrement: amount } },
  });
  return result.count > 0;
}

/**
 * Records a capability ledger event (separate from match ledger).
 */
export async function recordCapabilityEvent(
  operatorId: string,
  eventType: string,
  agentId?: string,
  receiptId?: string,
  metadata?: string,
  client: PrismaTx | typeof prisma = prisma
) {
  return client.capabilityLedgerEntry.create({
    data: { operatorId, agentId, receiptId, eventType, metadata },
  });
}

/**
 * Records a match/settlement ledger event.
 */
export async function recordMatchEvent(
  operatorId: string,
  eventType: string,
  receiptId?: string,
  amount?: number,
  metadata?: string,
  client: PrismaTx | typeof prisma = prisma
) {
  return client.matchLedgerEntry.create({
    data: { operatorId, receiptId, eventType, amount, metadata },
  });
}
