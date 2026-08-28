import { EnrollmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidAgentCommitmentHash } from "@/lib/public-portal/portal-service";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
  generateChallengeNonce,
  isValidPublicKeyHex,
} from "@/lib/enrollment/identity";
import { toAgentPresentation } from "@/lib/enrollment/presentation";
import { verifyChallengeSignature } from "@/lib/enrollment/proof";
import type { AgentPresentation } from "@/lib/enrollment/presentation";
import {
  ChallengeExpiredError,
  ChallengeNotFoundError,
  CommitmentMismatchError,
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
  NotEnrolledError,
} from "@/lib/enrollment/errors";

const DEFAULT_CHALLENGE_TTL_SECONDS = 300;

export type EnrollmentPassport = {
  subjectCommitment: string;
  status: EnrollmentStatus;
  publicKey: string;
  context: string;
  issuedAt: string | null;
  presentation?: AgentPresentation | null;
  challengeNonce?: string;
  expiresAt?: string;
};

/**
 * Reads challenge TTL from env with a safe default.
 */
export function getChallengeTtlSeconds(): number {
  const raw = process.env.ENROLLMENT_CHALLENGE_TTL_SECONDS;
  if (!raw?.trim()) {
    return DEFAULT_CHALLENGE_TTL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHALLENGE_TTL_SECONDS;
  }
  return Math.floor(parsed);
}

function toPassport(row: {
  subjectCommitment: string;
  publicKey: string;
  context: string;
  status: EnrollmentStatus;
  challengeNonce: string | null;
  challengeExpiresAt: Date | null;
  issuedAt: Date | null;
  photoUrl?: string | null;
  photoContentSha256?: string | null;
  photoMimeType?: string | null;
  photoUpdatedAt?: Date | null;
}): EnrollmentPassport {
  const presentation =
    row.photoUrl !== undefined
      ? toAgentPresentation({
          photoUrl: row.photoUrl ?? null,
          photoContentSha256: row.photoContentSha256 ?? null,
          photoMimeType: row.photoMimeType ?? null,
          photoUpdatedAt: row.photoUpdatedAt ?? null,
        })
      : undefined;

  return {
    subjectCommitment: row.subjectCommitment,
    status: row.status,
    publicKey: row.publicKey,
    context: row.context,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    presentation,
    challengeNonce: row.challengeNonce ?? undefined,
    expiresAt: row.challengeExpiresAt?.toISOString() ?? undefined,
  };
}

/**
 * Starts or resumes enrollment for an ed25519 public key.
 * Re-enroll on an ISSUED subject is idempotent (returns existing passport).
 */
export async function startEnrollment(
  publicKeyHex: string,
  context: string = DEFAULT_ENROLLMENT_CONTEXT
): Promise<EnrollmentPassport> {
  if (!isValidPublicKeyHex(publicKeyHex)) {
    throw new InvalidEnrollmentInputError(
      "public_key must be a 64-character hex ed25519 public key"
    );
  }
  if (!context.trim()) {
    throw new InvalidEnrollmentInputError("context must be non-empty");
  }

  // A1: global public key uniqueness — the same Ed25519 public key cannot be
  // enrolled in multiple contexts. One keypair = one identity forever.
  const existingKey = await prisma.agentEnrollment.findFirst({
    where: { publicKey: publicKeyHex.toLowerCase() },
    select: { subjectCommitment: true, context: true, status: true },
  });
  if (existingKey && existingKey.status === EnrollmentStatus.ISSUED) {
    throw new InvalidEnrollmentInputError(
      `This public key is already enrolled in context "${existingKey.context}". One keypair = one identity.`
    );
  }

  const subjectCommitment = deriveAgentCommitment(publicKeyHex, context);
  const existing = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
  });

  if (existing?.status === EnrollmentStatus.ISSUED) {
    return toPassport(existing);
  }

  const nonce = generateChallengeNonce();
  const expiresAt = new Date(Date.now() + getChallengeTtlSeconds() * 1000);

  const row = await prisma.agentEnrollment.upsert({
    where: { subjectCommitment },
    create: {
      subjectCommitment,
      publicKey: publicKeyHex.toLowerCase(),
      context,
      status: EnrollmentStatus.PENDING,
      challengeNonce: nonce,
      challengeExpiresAt: expiresAt,
    },
    update: {
      publicKey: publicKeyHex.toLowerCase(),
      context,
      status: EnrollmentStatus.PENDING,
      challengeNonce: nonce,
      challengeExpiresAt: expiresAt,
      issuedAt: null,
    },
  });

  if (
    deriveAgentCommitment(row.publicKey, row.context) !== row.subjectCommitment
  ) {
    throw new CommitmentMismatchError();
  }

  return toPassport(row);
}

/**
 * Completes enrollment by verifying the ed25519 signature over the challenge nonce.
 */
export async function completeEnrollment(
  subjectCommitment: string,
  signatureHex: string
): Promise<EnrollmentPassport> {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    throw new InvalidEnrollmentInputError(
      "subject_commitment must be a full 64-character hex string"
    );
  }
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) {
    throw new InvalidEnrollmentInputError(
      "signature must be a 128-character hex ed25519 signature"
    );
  }

  const row = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
  });

  if (!row || row.status !== EnrollmentStatus.PENDING) {
    throw new ChallengeNotFoundError();
  }

  if (
    deriveAgentCommitment(row.publicKey, row.context) !== row.subjectCommitment
  ) {
    throw new CommitmentMismatchError();
  }

  if (!row.challengeNonce || !row.challengeExpiresAt) {
    throw new ChallengeNotFoundError();
  }

  if (row.challengeExpiresAt.getTime() < Date.now()) {
    throw new ChallengeExpiredError();
  }

  const valid = await verifyChallengeSignature(
    row.publicKey,
    row.challengeNonce,
    signatureHex
  );
  if (!valid) {
    throw new InvalidEnrollmentProofError();
  }

  const issuedAt = new Date();
  const updated = await prisma.agentEnrollment.update({
    where: { subjectCommitment },
    data: {
      status: EnrollmentStatus.ISSUED,
      challengeNonce: null,
      challengeExpiresAt: null,
      issuedAt,
    },
  });

  return toPassport(updated);
}

/**
 * Returns the issued passport for a subject commitment, or null when unknown.
 */
export async function getPassport(
  subjectCommitment: string
): Promise<EnrollmentPassport | null> {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    return null;
  }

  const row = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
  });

  if (!row) {
    return null;
  }

  return toPassport(row);
}

/**
 * Requires an ISSUED enrollment for privileged operations.
 */
export async function requireEnrolled(subjectCommitment: string) {
  if (!isValidAgentCommitmentHash(subjectCommitment)) {
    throw new NotEnrolledError();
  }

  const row = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment },
  });

  if (!row || row.status !== EnrollmentStatus.ISSUED) {
    throw new NotEnrolledError();
  }

  return row;
}

/**
 * Returns true when credit operations should require enrollment.
 */
export function isEnrollmentEnforcedForCredits(): boolean {
  return process.env.ENFORCE_ENROLLMENT_FOR_CREDITS === "true";
}
