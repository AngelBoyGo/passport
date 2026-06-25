/**
 * Type-safe production CORS corridor for Passport API routes.
 * Consumed by middleware (dynamic) and next.config.ts (static security headers).
 */

export const AGENT_FRAMEWORKS = ["Mastra", "LangGraph", "Claude Code"] as const;
export type AgentFramework = (typeof AGENT_FRAMEWORKS)[number];

/** Custom-domain admin namespace — browser admin UI and checkout. */
export const PASSPORT_ADMIN_ORIGINS = [
  "https://passport.metis.gold",
  "passport.metis.gold",
] as const;
export type PassportAdminOrigin = (typeof PASSPORT_ADMIN_ORIGINS)[number];

export const PUBLIC_API_PATTERNS = [
  /^\/api\/v1\/gate\/verify$/,
  /^\/api\/v1\/public-key$/,
  /^\/api\/health$/,
] as const;

export const ADMIN_API_PATTERNS = [
  /^\/api\/v1\/receipts(\/.*)?$/,
  /^\/api\/stripe\/checkout$/,
  /^\/api\/dev\/provision$/,
  /^\/api\/demo\/run$/,
] as const;

export type ApiRouteClass = "public" | "admin" | "webhook" | "other";

export type CorsOptions = {
  allowedOrigins: readonly string[] | "*";
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
  maxAge: number;
};

export type CorsResolveInput = {
  pathname: string;
  origin: string | null;
  method: string;
  isProduction: boolean;
};

export type CorsResolveResult = {
  headers: Record<string, string>;
  block?: boolean;
};

/** Static security headers applied to all responses via next.config.ts. */
export const PRODUCTION_SECURITY_HEADERS: ReadonlyArray<{
  key: string;
  value: string;
}> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/**
 * CORS policy for public endpoints consumed by external agent frameworks.
 */
export function getPublicApiCorsOptions(): CorsOptions {
  return {
    allowedOrigins: "*",
    allowedMethods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  };
}

/**
 * CORS policy for administrative routes — passport.metis.gold only.
 */
export function getAdminApiCorsOptions(): CorsOptions {
  return {
    allowedOrigins: PASSPORT_ADMIN_ORIGINS,
    allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  };
}

/**
 * Classifies an API pathname into public, admin, webhook, or other.
 */
export function classifyApiRoute(pathname: string): ApiRouteClass {
  if (pathname === "/api/stripe/webhook") {
    return "webhook";
  }
  if (PUBLIC_API_PATTERNS.some((re) => re.test(pathname))) {
    return "public";
  }
  if (ADMIN_API_PATTERNS.some((re) => re.test(pathname))) {
    return "admin";
  }
  return "other";
}

function isAllowedAdminOrigin(origin: string): origin is PassportAdminOrigin {
  return (PASSPORT_ADMIN_ORIGINS as readonly string[]).includes(origin);
}

function buildCorsHeaderRecord(options: CorsOptions, origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": options.allowedMethods.join(", "),
    "Access-Control-Allow-Headers": options.allowedHeaders.join(", "),
    "Access-Control-Max-Age": String(options.maxAge),
    Vary: "Origin",
  };

  if (options.allowedOrigins === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }

  if (origin && isAllowedAdminOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

/**
 * Resolves CORS headers and optional origin block for a request.
 */
export function resolveCorsHeaders(input: CorsResolveInput): CorsResolveResult {
  const routeClass = classifyApiRoute(input.pathname);

  if (routeClass === "webhook" || routeClass === "other") {
    return { headers: {} };
  }

  if (routeClass === "public") {
    return {
      headers: buildCorsHeaderRecord(getPublicApiCorsOptions(), input.origin),
    };
  }

  // Admin corridor — server-side calls (no Origin) and Stripe-style integrations pass through.
  if (!input.origin) {
    return {
      headers: buildCorsHeaderRecord(getAdminApiCorsOptions(), input.origin),
    };
  }

  if (input.isProduction && !isAllowedAdminOrigin(input.origin)) {
    return { headers: {}, block: true };
  }

  return {
    headers: buildCorsHeaderRecord(getAdminApiCorsOptions(), input.origin),
  };
}
