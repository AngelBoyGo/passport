import { describe, expect, it } from "vitest";
import {
  createPassportDevStackPlan,
  formatPortBlockedMessage,
  normalizeLocalBaseUrl,
} from "@/lib/release/passport-dev-stack";

describe("normalizeLocalBaseUrl", () => {
  it("normalizes localhost port 3000 without trailing slash", () => {
    expect(normalizeLocalBaseUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000"
    );
  });
});

describe("createPassportDevStackPlan", () => {
  it("reuses an already healthy port 3000 server", () => {
    const plan = createPassportDevStackPlan({
      portStatus: "healthy",
      baseUrl: "http://localhost:3000",
    });

    expect(plan.action).toBe("reuse");
    expect(plan.exitCode).toBe(0);
    expect(plan.message).toContain(
      "Passport dev server healthy on http://localhost:3000"
    );
  });

  it("starts on port 3000 when the port is free", () => {
    const plan = createPassportDevStackPlan({
      portStatus: "free",
      baseUrl: "http://localhost:3000",
    });

    expect(plan.action).toBe("start");
    expect(plan.exitCode).toBe(0);
    expect(plan.message).toContain("Starting Passport dev server on port 3000");
  });

  it("blocks instead of falling through to Next port 3001", () => {
    const plan = createPassportDevStackPlan({
      portStatus: "occupied-unhealthy",
      baseUrl: "http://localhost:3000",
    });

    expect(plan.action).toBe("blocked");
    expect(plan.exitCode).toBe(1);
    expect(plan.message).toContain("do not start another Next dev server");
    expect(plan.message).toContain("port 3001");
  });
});

describe("formatPortBlockedMessage", () => {
  it("includes shutdown guidance", () => {
    expect(formatPortBlockedMessage("http://localhost:3000")).toContain(
      "Stop the process using port 3000"
    );
  });
});
