/**
 * Agent-to-Agent Hire Service — pure orchestration function.
 *
 * Chains: gate check → rights verification → escrow lock → engagement → receipt.
 * No DB, no HTTP — all dependencies injected for testability.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

export type HireErrorCode =
  | "insufficient_escrow"
  | "gate_denied"
  | "duplicate_proposal"
  | "invalid_signature"
  | "invalid_commitment"
  | "worker_not_found"
  | "self_hire"
  | "negative_amount"
  | "past_expiry"
  | "rate_limited"
  | "internal_error";

export interface HireTerms {
  amount: number;
  domain: string;
  scope: string;
  expiry: string;
}

export interface HireInput {
  hirer_commitment: string;
  worker_commitment: string;
  proposal_id: string;
  terms: HireTerms;
  signature: string;
}

export interface HireResult {
  success: boolean;
  proposal_id: string;
  engagement_id: string | null;
  receipt_id: string | null;
  status: "hired" | "rejected";
  error_code?: HireErrorCode;
  error_message?: string;
  worker_trust_report_url: string;
}

export interface GateResult {
  allow_invocation: boolean;
  reason?: string;
}

export interface WorkerInfo {
  operatorId: string;
  commitment: string;
  enrolled: boolean;
}

export interface HirerInfo {
  operatorId: string;
  commitment: string;
  credits: number;
}

export interface HireServiceDeps {
  /** Verify the Ed25519 signature over the hiring message */
  verifySignature: (message: string, signature: string) => Promise<boolean>;
  /** Check if the operator can operate in a domain */
  verifyGatePass: (operatorId: string, domain: string) => Promise<GateResult>;
  /** Create an engagement with escrow lock */
  createEngagement: (input: {
    taskId: string;
    hirerCommitment: string;
    workerCommitment: string;
    amount: number;
  }) => Promise<{ taskId: string; status: string }>;
  /** Look up worker by commitment */
  findWorker: (commitment: string) => Promise<WorkerInfo | null>;
  /** Look up hirer by commitment */
  findHirer: (commitment: string) => Promise<HirerInfo | null>;
  /** Log to admin audit trail */
  logAudit: (operatorId: string, action: string, targetId: string, details: string) => Promise<void>;
  /** Log a passport event */
  logEvent: (event: Record<string, unknown>) => void;
  /** Check rate limit */
  isRateLimited: (key: string) => boolean;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;

/**
 * Validates the hire input sanity checks, then delegates to the service
 * orchestration. This is a pure validation function — all side effects are
 * in the injected deps.
 */
export async function hireWorker(input: HireInput, deps: HireServiceDeps): Promise<HireResult> {
  // 1. Validate commitment hashes
  if (!HEX64_RE.test(input.hirer_commitment)) {
    return reject("invalid_commitment", "hirer_commitment must be a 64-character hex string");
  }
  if (!HEX64_RE.test(input.worker_commitment)) {
    return reject("invalid_commitment", "worker_commitment must be a 64-character hex string");
  }

  // 2. Self-hire check
  if (input.hirer_commitment.toLowerCase() === input.worker_commitment.toLowerCase()) {
    return reject("self_hire", "Hirer and worker must be different agents");
  }

  // 3. Valid proposal_id
  if (!input.proposal_id || input.proposal_id.length < 8) {
    return reject("invalid_commitment", "proposal_id must be at least 8 characters");
  }

  // 4. Validate terms
  if (!input.terms || typeof input.terms !== "object") {
    return reject("invalid_commitment", "terms are required");
  }
  if (!Number.isFinite(input.terms.amount) || input.terms.amount <= 0) {
    return reject("negative_amount", "amount must be a positive integer");
  }
  const expiryMs = new Date(input.terms.expiry).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    return reject("past_expiry", "expiry must be in the future");
  }
  if (!input.terms.domain || input.terms.domain.length < 2) {
    return reject("invalid_commitment", "domain is required");
  }
  if (!input.terms.scope || input.terms.scope.length < 4) {
    return reject("invalid_commitment", "scope must describe the work (at least 4 characters)");
  }

  // 5. Validate signature format
  if (!HEX128_RE.test(input.signature)) {
    return reject("invalid_signature", "signature must be a 128-character hex Ed25519 signature");
  }

  // 6. Rate limit check
  if (deps.isRateLimited(`hire:${input.hirer_commitment}`)) {
    return reject("rate_limited", "Too many hire requests. Try again later.");
  }

  // 7. Verify signature — Ed25519 verify of sha256(proposal_id + hirer + worker + canonicalTerms)
  const canonicalTerms = JSON.stringify(input.terms, Object.keys(input.terms).sort());
  const message = `${input.proposal_id}:${input.hirer_commitment}:${input.worker_commitment}:${canonicalTerms}`;
  const digest = bytesToHex(sha256(utf8ToBytes(message)));

  const sigValid = await deps.verifySignature(digest, input.signature);
  if (!sigValid) {
    return reject("invalid_signature", "Ed25519 signature verification failed");
  }

  // 8. Find hirer
  const hirer = await deps.findHirer(input.hirer_commitment);
  if (!hirer) {
    return reject("invalid_commitment", "Hirer not found");
  }

  // 9. Find worker
  const worker = await deps.findWorker(input.worker_commitment);
  if (!worker) {
    return reject("worker_not_found", "Worker not found");
  }

  // 10. Check escrow balance
  if (hirer.credits < input.terms.amount) {
    return reject("insufficient_escrow", `Hirer has ${hirer.credits} credits, needs ${input.terms.amount}`);
  }

  // 11. Gate pass check
  const gate = await deps.verifyGatePass(hirer.operatorId, input.terms.domain);
  if (!gate.allow_invocation) {
    return reject("gate_denied", `Gate pass denied: ${gate.reason || "Unknown reason"}`);
  }

  // 12. Create engagement (escrow lock)
  let engagement: { taskId: string; status: string };
  try {
    engagement = await deps.createEngagement({
      taskId: input.proposal_id,
      hirerCommitment: input.hirer_commitment,
      workerCommitment: input.worker_commitment,
      amount: input.terms.amount,
    });
  } catch (err: any) {
    if (err.message?.includes?.("DuplicateEngagement") || err.message?.includes?.("already exists")) {
      return reject("duplicate_proposal", `Proposal ${input.proposal_id} has already been processed`);
    }
    return reject("internal_error", err.message || "Failed to create engagement");
  }

  // 13. Audit log
  await deps.logAudit(hirer.operatorId, "a2a_hire", input.worker_commitment, JSON.stringify({
    proposal_id: input.proposal_id,
    amount: input.terms.amount,
    domain: input.terms.domain,
    scope: input.terms.scope,
    engagement_id: engagement.taskId,
  })).catch(() => {});

  // 14. Log event
  deps.logEvent({
    event: "a2a_hire",
    outcome: "hired",
    hirer: input.hirer_commitment.slice(0, 12),
    worker: input.worker_commitment.slice(0, 12),
    amount: input.terms.amount,
    domain: input.terms.domain,
    proposal_id: input.proposal_id,
  });

  return {
    success: true,
    proposal_id: input.proposal_id,
    engagement_id: engagement.taskId,
    receipt_id: null,
    status: "hired",
    worker_trust_report_url: `https://passport.metis.gold/verify/${input.worker_commitment}`,
  };
}

function reject(code: HireErrorCode, message: string): HireResult {
  return {
    success: false,
    proposal_id: "",
    engagement_id: null,
    receipt_id: null,
    status: "rejected",
    error_code: code,
    error_message: message,
    worker_trust_report_url: "",
  };
}