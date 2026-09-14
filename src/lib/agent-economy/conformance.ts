/**
 * Capability conformance challenge (Phase 33).
 *
 * `verified: true` must mean something. A conformance check sends a random, signed challenge to
 * the capability's declared endpoint; the agent must echo the nonce and return an Ed25519
 * signature over the canonical challenge using the key it enrolled with. Passing proves the
 * endpoint is live AND controlled by the enrolled agent — the baseline for trusting a
 * capability, the same way an ACME challenge proves control of a domain.
 */

import { bytesToHex } from "@noble/hashes/utils.js";
import { verifyPinnedSignature } from "@/lib/auth/verifyPinnedSignature";
import "@/lib/receipt/crypto";
import { prisma } from "@/lib/db";
import { canonicalJson } from "@/lib/receipt/canonical";

export const CONFORMANCE_TIMEOUT_MS = 5000;
const SIGNATURE_RE = /^[0-9a-f]{128}$/i;

export interface ConformanceChallenge {
  capability: string;
  agent_commitment: string;
  nonce: string;
  issued_at: string;
}

export function buildConformanceChallenge(
  capability: string,
  agentCommitment: string,
  nonce: string,
  now: Date
): ConformanceChallenge {
  return {
    capability: capability.toLowerCase(),
    agent_commitment: agentCommitment.toLowerCase(),
    nonce,
    issued_at: now.toISOString(),
  };
}

/** Canonical (signable) form of the challenge. */
export function canonicalChallenge(c: ConformanceChallenge): string {
  return canonicalJson({
    capability: c.capability,
    agent_commitment: c.agent_commitment,
    nonce: c.nonce,
    issued_at: c.issued_at,
  });
}

export interface ConformanceResult {
  ok: boolean;
  reason?: string;
}

export async function runConformanceCheck(input: {
  capability: string;
  agentCommitment: string;
  endpointUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  now?: Date;
}): Promise<ConformanceResult> {
  const agentCommitment = input.agentCommitment.toLowerCase();

  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: agentCommitment },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return { ok: false, reason: "agent is not enrolled" };
  }

  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = buildConformanceChallenge(
    input.capability,
    agentCommitment,
    nonce,
    input.now ?? new Date()
  );

  const doFetch = input.fetchImpl ?? globalThis.fetch;
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFORMANCE_TIMEOUT_MS);
    try {
      res = await doFetch(input.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-passport-conformance": "1" },
        body: JSON.stringify(challenge),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, reason: `endpoint unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) return { ok: false, reason: `endpoint returned HTTP ${res.status}` };

  let body: { nonce?: unknown; signature?: unknown };
  try {
    body = (await res.json()) as { nonce?: unknown; signature?: unknown };
  } catch {
    return { ok: false, reason: "response was not valid JSON" };
  }

  if (String(body.nonce ?? "") !== nonce) {
    return { ok: false, reason: "challenge nonce was not echoed" };
  }
  const signature = String(body.signature ?? "");
  if (!SIGNATURE_RE.test(signature)) {
    return { ok: false, reason: "missing or malformed Ed25519 signature" };
  }

  try {
    const check = await verifyPinnedSignature({
      pinnedKey: enrollment.publicKey,
      signatureHex: signature,
      signPayload: canonicalChallenge(challenge),
      context: "agent-economy.conformance.verify",
      commitment: challenge.agent_commitment,
    });
    return check.valid ? { ok: true } : { ok: false, reason: "signature verification failed" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "signature verification error" };
  }
}

/** Runs the check and flips `verified` on success. */
export async function verifyCapability(input: {
  capability: string;
  agentCommitment: string;
  fetchImpl?: typeof globalThis.fetch;
  now?: Date;
}): Promise<ConformanceResult> {
  const capability = input.capability.trim().toLowerCase();
  const agentCommitment = input.agentCommitment.toLowerCase();

  const row = await prisma.agentCapability.findUnique({
    where: { agentCommitment_capability: { agentCommitment, capability } },
  });
  if (!row) return { ok: false, reason: "capability is not declared" };
  if (!row.endpointUrl) return { ok: false, reason: "capability has no endpoint_url to challenge" };

  const result = await runConformanceCheck({
    capability,
    agentCommitment,
    endpointUrl: row.endpointUrl,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!result.ok) return result;

  await prisma.agentCapability.updateMany({
    where: { agentCommitment, capability },
    data: { verified: true },
  });
  return { ok: true };
}
