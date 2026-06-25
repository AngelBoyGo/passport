/**
 * Action-primary forensic receipt verifier CLI.
 * Run: npm run verify:receipt -- --payload <file-or-json> [--signature ...] [--public-key ...] [--base-url ...] [--subject-commitment ...]
 */
import {
  parseReceiptVerifyArgs,
  verifyReceiptFromArgs,
} from "../src/lib/release/receipt-verify";

function main(): void {
  const parsed = parseReceiptVerifyArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`FAIL: ${parsed.error}`);
    process.exit(1);
  }

  verifyReceiptFromArgs(parsed)
    .then((result) => {
      for (const check of result.checks) {
        const status = check.ok ? "PASS" : "FAIL";
        const reason = check.reason ? ` — ${check.reason}` : "";
        const detail = check.detail ? ` (${check.detail})` : "";
        console.log(`${status} ${check.name}${reason}${detail}`);
      }

      if (result.ok) {
        console.log("PASS");
        process.exit(0);
      }

      console.log("FAIL");
      process.exit(1);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Receipt verify failed";
      console.error(`FAIL: ${message}`);
      process.exit(1);
    });
}

main();
