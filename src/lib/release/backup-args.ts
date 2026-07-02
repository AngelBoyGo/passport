/**
 * Parses CLI args for database backup and restore-verify release scripts.
 */

export type BackupArgs =
  | {
      ok: true;
      databaseUrl: string;
      outputPath: string;
      dryRun: boolean;
    }
  | { ok: false; error: string };

export type RestoreVerifyArgs =
  | { ok: true; dumpPath: string; dryRun: boolean }
  | { ok: false; error: string };

const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.($|[\\/])/;

/**
 * Reads a named CLI flag value from argv (e.g. --output ./backups/dump.sql).
 */
function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  const next = argv[index + 1];
  if (next.startsWith("--")) {
    return undefined;
  }
  return next;
}

/**
 * Returns true when argv asks for CLI usage text.
 */
function hasHelpFlag(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

/**
 * Validates backup output paths reject traversal and empty values.
 */
export function validateBackupOutputPath(
  outputPath: string
): { ok: true } | { ok: false; error: string } {
  const trimmed = outputPath.trim();
  if (!trimmed) {
    return { ok: false, error: "Output path is required" };
  }

  if (PATH_TRAVERSAL_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error: "Output path must not contain path traversal segments (..)",
    };
  }

  return { ok: true };
}

/**
 * Redacts database credentials for safe logging.
 */
export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return databaseUrl.replace(/:([^:@/]+)@/, ":***@");
  }
}

/**
 * Parses backup CLI args with env fallback for DATABASE_URL.
 */
export function parseBackupArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): BackupArgs {
  if (hasHelpFlag(argv)) {
    return { ok: false, error: "help" };
  }

  const databaseUrl =
    readFlag(argv, "--database-url")?.trim() ??
    env.DATABASE_URL?.trim() ??
    undefined;

  if (!databaseUrl) {
    return {
      ok: false,
      error: "DATABASE_URL (or --database-url) is required for database backup",
    };
  }

  const outputPath = readFlag(argv, "--output");
  if (!outputPath) {
    return { ok: false, error: "--output is required" };
  }

  const outputValidation = validateBackupOutputPath(outputPath);
  if (!outputValidation.ok) {
    return { ok: false, error: outputValidation.error };
  }

  return {
    ok: true,
    databaseUrl,
    outputPath: outputPath.trim(),
    dryRun: argv.includes("--dry-run"),
  };
}

/**
 * Parses restore-verify skeleton CLI args.
 */
export function parseRestoreVerifyArgs(argv: string[]): RestoreVerifyArgs {
  if (hasHelpFlag(argv)) {
    return { ok: false, error: "help" };
  }

  const dumpPath = readFlag(argv, "--dump-path");
  if (!dumpPath) {
    return { ok: false, error: "--dump-path is required" };
  }

  const dumpValidation = validateBackupOutputPath(dumpPath);
  if (!dumpValidation.ok) {
    return { ok: false, error: dumpValidation.error };
  }

  return {
    ok: true,
    dumpPath: dumpPath.trim(),
    dryRun: argv.includes("--dry-run"),
  };
}

/**
 * Formats CLI help for the backup script.
 */
export function formatBackupHelp(): string {
  return [
    "Passport PostgreSQL backup (pg_dump wrapper)",
    "",
    "Usage:",
    "  DATABASE_URL=postgresql://... npm run backup:db -- --output ./backups/passport.sql",
    "  npm run backup:db -- --database-url postgresql://... --output ./backups/passport.sql --dry-run",
    "",
    "Options:",
    "  --database-url <url>   Override DATABASE_URL (never logged verbatim)",
    "  --output <path>        Safe relative output path for pg_dump file",
    "  --dry-run              Validate env/paths without running pg_dump",
    "  --help, -h             Show this help",
    "",
    "Stdout emits one JSON line: { event: \"backup_completed\", outcome: \"success\"|\"failure\", ... }",
  ].join("\n");
}

/**
 * Formats CLI help for the restore verify skeleton.
 */
export function formatRestoreVerifyHelp(): string {
  return [
    "Passport restore verify skeleton (no destructive restore yet)",
    "",
    "Usage:",
    "  npm run restore:verify -- --dump-path ./backups/passport.sql --dry-run",
    "",
    "Options:",
    "  --dump-path <path>     Path to pg_dump artifact to verify",
    "  --dry-run              Validate args only (default safe mode)",
    "  --help, -h             Show this help",
    "",
    "See docs/disaster-recovery.md for full restore drill steps.",
  ].join("\n");
}
