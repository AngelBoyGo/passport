/**
 * Delegation Service — OAuth-style scoped access for AI agents.
 *
 * Agents grant platforms time-limited, revocable access without sharing
 * master API keys. Each delegation token has:
 *   - scope: what the platform can do (read_reputation, post_evidence, etc.)
 *   - expiry: time-limited (default 30 days)
 *   - revocability: agent can revoke at any time
 *
 * The agent signs the delegation request with their Ed25519 private key.
 * The platform receives a delegation token it uses as a Bearer token.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const DELEGATION_SCOPES = [
  "read_reputation",
  "post_evidence",
  "hire_agents",
  "manage_wallet",
  "send_messages",
] as const;

export type DelegationScope = (typeof DELEGATION_SCOPES)[number];

export interface DelegationRequest {
  agent_commitment: string;
  platform_name: string;
  scopes: DelegationScope[];
  expiry_days?: number;
  signature: string;
  nonce: string;
}

export interface DelegationToken {
  token: string;
  agent_commitment: string;
  platform_name: string;
  scopes: DelegationScope[];
  expires_at: string;
  created_at: string;
}

export interface DelegationDeps {
  verifySignature: (message: string, signature: string, publicKey: string) => Promise<boolean>;
  getAgentPublicKey: (commitment: string) => Promise<string | null>;
  isAgentEnrolled: (commitment: string) => Promise<boolean>;
  storeToken: (data: {
    agentCommitment: string;
    platformName: string;
    scopes: string[];
    nonce: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<void>;
  now: () => Date;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;

/**
 * Computes the delegation token hash (what we store, never the raw token).
 */
export function hashDelegationToken(rawToken: string): string {
  return bytesToHex(sha256(utf8ToBytes(rawToken)));
}

/**
 * Builds the delegation message the agent must sign.
 */
export function buildDelegationMessage(params: {
  agent_commitment: string;
  platform_name: string;
  scopes: string[];
  nonce: string;
  expiry_days: number;
}): string {
  return [
    "passport:delegate",
    params.agent_commitment,
    params.platform_name,
    params.scopes.sort().join(","),
    params.nonce,
    String(params.expiry_days),
  ].join(":");
}

/**
 * Issues a delegation token after verifying the agent's signature.
 */
export async function issueDelegationToken(
  input: DelegationRequest,
  deps: DelegationDeps
): Promise<{ token: string; expires_at: string } | { error: string; code: string }> {
  // 1. Validate commitment
  if (!HEX64_RE.test(input.agent_commitment)) {
    return { error: "Invalid agent_commitment", code: "invalid_commitment" };
  }

  // 2. Validate platform name
  if (!input.platform_name || input.platform_name.length < 2) {
    return { error: "platform_name is required (min 2 chars)", code: "invalid_platform" };
  }

  // 3. Validate scopes
  if (!input.scopes || input.scopes.length === 0) {
    return { error: "At least one scope is required", code: "invalid_scopes" };
  }
  for (const scope of input.scopes) {
    if (!DELEGATION_SCOPES.includes(scope as DelegationScope)) {
      return {
        error: `Invalid scope: ${scope}. Valid scopes: ${DELEGATION_SCOPES.join(", ")}`,
        code: "invalid_scope",
      };
    }
  }

  // 4. Validate nonce
  if (!input.nonce || input.nonce.length < 8) {
    return { error: "nonce is required (min 8 chars)", code: "invalid_nonce" };
  }

  // 5. Validate signature format
  if (!HEX128_RE.test(input.signature)) {
    return { error: "signature must be 128-hex Ed25519", code: "invalid_signature" };
  }

  // 6. Check agent is enrolled
  const enrolled = await deps.isAgentEnrolled(input.agent_commitment);
  if (!enrolled) {
    return { error: "Agent not enrolled", code: "not_enrolled" };
  }

  // 7. Resolve public key
  const publicKey = await deps.getAgentPublicKey(input.agent_commitment);
  if (!publicKey) {
    return { error: "Agent public key not found", code: "no_public_key" };
  }

  // 8. Verify signature
  const expiryDays = Math.min(Math.max(input.expiry_days ?? 30, 1), 365);
  const message = buildDelegationMessage({
    agent_commitment: input.agent_commitment,
    platform_name: input.platform_name,
    scopes: input.scopes,
    nonce: input.nonce,
    expiry_days: expiryDays,
  });

  const sigValid = await deps.verifySignature(message, input.signature, publicKey);
  if (!sigValid) {
    return { error: "Invalid delegation signature", code: "signature_failed" };
  }

  // 9. Generate token
  const rawToken = `pdel_${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const tokenHash = hashDelegationToken(rawToken);
  const expiresAt = new Date(deps.now().getTime() + expiryDays * 86400_000);

  // 10. Store
  await deps.storeToken({
    agentCommitment: input.agent_commitment.toLowerCase(),
    platformName: input.platform_name,
    scopes: input.scopes,
    nonce: input.nonce,
    tokenHash,
    expiresAt,
  });

  return {
    token: rawToken,
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Validates a delegation token for a given scope.
 * Returns the agent commitment if valid, null if invalid/expired/revoked.
 */
export function validateDelegationScope(
  tokenData: { scopes: string[]; expiresAt: Date; revoked: boolean } | null,
  requiredScope: DelegationScope
): string | null {
  if (!tokenData) return null;
  if (tokenData.revoked) return null;
  if (tokenData.expiresAt < new Date()) return null;
  if (!tokenData.scopes.includes(requiredScope)) return null;
  return "valid";
}