/**
 * Provisions a dev operator via mockDevCheckout and emits credentials as JSON.
 * Run: npx tsx scripts/provision-dev-operator.ts
 */
import { configureEd25519 } from "../src/lib/receipt/crypto";

configureEd25519();

process.env.SIGNING_PRIVATE_KEY =
  process.env.SIGNING_PRIVATE_KEY ??
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

async function main() {
  const { mockDevCheckout } = await import("../src/lib/stripe");

  const { operatorDbId, apiKey, operatorId } = await mockDevCheckout();

  const payload = {
    operatorDbId,
    apiKey,
    operatorId,
    baseUrl: process.env.PASSPORT_BASE_URL ?? "http://localhost:3000",
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgresql://passport:passport@localhost:5433/passport?schema=public",
  };

  process.stdout.write(JSON.stringify(payload));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
