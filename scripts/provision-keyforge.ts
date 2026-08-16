/**
 * Provisions a KeyForge operator and API key for end-to-end receipt testing.
 *
 * Usage (requires a running PostgreSQL matching DATABASE_URL):
 *   npx tsx scripts/provision-keyforge.ts
 *
 * Outputs JSON to stdout with operatorId, apiKey, and baseUrl.
 */
import { configureEd25519 } from "../src/lib/receipt/crypto";

configureEd25519();

process.env.SIGNING_PRIVATE_KEY =
  process.env.SIGNING_PRIVATE_KEY ??
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
process.env.STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO ?? "";

async function main() {
  const { mockDevCheckout } = await import("../src/lib/stripe");
  const { operatorDbId, apiKey, operatorId } = await mockDevCheckout(
    "keyforge@metis.gold"
  );

  const payload = {
    operator: "KeyForge BYOK Gateway",
    operatorDbId,
    apiKey,
    operatorId,
    publicKeyEndpoint: "https://passport.metis.gold/api/v1/public-key",
    baseUrl: process.env.PASSPORT_BASE_URL ?? "https://passport.metis.gold",
    note: "Store the apiKey securely. It is returned only once.",
  };

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});