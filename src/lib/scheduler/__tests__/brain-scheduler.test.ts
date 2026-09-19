import { afterEach, describe, expect, it, vi } from "vitest";

describe("brain-scheduler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("startBrainScheduler validates the cron expression and logs on invalid", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startBrainScheduler, stopBrainScheduler } = await import("../brain-scheduler");

    startBrainScheduler("not-a-cron");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid cron expression"));
    stopBrainScheduler();
    logSpy.mockRestore();
  });

  it("startBrainScheduler does not start duplicate instances", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startBrainScheduler, stopBrainScheduler } = await import("../brain-scheduler");

    startBrainScheduler("* * * * *");
    startBrainScheduler("* * * * *");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Already running"));
    stopBrainScheduler();
    warnSpy.mockRestore();
  });
});

describe("revenue-runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs disabled when REVENUE_RUNNER_ENABLED is not 1", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startRevenueRunner, stopRevenueRunner } = await import("../revenue-runner");

    vi.stubEnv("REVENUE_RUNNER_ENABLED", "0");
    startRevenueRunner();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Disabled"));
    stopRevenueRunner();
    logSpy.mockRestore();
  });

  it("validates cron expression on start", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startRevenueRunner, stopRevenueRunner } = await import("../revenue-runner");

    vi.stubEnv("REVENUE_RUNNER_ENABLED", "1");
    startRevenueRunner("bad-cron");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid cron expression"));
    stopRevenueRunner();
    errSpy.mockRestore();
  });

  it("refuses simulated revenue crediting in production", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startRevenueRunner, stopRevenueRunner } = await import("../revenue-runner");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REVENUE_RUNNER_ENABLED", "1");
    startRevenueRunner("* * * * *");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Refusing to start in production"));
    stopRevenueRunner();
    errSpy.mockRestore();
  });
});
