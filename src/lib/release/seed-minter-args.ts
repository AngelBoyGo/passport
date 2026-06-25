/**
 * Parses CLI args and env for the evidence-minter seed script.
 */

export const PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID =
  "cus_public_evidence_minter";

export const PUBLIC_EVIDENCE_MINTER_EMAIL =
  "public-evidence-minter@passport.internal";

export type SeedMinterArgs = {
  databaseUrl: string;
  stripeCustomerId: string;
  dryRun: boolean;
  showHelp: boolean;
};

/**
 * Reads a named CLI flag value from argv (e.g. --database-url postgres://...).
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
 * Returns true when argv requests a dry run (no DB writes).
 */
function hasDryRunFlag(argv: string[]): boolean {
  return argv.includes("--dry-run");
}

/**
 * Validates that a database URL is present and non-empty.
 */
export function requireDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Missing required env var: DATABASE_URL");
  }
  return url;
}

/**
 * Parses seed-minter inputs with CLI precedence over env vars.
 */
export function parseSeedMinterArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): SeedMinterArgs {
  const databaseUrl =
    readFlag(argv, "--database-url") ??
    env.DATABASE_URL?.trim() ??
    "";

  const stripeCustomerId =
    readFlag(argv, "--stripe-customer-id") ??
    env.PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID?.trim() ??
    PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID;

  return {
    databaseUrl,
    stripeCustomerId,
    dryRun: hasDryRunFlag(argv),
    showHelp: hasHelpFlag(argv),
  };
}

/**
 * Builds the Operator upsert payload for the public evidence minter.
 */
export function buildEvidenceMinterUpsert(stripeCustomerId: string) {
  return {
    where: { stripeCustomerId },
    create: {
      stripeCustomerId,
      email: PUBLIC_EVIDENCE_MINTER_EMAIL,
      tier: "service",
      credits: 0,
    },
    update: {},
  } as const;
}

/**
 * Formats CLI help for the evidence-minter seed command.
 */
export function formatSeedMinterHelp(): string {
  return [
    "Seed PUBLIC_EVIDENCE_MINTER Operator (idempotent upsert)",
    "",
    "Creates or finds the service-principal Operator row whose id becomes",
    "EVIDENCE_BRIDGE_OPERATOR_ID. Does not mutate other rows.",
    "",
    "Usage:",
    "  DATABASE_URL=postgresql://... npm run seed:evidence-minter",
    "  npm run seed:evidence-minter -- --database-url postgresql://...",
    "",
    "Options:",
    "  --database-url <url>         Override DATABASE_URL",
    "  --stripe-customer-id <id>    Override fixed stripe customer id",
    "  --dry-run                    Print intent without writing",
    "  --help, -h                   Show this help",
    "",
    `Default stripeCustomerId: ${PUBLIC_EVIDENCE_MINTER_STRIPE_CUSTOMER_ID}`,
  ].join("\n");
}
