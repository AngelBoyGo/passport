export type OperationalDomain =
  | "FINANCIAL_CLEARING"
  | "CUSTOMER_SUPPORT"
  | "CODE_GENERATION"
  | "SYSTEM_INTEGRATION";

export type ErrorTranche =
  | "DATA_LEAKAGE"
  | "COMPUTE_TIMEOUT"
  | "LOGIC_DETECTION"
  | "SLA_BREACH"
  | "NONE";

export const OPERATIONAL_DOMAINS = [
  "FINANCIAL_CLEARING",
  "CUSTOMER_SUPPORT",
  "CODE_GENERATION",
  "SYSTEM_INTEGRATION",
] as const satisfies readonly OperationalDomain[];

export const ERROR_TRANCHES = [
  "DATA_LEAKAGE",
  "COMPUTE_TIMEOUT",
  "LOGIC_DETECTION",
  "SLA_BREACH",
  "NONE",
] as const satisfies readonly ErrorTranche[];

/**
 * Runtime guard for OperationalDomain values.
 */
export function isOperationalDomain(value: unknown): value is OperationalDomain {
  return (
    typeof value === "string" &&
    (OPERATIONAL_DOMAINS as readonly string[]).includes(value)
  );
}

/**
 * Runtime guard for ErrorTranche values.
 */
export function isErrorTranche(value: unknown): value is ErrorTranche {
  return (
    typeof value === "string" &&
    (ERROR_TRANCHES as readonly string[]).includes(value)
  );
}
