/**
 * Signer Provenance & Fail-Closed Verification (Phase 38).
 *
 * A signature is only meaningful if it is verified against a key the platform already
 * trusts (env-configured, DB registry, or a non-production genesis benchmark). A key
 * supplied by the caller must NEVER be used as the verification key: otherwise anyone
 * can self-assert a keypair and forge "verified" actions (sovereign quorum, milestone
 * payouts, swarm bounties, transit arrivals, smelting telemetry, ...).
 *
 * This helper centralizes that policy and emits a structured intrusion signal whenever
 * a caller-supplied key is rejected.
 */
import { verify } from "@noble/ed25519";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@/lib/receipt/canonical";
import { logPassportEvent } from "@/lib/observability/logger";

export type SignerProvenanceRejectReason =
  | "missing_pinned_key"
  | "provided_key_mismatch"
  | "malformed_key"
  | "malformed_signature"
  | "signature_mismatch"
  | "verification_error";

export interface VerifyPinnedSignatureInput {
  /** The trusted key resolved from env / DB registry. Caller input is never passed here. */
  pinnedKey?: string | null;
  /** Optional caller-supplied key, accepted only for compatibility; never used to verify. */
  providedKey?: string | null;
  signatureHex: string;
  /** A string is signed as raw UTF-8; an object is canonicalized with canonicalJson. */
  signPayload: string | Record<string, unknown>;
  /** Operation identifier for telemetry, e.g. "reserves.quorum.sign". */
  context: string;
  /** Commitment / resource identifier for telemetry. */
  commitment?: string;
}

export interface VerifyPinnedSignatureResult {
  valid: boolean;
  reason?: SignerProvenanceRejectReason;
}

const RE_HEX_64 = /^[0-9a-f]{64}$/i;
const RE_HEX_128 = /^[0-9a-f]{128}$/i;

function normalizeHex(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Constant-time comparison for equal-length hex strings. Public keys are not secret, but
 * this avoids trivial timing oracles on key equality.
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function signingMessage(payload: string | Record<string, unknown>): Uint8Array {
  return typeof payload === "string"
    ? utf8ToBytes(payload)
    : utf8ToBytes(canonicalJson(payload));
}

function reject(
  input: VerifyPinnedSignatureInput,
  reason: SignerProvenanceRejectReason,
  httpStatus = 401
): VerifyPinnedSignatureResult {
  logPassportEvent({
    event: "signature_provenance_rejected",
    outcome: "rejected",
    http_status: httpStatus,
    reason_code: reason,
    subject_commitment: input.commitment,
    source_type: input.context,
  });
  return { valid: false, reason };
}

/**
 * Fail-closed enforcement gate. Enforcement is ON in production, or explicitly via
 * ENFORCE_SIGNATURES=1 (so staging can enforce without NODE_ENV=production).
 */
export function signaturesEnforced(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.ENFORCE_SIGNATURES === "1"
  );
}

/**
 * Verifies an Ed25519 signature strictly against a pinned key.
 *
 * Order of checks (all rejections are logged as intrusion signals):
 *  1. providedKey present and != pinnedKey        -> provided_key_mismatch
 *  2. no pinned key                                -> missing_pinned_key
 *  3. malformed pinned key / signature             -> malformed_key / malformed_signature
 *  4. signature does not verify                    -> signature_mismatch
 */
export async function verifyPinnedSignature(
  input: VerifyPinnedSignatureInput
): Promise<VerifyPinnedSignatureResult> {
  const pinnedKey = normalizeHex(input.pinnedKey);
  const providedKey = normalizeHex(input.providedKey);

  if (providedKey && pinnedKey && !constantTimeEqualHex(providedKey, pinnedKey)) {
    return reject(input, "provided_key_mismatch");
  }
  if (!pinnedKey) {
    return reject(input, "missing_pinned_key");
  }
  if (!RE_HEX_64.test(pinnedKey)) {
    return reject(input, "malformed_key");
  }

  const signatureHex = normalizeHex(input.signatureHex);
  if (!RE_HEX_128.test(signatureHex)) {
    return reject(input, "malformed_signature");
  }

  try {
    const ok = await verify(
      hexToBytes(signatureHex),
      signingMessage(input.signPayload),
      hexToBytes(pinnedKey)
    );
    if (!ok) {
      return reject(input, "signature_mismatch");
    }
    return { valid: true };
  } catch {
    return reject(input, "verification_error");
  }
}
