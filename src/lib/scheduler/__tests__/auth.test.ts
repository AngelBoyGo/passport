import { describe, it, expect } from "vitest";
import { isSchedulerAuthorized } from "../auth";

describe("scheduler auth (fail-closed)", () => {
  it("denies when the secret is unset in production (never open)", () => {
    expect(isSchedulerAuthorized("anything", undefined, "production")).toBe(false);
    expect(isSchedulerAuthorized(null, "", "production")).toBe(false);
  });

  it("permits when the secret is unset only outside production (dev/test convenience)", () => {
    expect(isSchedulerAuthorized(null, undefined, "development")).toBe(true);
    expect(isSchedulerAuthorized(null, undefined, "test")).toBe(true);
  });

  it("accepts the exact secret and rejects everything else", () => {
    expect(isSchedulerAuthorized("s3cr3t", "s3cr3t", "production")).toBe(true);
    expect(isSchedulerAuthorized("wrong", "s3cr3t", "production")).toBe(false);
    expect(isSchedulerAuthorized(null, "s3cr3t", "production")).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(isSchedulerAuthorized("short", "a-much-longer-secret", "production")).toBe(false);
  });
});
