import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { timingSafeEqual } from "node:crypto";

/**
 * Thin typed Bridge (Stripe Open Issuance) client.
 * Sandbox/live routing via env; base URL configurable for tests/serverless.
 */

export interface BridgeAccount {
  id: string;
  custodial_status: string;
}

export interface BridgeTransfer {
  id: string;
  state: "pending" | "confirmed" | "failed";
}

type TransferState = "pending" | "confirmed" | "failed";

function baseUrl(): string {
  if (process.env.BRIDGE_ENV === "live") return "https://api.bridge.xyz";
  return "https://api.sandbox.bridge.xyz";
}

function headers(): Record<string, string> {
  const clientId = process.env.BRIDGE_CLIENT_ID ?? "";
  const secret = process.env.BRIDGE_CLIENT_SECRET ?? "";
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${clientId}:${secret}`,
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Bridge API ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

/** A1: list custodial / issuance accounts. */
export async function listAccounts(): Promise<BridgeAccount[]> {
  const body = await getJson<{ data: BridgeAccount[] }>("/v1/accounts");
  return body.data;
}

/** A3: poll a transfer's state. */
export async function getTransferStatus(ref: string): Promise<TransferState> {
  const body = await getJson<{ data: BridgeTransfer }>(`/v1/transfers/${ref}`);
  return body.data.state;
}

/**
 * HMAC for Bridge-style webhooks. Matches Passport's constant-time verify
 * convention (sha256-hex(canonicalJson(payload) + secret)).
 */
export function computeBridgeSignature(payload: unknown, secret: string): string {
  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  return bytesToHex(sha256(utf8ToBytes(jsonStr + secret)));
}

export function verifyBridgeSignature(
  payload: unknown,
  signature: string,
  secret: string
): { valid: boolean; error?: string } {
  const expected = computeBridgeSignature(payload, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return { valid: false, error: "length mismatch" };
  return timingSafeEqual(a, b) ? { valid: true } : { valid: false, error: "signature mismatch" };
}

/** Convenience: verify using the configured BRIDGE_WEBHOOK_SECRET. */
export function verifyBridgeWebhook(payload: unknown, signature: string): { valid: boolean; error?: string } {
  const secret = process.env.BRIDGE_WEBHOOK_SECRET;
  if (!secret) return { valid: false, error: "BRIDGE_WEBHOOK_SECRET not configured" };
  return verifyBridgeSignature(payload, signature, secret);
}