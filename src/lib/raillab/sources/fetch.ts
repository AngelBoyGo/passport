/**
 * Shared safe-fetch helper for live discovery sources (Phase 19).
 *
 * Guards every outbound request:
 *   - HTTPS only (reject http),
 *   - SSRF: reject private/reserved hosts via the existing `isUnsafeWebhookHost` guard,
 *   - 15s timeout (AbortController),
 *   - 1 MiB response-size cap,
 *   - JSON-only responses.
 * Failures throw so the discovery loop records a real error_tranche instead of silently
 * producing an empty result.
 */

import { isUnsafeWebhookHost } from "@/lib/security/ssrf";

const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB

export function validateDiscoveryUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Discovery URL is not valid: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Discovery URL must be https: ${rawUrl}`);
  }
  if (isUnsafeWebhookHost(url.hostname)) {
    throw new Error(`Discovery URL host is blocked (SSRF guard): ${url.hostname}`);
  }
  return url;
}

export async function fetchDiscoveryJson(rawUrl: string): Promise<unknown> {
  const url = validateDiscoveryUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "passport-raillab/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Discovery fetch ${url.origin} returned ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new Error(`Discovery fetch returned non-JSON content-type: ${contentType}`);
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Discovery response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}
