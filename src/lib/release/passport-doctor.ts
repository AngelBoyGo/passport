import type { EnvValidationResult } from "@/lib/config/env";

export type DatabaseUrlKind = "postgres" | "sqlite" | "missing" | "unknown";

export type PassportDoctorPlan = {
  databaseUrlKind: DatabaseUrlKind;
  errors: string[];
  warnings: string[];
  nextCommands: string[];
  exitCode: 0 | 1;
};

export type CreatePassportDoctorPlanInput = {
  mode: string;
  databaseUrl?: string;
  envResult: EnvValidationResult;
};

const NEXT_COMMANDS = [
  "npx prisma migrate deploy",
  "deploy app",
  "BASE_URL=https://passport.example.com npm run smoke:github",
  "BASE_URL=https://passport.example.com npm run smoke:agent-enrollment",
] as const;

/**
 * Classifies DATABASE_URL by scheme without opening a database connection.
 */
export function classifyDatabaseUrl(
  databaseUrl: string | undefined
): DatabaseUrlKind {
  const normalized = databaseUrl?.trim().toLowerCase();
  if (!normalized) {
    return "missing";
  }
  if (
    normalized.startsWith("postgresql://") ||
    normalized.startsWith("postgres://")
  ) {
    return "postgres";
  }
  if (normalized.startsWith("file:") || normalized.startsWith("sqlite:")) {
    return "sqlite";
  }
  return "unknown";
}

/**
 * Returns true when the selected mode represents a real rollout target.
 */
export function isStagingOrProductionMode(mode: string): boolean {
  return mode === "staging" || mode === "production";
}

/**
 * Builds operator-facing rollout findings from env validation and DATABASE_URL.
 */
export function createPassportDoctorPlan(
  input: CreatePassportDoctorPlanInput
): PassportDoctorPlan {
  const errors: string[] = [];
  const warnings = [...input.envResult.warnings];
  const databaseUrlKind = classifyDatabaseUrl(input.databaseUrl);

  if (input.envResult.missingRequired.length > 0) {
    errors.push(
      `Missing required environment variables: ${input.envResult.missingRequired.join(
        ", "
      )}`
    );
  }

  if (
    databaseUrlKind === "sqlite" &&
    isStagingOrProductionMode(input.mode)
  ) {
    errors.push(
      "DATABASE_URL uses SQLite/file; staging/prod rollout requires PostgreSQL."
    );
  } else if (databaseUrlKind === "sqlite") {
    warnings.push(
      "DATABASE_URL uses SQLite/file; this is local/dev-only, not a real rollout database."
    );
  } else if (databaseUrlKind === "unknown") {
    warnings.push(
      "DATABASE_URL does not use a PostgreSQL scheme; real rollout requires postgres:// or postgresql://."
    );
  }

  return {
    databaseUrlKind,
    errors,
    warnings,
    nextCommands: [...NEXT_COMMANDS],
    exitCode: errors.length > 0 ? 1 : 0,
  };
}
