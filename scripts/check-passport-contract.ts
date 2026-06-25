/**
 * Passport deployment contract checker CLI.
 * Run: npm run check:contract -- --base-url <url> [--subject-commitment <hash>]
 */
import {
  checkPassportContract,
  parseContractCheckArgs,
} from "../src/lib/release/contract-check";

function main(): void {
  const parsed = parseContractCheckArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`FAIL: ${parsed.error}`);
    process.exit(1);
  }

  checkPassportContract(parsed)
    .then((result) => {
      for (const check of result.checks) {
        const status = check.ok ? "PASS" : "FAIL";
        const reason = check.reason ? ` — ${check.reason}` : "";
        console.log(`${status} ${check.name}${reason}`);
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
        error instanceof Error ? error.message : "Contract check failed";
      console.error(`FAIL: ${message}`);
      process.exit(1);
    });
}

main();
