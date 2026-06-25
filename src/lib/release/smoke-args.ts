/**
 * Parses CLI args and env for the read-only GitHub smoke script.
 */
import { classifyDatabaseUrl } from "./passport-doctor";

export type SmokeArgs = {
  baseUrl: string;
  agentHash?: string;
  receiptId?: string;
  showHelp: boolean;
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
 * Returns true for base URLs that target a local development server.
 */
function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Parses smoke-test inputs with CLI precedence over env vars.
 */
export function parseSmokeArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): SmokeArgs {
  const baseUrl =
    readFlag(argv, "--base-url") ??
    env.BASE_URL?.trim() ??
    DEFAULT_BASE_URL;

  const agentHash =
    readFlag(argv, "--agent-hash") ?? env.AGENT_HASH?.trim() ?? undefined;

  const receiptId =
    readFlag(argv, "--receipt-id") ?? env.RECEIPT_ID?.trim() ?? undefined;

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    agentHash,
    receiptId,
    showHelp: hasHelpFlag(argv),
  };
}

/**
 * Builds non-fatal smoke warnings without contacting the target app.
 */
export function buildSmokeWarnings(
  args: Pick<SmokeArgs, "baseUrl">,
  env: Record<string, string | undefined> = process.env
): string[] {
  const warnings: string[] = [];
  const databaseUrlKind = classifyDatabaseUrl(env.DATABASE_URL);

  if (isLocalBaseUrl(args.baseUrl) && databaseUrlKind === "sqlite") {
    warnings.push(
      "BASE_URL is local while DATABASE_URL uses SQLite/file; this is local/dev-only and does not verify staging/prod rollout."
    );
  }

  return warnings;
}

/**
 * Formats CLI help for the read-only GitHub smoke probes.
 */
export function formatSmokeHelp(): string {
  return [
    "Passport GitHub smoke (read-only)",
    "",
    "BASE_URL should target the deployed/staging app for rollout verification.",
    "",
    "Usage:",
    "  BASE_URL=https://passport.example.com npm run smoke:github",
    "  npm run smoke:github -- --base-url https://passport.example.com",
    "  AGENT_HASH=<64-hex> RECEIPT_ID=<receipt-id> BASE_URL=https://passport.example.com npm run smoke:github",
    "",
    "Options:",
    "  --base-url <url>       Override BASE_URL",
    "  --agent-hash <64-hex>  Probe /api/v1/profiles/:hash when known",
    "  --receipt-id <id>      Probe /api/v1/receipts/:id/public-manifest when known",
    "  --help, -h             Show this help",
    "",
    "When AGENT_HASH or RECEIPT_ID is omitted, that deep probe is skipped.",
  ].join("\n");
}
