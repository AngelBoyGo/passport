import { describe, it, expect, vi, afterEach } from "vitest";

describe("logPassportEvent", () => {
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderrWrite = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  afterEach(() => {
    stdoutWrite.mockClear();
    stderrWrite.mockClear();
  });

  it("emits one JSON line with expected fields and no excluded secrets", async () => {
    const { logPassportEvent } = await import("@/lib/observability/logger");
    const VALID_COMMITMENT = "b".repeat(64);

    logPassportEvent({
      event: "enroll_start",
      outcome: "pending",
      http_status: 200,
      subject_commitment: VALID_COMMITMENT,
      latency_ms: 12,
    });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const line = String(stdoutWrite.mock.calls[0][0]);
    const parsed = JSON.parse(line.trim());

    expect(parsed).toEqual({
      event: "enroll_start",
      outcome: "pending",
      http_status: 200,
      subject_commitment: VALID_COMMITMENT,
      latency_ms: 12,
    });
    expect(line).not.toContain("signature");
    expect(line).not.toContain("public_key");
    expect(line).not.toContain("payload");
    expect(line).not.toContain("nonce");
  });

  it("writes errors to stderr and never throws on bad input", async () => {
    const { logPassportEvent } = await import("@/lib/observability/logger");

    expect(() =>
      logPassportEvent({
        event: "evidence_ingest",
        outcome: "error",
        http_status: 500,
        reason_code: "internal_error",
        latency_ms: 5,
      })
    ).not.toThrow();

    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it("swallows JSON serialization failures without throwing", async () => {
    const { logPassportEvent } = await import("@/lib/observability/logger");
    const circular: Record<string, unknown> = { event: "enroll_start" };
    circular.self = circular;

    expect(() =>
      logPassportEvent(circular as Parameters<typeof logPassportEvent>[0])
    ).not.toThrow();
  });
});
