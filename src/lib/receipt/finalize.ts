import {
  FINAL_STATUSES,
  TERMINAL_STATUSES,
  type FinalizeReceiptInput,
} from "./types";

export interface FinalizeValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates finalize input for typed receipt outcomes.
 */
export function validateFinalizeInput(
  input: FinalizeReceiptInput
): FinalizeValidationResult {
  if (!FINAL_STATUSES.includes(input.status)) {
    return { valid: false, error: `Invalid finalize status: ${input.status}` };
  }

  if (input.status === "success" && !input.output_hash) {
    return { valid: false, error: "success requires output_hash" };
  }

  if (
    (input.status === "refusal" || input.status === "null") &&
    !input.refusal_reason
  ) {
    return {
      valid: false,
      error: "refusal/null requires refusal_reason",
    };
  }

  if (TERMINAL_STATUSES.includes(input.status) && !input.terminal_reason) {
    return {
      valid: false,
      error: "terminal states require terminal_reason",
    };
  }

  return { valid: true };
}
