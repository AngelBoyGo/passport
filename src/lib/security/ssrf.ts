import { isIP } from "node:net";

/**
 * SSRF guard for outbound webhook / notary delivery URLs.
 * Blocks loopback, link-local, private, and cloud-metadata destinations so an
 * authenticated-but-untrusted subscriber cannot pivot Passport's outbound
 * HTTP into internal infrastructure.
 */

function isPrivateIpv4(octets: number[]): boolean {
  if (octets.length !== 4) return false;
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

function isIpv4String(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
    if (p.length > 1 && p.startsWith("0")) return false;
  }
  return true;
}

function isReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  );
}

/**
 * Returns true when a hostname must never be reachable via webhook delivery
 * (loopback, private, link-local, cloud-metadata, or bare internal names).
 */
export function isUnsafeWebhookHost(hostname: string): boolean {
  if (!hostname) return true;

  const lower = hostname.toLowerCase().trim();

  if (
    lower === "localhost" ||
    lower === "localhost.localdomain" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".lan")
  ) {
    return true;
  }

  if (isIP(lower) === 4 || isIpv4String(lower)) {
    return isPrivateIpv4(lower.split(".").map((p) => parseInt(p, 10)));
  }
  if (isIP(lower) === 6) {
    return isReservedIpv6(lower);
  }

  if (
    lower === "metadata.google.internal" ||
    lower.endsWith(".metadata.google.internal") ||
    lower === "metadata.azure.internal" ||
    lower === "169.254.169.254" ||
    lower === "fd00:ec2::254"
  ) {
    return true;
  }

  // Bare hostname without a dot = resolver/internal naming. Reject.
  if (!lower.includes(".")) {
    return true;
  }

  return false;
}

/**
 * Validates a fully-formed webhook/subscriber URL.
 * Returns an error string, or null when safe.
 */
export function validateWebhookUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "URL is not parseable";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http/https webhook URLs are allowed";
  }
  if (isUnsafeWebhookHost(url.hostname)) {
    return "Webhook URL resolves to a private/loopback/unsafe host";
  }
  return null;
}