/**
 * Mobile-money provider adapter contract — Phase 18.
 *
 * Each Sahel provider (Orange Money, Moov Money, MTN MoMo) implements this interface:
 *   - `parseCallback(payload)`: extracts the canonical external reference + XOF amount.
 *   - `verifyCallbackSignature(payload, secret)`: HMAC-SHA256 over the canonical payload
 *     string using the provider's shared secret. In production a false result rejects the
 *     callback; tests inject a known secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256Hex, canonicalJson } from "@/lib/receipt/canonical";

export interface MoneyProvider {
  name: string;
  parseCallback(payload: unknown): { externalRef: string; xofAmount: number; raw: string };
  verifyCallbackSignature(payload: unknown, secret: string): Promise<boolean>;
}

/** Canonical, provider-agnostic HMAC verification over a stable string payload. */
export async function verifyHmacSignature(
  rawPayload: string,
  signatureHex: string,
  secret: string
): Promise<boolean> {
  if (!secret || !signatureHex || !rawPayload) return false;
  try {
    const obj = JSON.parse(rawPayload) as Record<string, unknown>;
    const expected = sha256Hex(canonicalJson(obj));
    const mac = createHmac("sha256", secret);
    mac.update(expected);
    const digest = mac.digest().toString("hex");
    const sigBytes = signatureHex.toLowerCase().startsWith("0x")
      ? signatureHex.slice(2).toLowerCase()
      : signatureHex.toLowerCase();
    const expectedBytes = Buffer.from(digest, "hex");
    const providedBytes = Buffer.from(sigBytes, "hex");
    if (providedBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(expectedBytes, providedBytes);
  } catch {
    return false;
  }
}

/** Shared payload normalization: extract ref + amount from common field shapes. */
export function parseStandard(
  payload: unknown,
  refKey: string,
  amountKey: string,
  amountDivisor = 1
): { externalRef: string; xofAmount: number; raw: string } {
  const obj = (payload ?? {}) as Record<string, unknown>;
  const externalRef = String(obj[refKey] ?? obj["external_ref"] ?? obj["reference"] ?? "");
  const xofAmountRaw = Number(obj[amountKey] ?? obj["xof_amount"] ?? obj["amount"] ?? 0);
  const xofAmount = Math.max(0, Math.round(xofAmountRaw / amountDivisor));
  const raw = JSON.stringify(obj);
  return { externalRef, xofAmount, raw };
}

/** Shared HMAC verification over the canonicalized payload for the three adapters. */
export function verifyStandardHook(
  payload: unknown,
  secret: string
): Promise<boolean> {
  const raw = JSON.stringify(payload ?? {});
  const sig = ((payload ?? {}) as Record<string, unknown>).signature as string | undefined;
  return verifyHmacSignature(raw, sig ?? "", secret);
}

/**
 * Resolves a provider secret from the environment or a test-injectable in-memory
 * fallback. Never logs the secret.
 */
export function getProviderSecret(provider: string): string {
  const envHex = process.env[`MOBILE_MONEY_SECRET_${provider.toUpperCase()}`]?.trim();
  if (envHex) return envHex;
  const fallback = process.env.MOBILE_MONEY_SECRET?.trim();
  if (fallback) return fallback;
  return `dev-secret-${provider}`;
}