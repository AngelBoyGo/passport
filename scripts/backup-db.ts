/**
 * Passport PostgreSQL backup CLI.
 * Run: npm run backup:db -- --output ./backups/passport.sql [--dry-run]
 */
import {
  formatBackupHelp,
  parseBackupArgs,
  redactDatabaseUrl,
} from "../src/lib/release/backup-args";
import { runDatabaseBackup } from "../src/lib/release/backup-db";

async function main(): Promise<void> {
  const parsed = parseBackupArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.error === "help") {
      console.log(formatBackupHelp());
      process.exit(0);
    }
    console.error(`FAIL: ${parsed.error}`);
    process.exit(1);
  }

  console.log(
    `Starting backup to ${parsed.outputPath} (${parsed.dryRun ? "dry-run" : "live"}) for ${redactDatabaseUrl(parsed.databaseUrl)}`
  );

  const result = await runDatabaseBackup({
    databaseUrl: parsed.databaseUrl,
    outputPath: parsed.outputPath,
    dryRun: parsed.dryRun,
  });

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Backup failed";
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
