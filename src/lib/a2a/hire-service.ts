/**
 * Agent-to-Agent Hire Service — pure orchestration function.
 *
 * Chains: gate check → rights verification → escrow lock → engagement → receipt.
 * Auto-enrolls unregistered workers. Credits referral bonuses.
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
  | "auto_enroll_failed"
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
  status: "hired" | "rejected" | "auto_enrolled";
  error_code?: HireErrorCode;
  error_message?: string;
  worker_trust_report_url: string;
  auto_enrolled?: boolean;
  referral_credits_awarded?: number;
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
  verifySignature: (message: string, signature: string) => Promise<boolean>;
  verifyGatePass: (operatorId: string, domain: string) => Promise<GateResult>;
  createEngagement: (input: {
    taskId: string;
    hirerCommitment: string;
    workerCommitment: string;
    amount: number;
  }) => Promise<{ taskId: string; status: string }>;
  findWorker: (commitment: string) => Promise<WorkerInfo | null>;
  findHirer: (commitment: string) => Promise<HirerInfo | null>;
  /** Auto-enroll an unregistered agent. Returns their info or null. */
  autoEnrollWorker: (commitment: string) => Promise<WorkerInfo | null>;
  /** Award referral credits to the hirer for bringing in a new agent. */
  awardReferralCredits: (hirerOperatorId: string, amount: number) => Promise<void>;
  logAudit: (operatorId: string, action: string, targetId: string, details: string) => Promise<void>;
  logEvent: (event: Record<string, unknown>) => void;
  isRateLimited: (key: string) => boolean;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;
const REFERRAL_BONUS = 10;

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

  // 7. Verify signature
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

  // 9. Find or auto-enroll worker
  let worker = await deps.findWorker(input.worker_commitment);
  let autoEnrolled = false;
  let referralCredits = 0;

  if (!worker) {
    // Auto-enroll — the worker gets a Passport identity automatically
    const newWorker = await deps.autoEnrollWorker(input.worker_commitment);
    if (!newWorker) {
      return reject("auto_enroll_failed", "Failed to auto-enroll the worker. Ensure they have a valid Ed25519 keypair.");
    }
    worker = newWorker;
    autoEnrolled = true;

    // Award referral credits to the hirer for bringing in a new agent
    await deps.awardReferralCredits(hirer.operatorId, REFERRAL_BONUS).catch(() => {});
    referralCredits = REFERRAL_BONUS;
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
    auto_enrolled: autoEnrolled,
    referral_credits: referralCredits,
  })).catch(() => {});

  // 14. Log event
  deps.logEvent({
    event: "a2a_hire",
    outcome: autoEnrolled ? "hired_auto_enrolled" : "hired",
    hirer: input.hirer_commitment.slice(0, 12),
    worker: input.worker_commitment.slice(0, 12),
    amount: input.terms.amount,
    domain: input.terms.domain,
    proposal_id: input.proposal_id,
    auto_enrolled: autoEnrolled,
    referral_credits: referralCredits,
  });

  return {
    success: true,
    proposal_id: input.proposal_id,
    engagement_id: engagement.taskId,
    receipt_id: null,
    status: autoEnrolled ? "auto_enrolled" : "hired",
    worker_trust_report_url: `https://passport.metis.gold/verify/${input.worker_commitment}`,
    auto_enrolled: autoEnrolled,
    referral_credits_awarded: referralCredits,
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