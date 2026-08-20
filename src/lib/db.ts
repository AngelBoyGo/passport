import { PrismaClient } from "@prisma/client";

const DEFAULT_CONNECTION_LIMIT = 10;
const DEFAULT_POOL_TIMEOUT_SEC = 10;

export interface ConnectionPoolOptions {
  connectionLimit?: number;
  poolTimeout?: number;
}

/**
 * Ensures a PostgreSQL connection URL includes connection_limit and pool_timeout
 * to prevent connection pool exhaustion across scaled horizontal containers.
 */
export function parseDatabaseUrlWithPoolConfig(
  url?: string,
  options?: ConnectionPoolOptions
): string {
  if (!url || (!url.startsWith("postgresql://") && !url.startsWith("postgres://"))) {
    return url ?? "";
  }

  try {
    const parsed = new URL(url);
    const limit =
      options?.connectionLimit ??
      (process.env.DATABASE_CONNECTION_LIMIT
        ? parseInt(process.env.DATABASE_CONNECTION_LIMIT, 10)
        : DEFAULT_CONNECTION_LIMIT);
    const timeout =
      options?.poolTimeout ??
      (process.env.DATABASE_POOL_TIMEOUT
        ? parseInt(process.env.DATABASE_POOL_TIMEOUT, 10)
        : DEFAULT_POOL_TIMEOUT_SEC);

    if (!parsed.searchParams.has("connection_limit") && Number.isFinite(limit) && limit > 0) {
      parsed.searchParams.set("connection_limit", String(limit));
    }
    if (!parsed.searchParams.has("pool_timeout") && Number.isFinite(timeout) && timeout > 0) {
      parsed.searchParams.set("pool_timeout", String(timeout));
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
      ? parseDatabaseUrlWithPoolConfig(process.env.DATABASE_URL)
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
