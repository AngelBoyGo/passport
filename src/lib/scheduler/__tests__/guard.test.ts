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
});
