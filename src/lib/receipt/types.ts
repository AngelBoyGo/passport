import type { ErrorTranche, OperationalDomain } from "@prisma/client";

/** Receipt type: custody (observed) vs competence (action-authorizing). */
export type ReceiptType = "custody" | "competence";

/** Receipt lifecycle status. */
export type ReceiptStatus =
  | "pending"
  | "success"
  | "refusal"
  | "null"
  | "graceful_shutdown"
  | "timeout"
  | "failure_tombstone";

export type RevocationStatus = "active" | "revoked";

/** Canonical signed receipt payload (hash-only storage). */
export interface ReceiptPayload {
  receipt_id: string;
  issued_at: string;
  operator_id: string;
  agent_id: string;
  receipt_type: ReceiptType;
  status: ReceiptStatus;
  input_digest: string;
  authority_scope: string;
  expiry: string;
  revocation_status: RevocationStatus;
  output_hash?: string;
  refusal_reason?: string;
  terminal_reason?: string;
  prev_receipt_hash?: string;
  domain?: string;
  domain_commitment?: string;
  blind_salt?: string;
  error_tranche?: string;
  content_hash: string;
  signature?: string;
}

export interface IssueReceiptInput {
  operator_id: string;
  agent_id: string;
  receipt_type: ReceiptType;
  input_digest: string;
  authority_scope: string;
  expiry: string;
  prev_receipt_hash?: string;
  domain?: OperationalDomain;
  blind?: boolean;
}

export interface FinalizeReceiptInput {
  status: Exclude<
    ReceiptStatus,
    "pending"
  >;
  output_hash?: string;
  refusal_reason?: string;
  terminal_reason?: string;
  error_tranche?: ErrorTranche;
}

export const TERMINAL_STATUSES: ReceiptStatus[] = [
  "graceful_shutdown",
  "timeout",
  "failure_tombstone",
];

export const FINAL_STATUSES: ReceiptStatus[] = [
  "success",
  "refusal",
  "null",
  ...TERMINAL_STATUSES,
];
