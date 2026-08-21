#!/usr/bin/env tsx
/**
 * Standalone Offline Receipt Verifier CLI
 * Verifies any Passport receipt or public-manifest JSON 100% offline.
 *
 * Usage:
 *   npx tsx scripts/verify-receipt-offline.ts path/to/receipt.json [optional_public_key_hex]
 */

import { readFileSync } from "node:fs";
import { verifyReceiptOffline } from "../src/lib/transparency/key-log";

async function main() {
  const fileArg = process.argv[2];
  const pubKeyArg = process.argv[3];

  if (!fileArg || fileArg === "--help" || fileArg === "-h") {
    console.log("Usage: npx tsx scripts/verify-receipt-offline.ts <receipt.json> [public_key_hex]");
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(fileArg, "utf-8");
  } catch (err) {
    console.error(`Error reading file "${fileArg}":`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const result = await verifyReceiptOffline(content, {
    publicKeyHex: pubKeyArg,
  });

  console.log("=== Passport Offline Verification Result ===");
  console.log("Status:             ", result.valid ? "✅ VERIFIED GENUINE" : "❌ VERIFICATION FAILED");
  console.log("Computed ContentHash:", result.contentHash);
  console.log("Signature Matched:  ", result.matchesSignature ? "YES (Ed25519)" : "NO");
  if (result.isTerminal) {
    console.log("Terminal State:      YES (Tombstone/Timeout/Shutdown)");
  }
  if (result.error) {
    console.error("Reason:             ", result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
