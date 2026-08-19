import { createHash } from "node:crypto";
import type { PassportClient, EvidencePayload } from "../client.js";
import type { ErrorTranche } from "../enums.js";

export interface PassportAuditOptions {
  client: PassportClient;
  subjectCommitment: string;
  sourceType?: string;
  signDigest?: (digest: string) => Promise<string> | string;
  serviceToken?: string;
  onAuditComplete?: (result: {
    eventCommitmentHash?: string;
    latencyMs: number;
    error?: Error;
  }) => void;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(obj: unknown): string {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return JSON.stringify(obj);
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of sorted) ordered[key] = (obj as Record<string, unknown>)[key];
  return JSON.stringify(ordered);
}

/**
 * Classifies uncaught runtime exceptions into typed Passport ErrorTranches.
 */
export function classifyExecutionError(message: string): ErrorTranche {
  const lower = message.toLowerCase();
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("rate limit") ||
    lower.includes("token limit") ||
    lower.includes("429")
  ) {
    return "COMPUTE_TIMEOUT";
  }
  if (
    lower.includes("schema") ||
    lower.includes("validation") ||
    lower.includes("parse") ||
    lower.includes("type error")
  ) {
    return "LOGIC_DETECTION";
  }
  return "SLA_BREACH";
}

/**
 * Higher-order interceptor for async AI agent functions.
 * Captures execution timing, hashes inputs/outputs deterministically,
 * classifies runtime exceptions, and posts signed evidence to Passport.
 */
export function withPassportAudit<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: PassportAuditOptions
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const startMs = Date.now();
    const startedAt = new Date(startMs).toISOString();

    const inputDigest = sha256Hex(JSON.stringify(args));
    let output: TReturn;
    let executionError: Error | undefined;

    try {
      output = await fn(...args);
    } catch (err) {
      executionError = err instanceof Error ? err : new Error(String(err));
      const endMs = Date.now();
      const finishedAt = new Date(endMs).toISOString();

      // Submit execution failure evidence if signDigest is available
      if (options.signDigest) {
        try {
          const payload: EvidencePayload = {
            task_id: `fail-${startMs}`,
            digest: inputDigest,
            error_classification: classifyExecutionError(executionError.message),
            observed_at: finishedAt,
          };

          const { signature } = await options.client.signEvidence(payload, options.signDigest);
          const result = await options.client.postEvidence(
            options.subjectCommitment,
            options.sourceType ?? "task_deliverable",
            payload,
            signature,
            { serviceToken: options.serviceToken }
          );

          options.onAuditComplete?.({
            eventCommitmentHash: result.event_commitment_hash,
            latencyMs: endMs - startMs,
            error: executionError,
          });
        } catch {
          // Observability never blocks original error
        }
      }

      throw executionError;
    }

    const endMs = Date.now();
    const finishedAt = new Date(endMs).toISOString();
    const outputDigest = sha256Hex(JSON.stringify(output ?? null));

    if (options.signDigest) {
      try {
        const payload: EvidencePayload = {
          task_id: `task-${startMs}`,
          digest: outputDigest,
          observed_at: finishedAt,
        };

        const { signature } = await options.client.signEvidence(payload, options.signDigest);
        const result = await options.client.postEvidence(
          options.subjectCommitment,
          options.sourceType ?? "task_deliverable",
          payload,
          signature,
          { serviceToken: options.serviceToken }
        );

        options.onAuditComplete?.({
          eventCommitmentHash: result.event_commitment_hash,
          latencyMs: endMs - startMs,
        });
      } catch {
        // Observability non-blocking
      }
    }

    return output;
  };
}
