/**
 * Read-only rollout doctor for Passport GitHub evidence deployment.
 * Run: npm run doctor:passport
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  getEnvReport,
  OPTIONAL_ENV,
  REQUIRED_PROD_ENV,
  validateEnv,
} from "../src/lib/config/env";
import { createPassportDoctorPlan } from "../src/lib/release/passport-doctor";

/**
 * Loads `.env` into process.env when keys are not already set.
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

/**
 * Prints env presence by name only; never prints secret values.
 */
function printEnvPresence(): void {
  const report = getEnvReport();

  console.log("Required env:");
  for (const name of REQUIRED_PROD_ENV) {
    console.log(`  ${name}: ${report.presence[name] ? "set" : "MISSING"}`);
  }

  console.log("\nOptional / feature env:");
  for (const name of OPTIONAL_ENV) {
    console.log(`  ${name}: ${report.presence[name] ? "set" : "unset"}`);
  }

  console.log("\nStripe env:");
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

/**
 * Runs the read-only doctor and exits with the plan status.
 */
function main(): void {
  loadDotEnvFile();

  const mode = process.env.NODE_ENV ?? "development";
  const envResult = validateEnv({ mode: "development" });
  const plan = createPassportDoctorPlan({
    mode,
    databaseUrl: process.env.DATABASE_URL,
    envResult,
  });

  console.log("=== Passport release doctor ===\n");
  console.log(`Mode: ${mode}`);
  console.log(`DATABASE_URL kind: ${plan.databaseUrlKind}\n`);
  printEnvPresence();

  if (plan.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of plan.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (plan.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of plan.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("\nNext commands after fixing errors:");
  for (const command of plan.nextCommands) {
    console.log(`  ${command}`);
  }

  if (plan.exitCode === 0) {
    console.log("\nPassport doctor passed.");
  } else {
    console.log("\nPassport doctor failed.");
  }

  process.exit(plan.exitCode);
}

main();
