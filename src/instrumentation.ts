/**
 * Next.js instrumentation — runs once on server startup.
 * Used to start the in-process scheduler cron.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Audit fix M11: fail fast on missing required production config. This was
    // defined (validateEnv) but never called, so a deploy missing
    // SIGNING_PRIVATE_KEY/SESSION_SECRET booted silently and degraded.
    try {
      const { validateEnv } = await import("@/lib/config/env");
      const report = validateEnv();
      // Surface non-fatal warnings (e.g. empty admin allowlist) at boot so a
      // misconfiguration is visible in logs instead of silently breaking a page.
      for (const w of report.warnings ?? []) {
        console.warn("[env] warning:", w);
      }
    } catch (err) {
      console.error(
        "[env] startup validation failed:",
        err instanceof Error ? err.message : String(err)
      );
      // In production, refuse to start with missing required config.
      if (process.env.NODE_ENV === "production") throw err;
    }
    // Dynamic import to avoid pulling node-cron into edge runtime
    const { startScheduler } = await import("@/lib/scheduler/node-cron");
    startScheduler();
    const { startBrainScheduler } = await import("@/lib/scheduler/brain-scheduler");
    startBrainScheduler();
    const { startRevenueRunner } = await import("@/lib/scheduler/revenue-runner");
    startRevenueRunner();
    const { startFleetWatchScheduler } = await import("@/lib/scheduler/fleet-watch-scheduler");
    startFleetWatchScheduler();
  }
}