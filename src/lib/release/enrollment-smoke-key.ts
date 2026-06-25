import { randomBytes } from "crypto";

/**
 * Creates a fresh ed25519 private key seed for a smoke run.
 */
export function createEnrollmentSmokePrivateKeyHex(): string {
  return randomBytes(32).toString("hex");
}
