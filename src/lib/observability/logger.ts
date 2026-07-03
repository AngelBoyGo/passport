export type PassportLogOutcome = "issued" | "pending" | "rejected" | "error";

export type PassportLogEvent = {
  event:
    | "enroll_start"
    | "enroll_complete"
    | "evidence_ingest"
    | "presentation_update"
    | "gate_verify"
    | "receipt_issue"
    | "credits_read"
    | "unhandled_error";
  outcome: PassportLogOutcome;
  http_status: number;
  reason_code?: string;
  subject_commitment?: string;
  source_type?: string;
  event_commitment_hash?: string;
  photo_content_sha256?: string;
  cleared?: boolean;
  rate_limited?: boolean;
  request_id?: string;
  latency_ms?: number;
};

const ALLOWED_LOG_KEYS: (keyof PassportLogEvent)[] = [
  "event",
  "outcome",
  "http_status",
  "reason_code",
  "subject_commitment",
  "source_type",
  "event_commitment_hash",
  "photo_content_sha256",
  "cleared",
  "rate_limited",
  "request_id",
  "latency_ms",
];

/**
 * Picks only privacy-safe log fields; never includes request bodies or secrets.
 */
function sanitizeLogEvent(event: PassportLogEvent): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of ALLOWED_LOG_KEYS) {
    const value = event[key];
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Emits one structured JSON log line to stdout (stderr for errors). Never throws.
 */
export function logPassportEvent(event: PassportLogEvent): void {
  try {
    const payload = sanitizeLogEvent(event);
    const line = `${JSON.stringify(payload)}\n`;
    if (
      event.http_status >= 500 ||
      event.outcome === "error" ||
      event.event === "unhandled_error"
    ) {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  } catch {
    // observability must not affect request handling
  }
}

/**
 * Maps enrollment HTTP status codes to stable reason codes for logging.
 */
export function enrollmentReasonCode(status: number): string {
  switch (status) {
    case 400:
      return "validation_error";
    case 401:
      return "invalid_proof";
    case 403:
      return "not_enrolled";
    case 404:
      return "challenge_not_found";
    case 410:
      return "challenge_expired";
    default:
      return "rejected";
  }
}
