/**
 * Parses CLI args and env for the AngelCoin mutation smoke script.
 */

export type AngelcoinSmokeArgs = {
  baseUrl: string;
  apiKey?: string;
  subjectCommitment?: string;
  showHelp: boolean;
};

export type AngelcoinSmokeInputs = {
  baseUrl: string;
  apiKey: string;
  subjectCommitment: string;
};

const DEFAULT_BASE_URL = "http://localhost:3000";
const COMMITMENT_PATTERN = /^[0-9a-f]{64}$/i;

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
 * Parses AngelCoin smoke inputs with CLI precedence over env vars.
 */
export function parseAngelcoinSmokeArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): AngelcoinSmokeArgs {
  const baseUrl =
    readFlag(argv, "--base-url") ??
    env.BASE_URL?.trim() ??
    DEFAULT_BASE_URL;

  const apiKey =
    readFlag(argv, "--api-key") ?? env.PASSPORT_API_KEY?.trim() ?? undefined;

  const subjectCommitment =
    readFlag(argv, "--subject-commitment") ??
    env.SUBJECT_COMMITMENT?.trim() ??
    undefined;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    subjectCommitment,
    showHelp: hasHelpFlag(argv),
  };
}

/**
 * Validates required AngelCoin smoke inputs before mutation probes run.
 */
export function assertAngelcoinSmokeInputs(
  args: Pick<AngelcoinSmokeArgs, "baseUrl" | "apiKey" | "subjectCommitment">
): AngelcoinSmokeInputs {
  if (!args.apiKey?.trim()) {
    throw new Error(
      "Missing PASSPORT_API_KEY (or --api-key) required for authenticated grant probe"
    );
  }

  const subjectCommitment = args.subjectCommitment?.trim();
  if (!subjectCommitment) {
    throw new Error(
      "Missing SUBJECT_COMMITMENT (or --subject-commitment) required for AngelCoin smoke"
    );
  }

  if (!COMMITMENT_PATTERN.test(subjectCommitment)) {
    throw new Error(
      "SUBJECT_COMMITMENT must be a full 64-character hex string"
    );
  }

  return {
    baseUrl: args.baseUrl,
    apiKey: args.apiKey.trim(),
    subjectCommitment,
  };
}

/**
 * Formats CLI help for the AngelCoin smoke probes.
 */
export function formatAngelcoinSmokeHelp(): string {
  return [
    "Passport AngelCoin smoke (grant + passport-live read)",
    "",
    "BASE_URL should target the deployed/staging app for rollout verification.",
    "",
    "Usage:",
    "  PASSPORT_API_KEY=pp_... SUBJECT_COMMITMENT=<64-hex> BASE_URL=https://passport.example.com npm run smoke:angelcoin",
    "  npm run smoke:angelcoin -- --base-url https://passport.example.com --api-key pp_... --subject-commitment <64-hex>",
    "",
    "Options:",
    "  --base-url <url>                 Override BASE_URL",
    "  --api-key <key>                  Override PASSPORT_API_KEY (never logged)",
    "  --subject-commitment <64-hex>    Override SUBJECT_COMMITMENT",
    "  --help, -h                       Show this help",
    "",
    "Success criteria:",
    "  POST /api/v1/passport/credits/grants returns 201",
    "  GET /api/v1/passport/agents/:id/passport-live returns 200 with accessTier, storedAccessTier, availableBalance",
  ].join("\n");
}
