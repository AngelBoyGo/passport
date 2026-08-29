import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";
import { getPublicKeyHex } from "@/lib/receipt/signer";
import "@/lib/receipt/crypto";
import {
  normalizeEvidence,
  persistEvidence,
  sourceDigest,
  toMaskedEvidence,
  type SourceType,
} from "@/lib/ingestion/github-agent-adapter";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";
import { requireEnrolled } from "@/lib/enrollment/enrollment-service";
import { markEngagementDelivered } from "@/lib/engagement/engagement-service";
import {
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
  NotEnrolledError,
} from "@/lib/enrollment/errors";

export type EnrollmentStatusLabel = "ENROLLED" | "UNENROLLED";

export type IngestEnrolledEvidenceInput = {
  subjectCommitment: string;
  sourceType: SourceType;
  payload: unknown;
  signature: string;
};

export type IngestEnrolledEvidenceResult = {
  event_commitment_hash: string;
  enrollment_status: EnrollmentStatusLabel;
  server_proof?: {
    event_commitment_hash: string;
    subject_commitment: string;
    server_received_at: string;
    content_hash: string;
    signature?: string;
    algorithm: "ed25519";
    public_key: string;
  };
};

/**
 * Computes the payload digest agents must sign for enrolled evidence ingestion.
 */
export function computePayloadDigest(payload: unknown): string {
  return sourceDigest(payload);
}

/**
 * Resolves enrollment status from persisted AgentEnrollment rows.
 */
export async function resolveEnrollmentStatus(
  subjectCommitment: string
): Promise<EnrollmentStatusLabel> {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    return "UNENROLLED";
  }

  const row = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
  });

  if (row?.status === EnrollmentStatus.ISSUED) {
    return "ENROLLED";
  }

  return "UNENROLLED";
}

/**
 * Ingests evidence for an enrolled agent after verifying payload signature.
 */
