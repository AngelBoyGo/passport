import { afterEach, describe, expect, it, vi } from "vitest";

describe("fleet-dispatch-scheduler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("validates the cron expression and logs on invalid", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startFleetDispatchScheduler, stopFleetDispatchScheduler } = await import(
      "../fleet-dispatch-scheduler"
    );

    startFleetDispatchScheduler("not-a-cron");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid cron"));
    stopFleetDispatchScheduler();
  });

  it("is disabled via FLEET_DISPATCH_ENABLED=false", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startFleetDispatchScheduler, stopFleetDispatchScheduler } = await import(
      "../fleet-dispatch-scheduler"
    );

    vi.stubEnv("FLEET_DISPATCH_ENABLED", "false");
    startFleetDispatchScheduler();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Disabled"));
    stopFleetDispatchScheduler();
  });

  it("does not start duplicate instances", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startFleetDispatchScheduler, stopFleetDispatchScheduler } = await import(
      "../fleet-dispatch-scheduler"
    );

    startFleetDispatchScheduler("* * * * *");
    startFleetDispatchScheduler("* * * * *");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Already running"));
    stopFleetDispatchScheduler();
  });
});
