/**
 * Centralized environment validation (lazy — reads process.env at call time, never at import).
 */

export const REQUIRED_PROD_ENV = [
  "DATABASE_URL",
  "SIGNING_PRIVATE_KEY",
  "INGESTION_COMMITMENT_SALT",
] as const;

export const OPTIONAL_ENV = [
  "EVIDENCE_BRIDGE_OPERATOR_ID",
  "EVIDENCE_ENFORCEMENT_ENABLED",
  "NEXT_PUBLIC_APP_URL",
  "ENFORCE_ENROLLMENT_FOR_CREDITS",
  "ENROLLMENT_CHALLENGE_TTL_SECONDS",
  "ENROLLMENT_RATE_LIMIT_MAX",
  "ENROLLMENT_RATE_LIMIT_WINDOW_MS",
] as const;

const STRIPE_CONDITIONAL_ENV = [
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type EnvValidationResult = {
  ok: boolean;
  missingRequired: string[];
  warnings: string[];
  enabledFlags: Record<string, boolean>;
};

export type EnvReport = {
  presence: Record<string, boolean>;
  enabledFlags: Record<string, boolean>;
};

export type ValidateEnvOptions = {
  mode?: string;
};

/**
 * Returns true when running under Vitest or NODE_ENV=test (matches ingestion adapter ergonomics).
 */
function isTestMode(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true"
  );
}

/**
 * Returns true when env enforcement should throw on missing required vars.
 */
function isEnforcedMode(mode?: string): boolean {
  const resolved = mode ?? process.env.NODE_ENV ?? "development";
  return resolved === "production" || resolved === "staging";
}

/**
 * Returns true when an env var is set to a non-empty trimmed value.
 */
function envPresent(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "";
}

/**
 * Collects all missing required env var names (never values).
 */
function collectMissingRequired(): string[] {
  const missing: string[] = [];

  for (const name of REQUIRED_PROD_ENV) {
    if (!envPresent(name)) {
      missing.push(name);
    }
  }

  if (envPresent("STRIPE_SECRET_KEY")) {
    for (const name of STRIPE_CONDITIONAL_ENV) {
      if (!envPresent(name)) {
        missing.push(name);
      }
    }
  }

  return [...new Set(missing)];
}

/**
 * Collects non-fatal warnings for optional or degraded configuration.
 */
function collectWarnings(): string[] {
  const warnings: string[] = [];

  for (const name of OPTIONAL_ENV) {
    if (!envPresent(name)) {
      warnings.push(`Optional env var not set: ${name}`);
    }
  }

  if (!envPresent("STRIPE_SECRET_KEY")) {
    warnings.push(
      "Stripe not configured (STRIPE_SECRET_KEY unset) — dev/mock billing mode"
    );
  }

  return warnings;
}

/**
 * Returns feature-flag booleans derived from env presence (no secret values).
 */
function collectEnabledFlags(): Record<string, boolean> {
  return {
    evidenceBridgeOperator: envPresent("EVIDENCE_BRIDGE_OPERATOR_ID"),
    evidenceEnforcement:
      process.env.EVIDENCE_ENFORCEMENT_ENABLED === "true",
    stripeConfigured: envPresent("STRIPE_SECRET_KEY"),
    enrollmentCreditEnforcement:
      process.env.ENFORCE_ENROLLMENT_FOR_CREDITS === "true",
  };
}

/**
 * Validates required and conditional env vars. Throws in production/staging when required vars are missing.
 */
export function validateEnv(
  options: ValidateEnvOptions = {}
): EnvValidationResult {
  if (isTestMode()) {
    return {
      ok: true,
      missingRequired: [],
      warnings: [],
      enabledFlags: collectEnabledFlags(),
    };
  }

  const missingRequired = collectMissingRequired();
  const warnings = collectWarnings();
  const enabledFlags = collectEnabledFlags();
  const ok = missingRequired.length === 0;

  if (!ok && isEnforcedMode(options.mode)) {
    throw new Error(
      `Missing required environment variables: ${missingRequired.join(", ")}`
    );
  }

  return { ok, missingRequired, warnings, enabledFlags };
}

/**
 * Returns env presence booleans and enabled flags for operator logging (no values).
 */
export function getEnvReport(): EnvReport {
  const tracked = [
    ...REQUIRED_PROD_ENV,
    ...OPTIONAL_ENV,
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO",
  ];

  const presence: Record<string, boolean> = {};
  for (const name of tracked) {
    presence[name] = envPresent(name);
  }

  return { presence, enabledFlags: collectEnabledFlags() };
}
