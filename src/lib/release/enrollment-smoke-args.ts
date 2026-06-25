/**
 * Parses CLI args and env for the agent enrollment smoke script.
 */

export type EnrollmentSmokeArgs = {
  baseUrl: string;
  showHelp: boolean;
};

export type EnrollmentSmokeInputs = {
  baseUrl: string;
};

const DEFAULT_BASE_URL = "http://localhost:3000";

/**
 * Reads a named CLI flag value from argv (e.g. --base-url http://...).
 */
function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

/**
 * Returns true when argv asks for CLI usage text.
 */
function hasHelpFlag(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

/**
 * Parses enrollment smoke inputs with CLI precedence over env vars.
 */
export function parseEnrollmentSmokeArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): EnrollmentSmokeArgs {
  const baseUrl =
    readFlag(argv, "--base-url") ??
    env.BASE_URL?.trim() ??
    DEFAULT_BASE_URL;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    showHelp: hasHelpFlag(argv),
  };
}

/**
 * Validates enrollment smoke inputs before live probes run.
 */
export function assertEnrollmentSmokeInputs(
  args: Pick<EnrollmentSmokeArgs, "baseUrl">
): EnrollmentSmokeInputs {
  if (!args.baseUrl.trim()) {
    throw new Error("BASE_URL must be non-empty");
  }

  return { baseUrl: args.baseUrl };
}

/**
 * Formats CLI help for the enrollment smoke probes.
 */
export function formatEnrollmentSmokeHelp(): string {
  return [
    "Passport agent enrollment smoke (start -> complete -> evidence -> profile)",
    "",
    "BASE_URL should target the deployed/staging app for rollout verification.",
    "",
    "Usage:",
    "  BASE_URL=https://passport.example.com npm run smoke:agent-enrollment",
    "  npm run smoke:agent-enrollment -- --base-url https://passport.example.com",
    "",
    "Options:",
    "  --base-url <url>   Override BASE_URL",
    "  --help, -h         Show this help",
    "",
    "Success criteria:",
    "  POST /api/v1/passport/agents/enroll/start returns challenge",
    "  POST /api/v1/passport/agents/enroll/complete returns ISSUED",
    "  POST /api/v1/passport/agents/:id/evidence returns ENROLLED",
    "  GET /api/v1/profiles/:hash returns enrollment_status ENROLLED",
  ].join("\n");
}

/**
 * Formats live smoke script failures with local reachability guidance.
 */
export function formatEnrollmentSmokeError(
  error: unknown,
  baseUrl = DEFAULT_BASE_URL
): string {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode =
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof (error as { cause?: unknown }).cause === "object" &&
    (error as { cause?: { code?: unknown } }).cause !== null
      ? (error as { cause: { code?: unknown } }).cause.code
      : undefined;

  if (
    message === "fetch failed" ||
    (error instanceof Error && error.name === "AbortError") ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return [
      `Agent enrollment smoke could not reach Passport at ${baseUrl}.`,
      "Start or reuse a healthy local server with: npm run check:env, npm run db:status, then npm run dev",
      `Then confirm health with: curl ${baseUrl}/api/health`,
      `Original error: ${message}${causeCode ? ` (${causeCode})` : ""}`,
    ].join("\n");
  }

  return `Agent enrollment smoke script error: ${message}`;
}
