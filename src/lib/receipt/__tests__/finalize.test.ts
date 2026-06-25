import { describe, it, expect } from "vitest";
import { validateFinalizeInput } from "@/lib/receipt/finalize";
import { sha256Hex } from "@/lib/receipt/canonical";
import type { FinalizeReceiptInput } from "@/lib/receipt/types";

describe("finalize validation", () => {
  it("accepts success with output_hash", () => {
    const result = validateFinalizeInput({
      status: "success",
      output_hash: sha256Hex("output"),
    });
    expect(result.valid).toBe(true);
  });

  it("accepts refusal with refusal_reason", () => {
    const result = validateFinalizeInput({
      status: "refusal",
      refusal_reason: sha256Hex("policy violation"),
    });
    expect(result.valid).toBe(true);
  });

  it("requires terminal_reason for terminal states", () => {
    const result = validateFinalizeInput({ status: "timeout" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/terminal_reason/i);
  });

  it("rejects success without output_hash", () => {
    const result = validateFinalizeInput({ status: "success" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/output_hash/i);
  });

  it("rejects invalid finalize status", () => {
    const result = validateFinalizeInput({
      status: "pending" as FinalizeReceiptInput["status"],
    });
    expect(result.valid).toBe(false);
  });
});
