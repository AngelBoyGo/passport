/**
 * Passport restore verify skeleton — validates dump path args only.
 * Run: npm run restore:verify -- --dump-path ./backups/passport.sql --dry-run
 */
import {
  formatRestoreVerifyHelp,
  parseRestoreVerifyArgs,
} from "../src/lib/release/backup-args";

function main(): void {
  const parsed = parseRestoreVerifyArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.error === "help") {
      console.log(formatRestoreVerifyHelp());
      process.exit(0);
    }
    console.error(`FAIL: ${parsed.error}`);
    process.exit(1);
  }

  const payload = {
    event: "restore_verify",
    outcome: "success" as const,
    dump_path: parsed.dumpPath,
    dry_run: parsed.dryRun,
    note: "skeleton only — see docs/disaster-recovery.md for restore drill",
  };
  console.log(JSON.stringify(payload));

  if (parsed.dryRun) {
    console.log("RESTORE_VERIFY_DRY_RUN ok");
    process.exit(0);
  }

  console.error(
    "FAIL: destructive restore not implemented — use --dry-run or follow disaster-recovery.md"
  );
  process.exit(1);
}

main();
