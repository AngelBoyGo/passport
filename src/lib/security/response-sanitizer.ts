/**
 * XSS-safe HTML entity escaping for user-generated content.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Strips sensitive fields from a response object before sending to client.
 * Returns a new object without the sensitive keys.
 */
export function stripSensitiveFields<T>(
  obj: T,
  sensitiveKeys: string[]
): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripSensitiveFields(item, sensitiveKeys)) as unknown as T;
  }
  if (typeof obj !== "object") return obj;

  const result = { ...obj } as Record<string, unknown>;
  for (const key of sensitiveKeys) {
    delete result[key];
  }
  return result as T;
}

/**
 * Sanitizes an API response: strips sensitive fields and escapes HTML in string values.
 */
export function sanitizeResponse<T extends Record<string, unknown>>(
  obj: T,
  sensitiveKeys: string[]
): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return obj;

  const cleaned = stripSensitiveFields(obj, sensitiveKeys) as Record<string, unknown>;

  for (const key of Object.keys(cleaned)) {
    if (typeof cleaned[key] === "string") {
      cleaned[key] = escapeHtml(cleaned[key] as string);
    }
  }

  return cleaned;
}
