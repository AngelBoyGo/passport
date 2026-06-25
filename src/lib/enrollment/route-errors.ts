import { NextResponse } from "next/server";
import {
  ChallengeExpiredError,
  ChallengeNotFoundError,
  CommitmentMismatchError,
  InvalidEnrollmentInputError,
  InvalidEnrollmentProofError,
  NotEnrolledError,
} from "@/lib/enrollment/errors";

/**
 * Maps enrollment service errors to HTTP responses.
 */
export function enrollmentErrorResponse(err: unknown): NextResponse | null {
  if (
    err instanceof InvalidEnrollmentInputError ||
    (err instanceof Error && err.name === "InvalidEnrollmentInputError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }
  if (
    err instanceof CommitmentMismatchError ||
    (err instanceof Error && err.name === "CommitmentMismatchError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Commitment mismatch" },
      { status: 400 }
    );
  }
  if (
    err instanceof InvalidEnrollmentProofError ||
    (err instanceof Error && err.name === "InvalidEnrollmentProofError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid proof" },
      { status: 401 }
    );
  }
  if (
    err instanceof ChallengeNotFoundError ||
    (err instanceof Error && err.name === "ChallengeNotFoundError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Challenge not found" },
      { status: 404 }
    );
  }
  if (
    err instanceof ChallengeExpiredError ||
    (err instanceof Error && err.name === "ChallengeExpiredError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Challenge expired" },
      { status: 410 }
    );
  }
  if (
    err instanceof NotEnrolledError ||
    (err instanceof Error && err.name === "NotEnrolledError")
  ) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not enrolled" },
      { status: 403 }
    );
  }
  return null;
}
