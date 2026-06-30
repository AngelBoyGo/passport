import { prisma } from "@/lib/db";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";
import { requireEnrolled } from "@/lib/enrollment/enrollment-service";
import {
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
} from "@/lib/enrollment/errors";
import {
  computePresentationDigest,
  toAgentPresentation,
  validatePresentationFields,
  type AgentPresentation,
} from "@/lib/enrollment/presentation";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";

export type UpdatePresentationInput = {
  subjectCommitment: string;
  photoUrl: string;
  photoContentSha256: string;
  photoMimeType: string;
  signature: string;
};

export type UpdatePresentationResult = {
  presentation: AgentPresentation | null;
};

/**
 * Updates or clears signed agent presentation (external photo reference).
 */
export async function updatePresentation(
  input: UpdatePresentationInput
): Promise<UpdatePresentationResult> {
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

  validatePresentationFields({
    photoUrl: input.photoUrl,
    photoContentSha256: input.photoContentSha256,
    photoMimeType: input.photoMimeType,
  });

  const enrollment = await requireEnrolled(input.subjectCommitment);
  const digest = computePresentationDigest({
    subjectCommitment: input.subjectCommitment,
    photoUrl: input.photoUrl,
    photoContentSha256: input.photoContentSha256,
    photoMimeType: input.photoMimeType,
  });

  const valid = await verifyPayloadSignature(
    enrollment.publicKey,
    digest,
    input.signature
  );
  if (!valid) {
    throw new InvalidEnrollmentProofError();
  }

  const clearing = input.photoUrl === "";

  const updated = await prisma.agentEnrollment.update({
    where: { subjectCommitment: input.subjectCommitment },
    data: clearing
      ? {
          photoUrl: null,
          photoContentSha256: null,
          photoMimeType: null,
          photoUpdatedAt: null,
        }
      : {
          photoUrl: input.photoUrl,
          photoContentSha256: input.photoContentSha256.toLowerCase(),
          photoMimeType: input.photoMimeType,
          photoUpdatedAt: new Date(),
        },
  });

  return {
    presentation: toAgentPresentation(updated),
  };
}

/**
 * Reads presentation for a subject commitment, or null when unset.
 */
export async function getPresentation(
  subjectCommitment: string
): Promise<AgentPresentation | null> {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    return null;
  }

  const row = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
    select: {
      photoUrl: true,
      photoContentSha256: true,
      photoMimeType: true,
      photoUpdatedAt: true,
    },
  });

  if (!row) {
    return null;
  }

  return toAgentPresentation(row);
}