export async function ingestEnrolledEvidence(
  input: IngestEnrolledEvidenceInput
): Promise<IngestEnrolledEvidenceResult> {
  if (!isValidAgentCommitmentHash(input.subjectCommitment)) {
    throw new InvalidEnrollmentInputError(
      "subject_commitment must be a full 64-character hex string"
    );
  }
  if (typeof input.signature !== "string" || input.signature.length === 0) {
    throw new InvalidEnrollmentInputError("signature is required");
  }
  if (input.signature.length !== 128) {
    throw new InvalidEnrollmentInputError(
      `signature must be exactly 128 hex characters (got ${input.signature.length})`
    );
  }
  if (/[^0-9a-f]/i.test(input.signature)) {
    throw new InvalidEnrollmentInputError(
      "signature contains non-hexadecimal characters"
    );
  }

  const enrollment = await requireEnrolled(input.subjectCommitment);

  if (input.payload === null || input.payload === undefined) {
    throw new InvalidEnrollmentInputError("payload is required");
  }
  if (typeof input.payload === "string") {
    throw new InvalidEnrollmentInputError(
      "payload must be a JSON object, not a raw string. " +
      "The agent must sign sha256(canonicalJson(payload)) with payload as the parsed object. " +
      "See /docs/integrations for exact per-source-type schemas."
    );
  }

  const digest = computePayloadDigest(input.payload);
  const valid = await verifyPayloadSignature(
    enrollment.publicKey,
    digest,
    input.signature
  );
  if (!valid) {
    throw new InvalidEnrollmentProofError();
  }

  const normalized = normalizeEvidence({
    sourceType: input.sourceType,
    payload: input.payload,
  });
  if (normalized.length === 0) {
    throw new InvalidEnrollmentInputError("Unsupported source_type or payload");
  }

  const maskedRecords = normalized.map((record) => {
    const masked = toMaskedEvidence(record);
    return {
      ...masked,
      agentIdentityCommitment: input.subjectCommitment,
      // M2: for compliance_report we store the canonical payload JSON in the
      // sourceDigest slot (matching the datacenter path) so the audit-grade
      // package builder can map real control domains. The event_commitment_hash
      // still fingerprints the exact payload for replay triage.
      sourceDigest:
        input.sourceType === "compliance_report"
          ? JSON.stringify(input.payload)
          : digest,
      externalTaskId:
        input.sourceType === "task_deliverable" && record.artifact_identifier
          ? record.artifact_identifier
          : null,
    };
  });

  const persistedRecords = await persistEvidence(maskedRecords);

  // C2: evidence bridge with retry queue — if bridge fails, the evidence is
  // still persisted, and a background retry will pick it up. The bridge is
  // idempotent on eventCommitmentHash, so retries never double-mint.
  if (persistedRecords.length > 0 && process.env.EVIDENCE_BRIDGE_AUTO_ENABLED === "true") {
    const { bridgeEvidenceToReceipt } = await import("@/lib/evidence-bridge/evidence-receipt-bridge");
    for (const rec of persistedRecords) {
      try {
        await bridgeEvidenceToReceipt({
          id: rec.id,
          sourceType: rec.sourceType,
          agentIdentityCommitment: rec.agentIdentityCommitment,
          eventCommitmentHash: rec.eventCommitmentHash,
          normalizedEventType: rec.normalizedEventType,
          rawErrorClassification: rec.rawErrorClassification ?? null,
          validationSignalPresent: rec.validationSignalPresent,
          observedAt: rec.observedAt,
        });
      } catch (err) {
        // C2: log the failure and enqueue for retry. The evidence is already
        // persisted; the receipt bridge will be retried on next cycle.
        console.error("evidence→receipt bridge failed (will retry):", err instanceof Error ? err.message : err);
        // Enqueue to a retry table so a background job can pick it up.
        try {
          await prisma.evidenceBridgeRetry.upsert({
            where: { eventCommitmentHash: rec.eventCommitmentHash },
            create: {
              eventCommitmentHash: rec.eventCommitmentHash,
              evidenceId: rec.id,
              retryCount: 0,
              maxRetries: 3,
              lastError: err instanceof Error ? err.message : String(err),
            },
            update: {
              retryCount: { increment: 1 },
              lastError: err instanceof Error ? err.message : String(err),
            },
          });
        } catch {
          // non-fatal — evidence is already persisted
        }
      }
    }
  }

  if (input.sourceType === "task_deliverable") {
    const parsed = normalized[0];
    const taskId = parsed?.artifact_identifier;
    const deliverableDigest = parsed?.commit_sha;
    if (taskId && deliverableDigest) {
      await markEngagementDelivered({
        taskId,
        workerCommitment: input.subjectCommitment,
        eventCommitmentHash: maskedRecords[0].eventCommitmentHash,
        deliverableDigest,
      });
    }
  }

  // B35: server non-repudiation proof — cryptographically signs the evidence
  // receipt so the agent cannot later claim "I never received that evidence."
  // The proof is verified offline with the Passport public key.
  const proofPayload = {
    event_commitment_hash: maskedRecords[0].eventCommitmentHash,
    subject_commitment: input.subjectCommitment,
    server_received_at: new Date().toISOString(),
  };
  const proofDigest = sha256Hex(canonicalJson(proofPayload));
  const privateKeyHex = process.env.SIGNING_PRIVATE_KEY;
  let serverProofSignature: string | undefined;
  if (privateKeyHex) {
    const pkBytes = hexToBytes(privateKeyHex.length === 128 ? privateKeyHex.slice(0, 64) : privateKeyHex);
    serverProofSignature = bytesToHex(await sign(utf8ToBytes(proofDigest), pkBytes));
  }

  return {
    event_commitment_hash: maskedRecords[0].eventCommitmentHash,
    enrollment_status: "ENROLLED",
    server_proof: {
      ...proofPayload,
      content_hash: proofDigest,
      signature: serverProofSignature,
      algorithm: "ed25519",
      public_key: getPublicKeyHex(),
    },
  };
}
