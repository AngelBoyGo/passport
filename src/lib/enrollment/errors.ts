/** Thrown when enrollment input (public key, commitment, signature) is malformed. */
export class InvalidEnrollmentInputError extends Error {
  constructor(message = "Invalid enrollment input") {
    super(message);
    this.name = "InvalidEnrollmentInputError";
  }
}

/** Thrown when a derived commitment does not match the stored enrollment record. */
export class CommitmentMismatchError extends Error {
  constructor() {
    super("Enrollment commitment mismatch");
    this.name = "CommitmentMismatchError";
  }
}

/** Thrown when no pending challenge exists for the subject commitment. */
export class ChallengeNotFoundError extends Error {
  constructor() {
    super("Enrollment challenge not found");
    this.name = "ChallengeNotFoundError";
  }
}

/** Thrown when the enrollment challenge has expired. */
export class ChallengeExpiredError extends Error {
  constructor() {
    super("Enrollment challenge expired");
    this.name = "ChallengeExpiredError";
  }
}

/** Thrown when the cryptographic enrollment proof is invalid. */
export class InvalidEnrollmentProofError extends Error {
  constructor() {
    super("Invalid enrollment proof");
    this.name = "InvalidEnrollmentProofError";
  }
}

/** Thrown when an operation requires an ISSUED enrollment. */
export class NotEnrolledError extends Error {
  constructor() {
    super("Agent is not enrolled");
    this.name = "NotEnrolledError";
  }
}
