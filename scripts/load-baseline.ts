/**
 * Passport load baseline CLI.
 * Run: npm run load:baseline -- --base-url <url> [--dry-run] [--requests N]
 */
import {
  parseLoadBaselineArgs,
  runLoadBaseline,
} from "../src/lib/release/load-baseline";

function main(): void {
  const parsed = parseLoadBaselineArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`FAIL: ${parsed.error}`);
    process.exit(1);
  }

  if (parsed.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          baseUrl: parsed.baseUrl,
          requestsPerEndpoint: parsed.requestsPerEndpoint,
          endpoints: parsed.endpoints.map((endpoint) => ({
            name: endpoint.name,
            method: endpoint.method,
            path: endpoint.path,
          })),
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  runLoadBaseline(parsed)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Load baseline failed";
      console.error(`FAIL: ${message}`);
      process.exit(1);
    });
}

main();
