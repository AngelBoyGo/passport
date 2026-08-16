import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
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
  if (!/^[0-9a-f]{128}$/i.test(input.signature)) {
    throw new InvalidEnrollmentInputError(
      "signature must be a 128-character hex ed25519 signature"
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
      sourceDigest: digest,
      externalTaskId:
        input.sourceType === "task_deliverable" && record.artifact_identifier
          ? record.artifact_identifier
          : null,
    };
  });

  await persistEvidence(maskedRecords);

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

  return {
    event_commitment_hash: maskedRecords[0].eventCommitmentHash,
    enrollment_status: "ENROLLED",
  };
}
