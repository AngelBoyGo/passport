/**
 * Verifies DEPLOY.md documents all REQUIRED_PROD_ENV variable names.
 * Run: npx tsx scripts/check-deploy-docs.ts
 */
import { resolve } from "node:path";
import { checkDeployDocsFile } from "../src/lib/release/deploy-docs-check";

function main(): void {
  const deployPath = resolve(process.cwd(), "DEPLOY.md");
  const result = checkDeployDocsFile(deployPath);

  if (!result.ok) {
    console.error(
      `DEPLOY.md missing required env names: ${result.missing.join(", ")}`
    );
    process.exit(1);
  }

  console.log("DEPLOY.md documents all required production env vars.");
  process.exit(0);
}

main();
