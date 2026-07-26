/** Thrown when subjectCommitment is not a valid 64-hex agent identity commitment. */
export class InvalidAgentCommitmentError extends Error {
  constructor() {
    super("agent_commitment_hash must be a full 64-character hex string");
    this.name = "InvalidAgentCommitmentError";
  }
}

/** Thrown when an AngelCoin amount is invalid for the entry type. */
export class InvalidAngelCoinAmountError extends Error {
  constructor(message = "AngelCoin amount must be positive") {
    super(message);
    this.name = "InvalidAngelCoinAmountError";
  }
}

/** Thrown when a transfer or spend exceeds available AngelCoin balance. */
export class InsufficientAngelCoinFundsError extends Error {
  constructor(message = "Insufficient AngelCoin credits") {
    super(message);
    this.name = "InsufficientAngelCoinFundsError";
  }
}

/** Thrown when no AngelCoin account exists for the subject commitment. */
export class AngelCoinAccountNotFoundError extends Error {
  constructor() {
    super("AngelCoin account not found");
    this.name = "AngelCoinAccountNotFoundError";
  }
}

/** Thrown when unlock amount exceeds locked balance. */
export class InvalidUnlockAmountError extends Error {
  constructor() {
    super("Unlock amount exceeds locked balance");
    this.name = "InvalidUnlockAmountError";
  }
}
