import { afterEach, describe, expect, it, vi } from "vitest";
import { schedulersAllowed } from "../guard";

afterEach(() => vi.unstubAllEnvs());

describe("scheduler guard", () => {
  it("blocks in the test environment by default", () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("SCHEDULERS_ENABLED", "");
    expect(schedulersAllowed().allowed).toBe(false);
  });

  it("explicit SCHEDULERS_ENABLED=true wins (even under vitest)", () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("SCHEDULERS_ENABLED", "true");
    expect(schedulersAllowed().allowed).toBe(true);
  });

  it("SCHEDULERS_ENABLED=false blocks", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULERS_ENABLED", "false");
    expect(schedulersAllowed().allowed).toBe(false);
  });

  it("blocks in development unless explicitly enabled", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHEDULERS_ENABLED", "");
    expect(schedulersAllowed().allowed).toBe(false);
  });

  it("allows in production", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULERS_ENABLED", "");
    expect(schedulersAllowed().allowed).toBe(true);
  });

  it("blocks a non-primary SCHEDULER_ROLE (environment identity)", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULERS_ENABLED", "");
    vi.stubEnv("SCHEDULER_ROLE", "secondary");
    const gate = schedulersAllowed();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("SCHEDULER_ROLE");
  });

  it("allows the primary SCHEDULER_ROLE in production", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULERS_ENABLED", "");
    vi.stubEnv("SCHEDULER_ROLE", "primary");
    expect(schedulersAllowed().allowed).toBe(true);
  });

  it("explicit SCHEDULERS_ENABLED=true overrides a non-primary role", () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("SCHEDULER_ROLE", "secondary");
    vi.stubEnv("SCHEDULERS_ENABLED", "true");
    expect(schedulersAllowed().allowed).toBe(true);
  });
});
