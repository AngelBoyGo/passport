/**
 * Next.js instrumentation — runs once on server startup.
 * Used to start the in-process scheduler cron.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import to avoid pulling node-cron into edge runtime
    const { startScheduler } = await import("@/lib/scheduler/node-cron");
    startScheduler();
  }
}