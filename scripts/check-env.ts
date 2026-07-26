/**
 * Operator env preflight: validates required vars by name only (never prints values).
 * Run: npm run check:env
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  validateEnv,
  getEnvReport,
  REQUIRED_PROD_ENV,
  OPTIONAL_ENV,
  assertDatabaseUrlMatchesProvider,
} from "../src/lib/config/env";

/**
 * Loads `.env` into process.env when keys are not already set (local operator convenience).
 */
function loadDotEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile();

function printReport(): void {
  const report = getEnvReport();

  console.log("=== Passport environment check ===\n");
  console.log("Required:");
  for (const name of REQUIRED_PROD_ENV) {
    console.log(`  ${name}: ${report.presence[name] ? "set" : "MISSING"}`);
  }

  console.log("\nOptional / feature:");
  for (const name of OPTIONAL_ENV) {
    console.log(`  ${name}: ${report.presence[name] ? "set" : "unset"}`);
  }

  console.log("\nStripe (conditional group when STRIPE_SECRET_KEY is set):");
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO",
  ]) {
    console.log(`  ${name}: ${report.presence[name] ? "set" : "unset"}`);
  }

  console.log("\nFeature flags:");
  for (const [flag, enabled] of Object.entries(report.enabledFlags)) {
    console.log(`  ${flag}: ${enabled ? "on" : "off"}`);
  }
}

function main(): void {
  const prestartOnly = process.argv.includes("--prestart-only");
  const mode = process.env.NODE_ENV ?? "development";

  if (prestartOnly && mode !== "production" && mode !== "staging") {
    process.exit(0);
  }

  try {
    assertDatabaseUrlMatchesProvider();
    const result = validateEnv({ mode });
    printReport();

    if (result.warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of result.warnings) {
        console.log(`  - ${warning}`);
      }
    }

    if (!result.ok) {
      console.error(
        `\nMissing required: ${result.missingRequired.join(", ")}`
      );
      process.exit(1);
    }

    console.log("\nEnvironment check passed.");
    process.exit(0);
  } catch (error) {
    printReport();
    const message =
      error instanceof Error ? error.message : "Environment validation failed";
    console.error(`\n${message}`);
    process.exit(1);
  }
}

main();
