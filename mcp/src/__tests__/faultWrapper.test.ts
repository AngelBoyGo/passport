import { describe, expect, it, vi } from "vitest";
import type { PassportClient } from "@passport/sdk";
import { withFaultCapture } from "../faultWrapper.js";

describe("withFaultCapture", () => {
  it("finalizes with mapped tranche on throw then rethrows", async () => {
    const finalizeReceipt = vi.fn().mockResolvedValue({
      receipt_id: "rcpt_1",
      status: "failure_tombstone",
    });

    const client = {
      finalizeReceipt,
    } as unknown as PassportClient;

    const err = new TypeError("bad input");

    await expect(
      withFaultCapture(client, "rcpt_1", async () => {
        throw err;
      })
    ).rejects.toThrow(err);

    expect(finalizeReceipt).toHaveBeenCalledOnce();
    expect(finalizeReceipt).toHaveBeenCalledWith("rcpt_1", {
      status: "failure_tombstone",
      error_tranche: "LOGIC_DETECTION",
      terminal_reason: "bad input",
    });
  });

  it("returns result when fn succeeds", async () => {
    const finalizeReceipt = vi.fn();
    const client = { finalizeReceipt } as unknown as PassportClient;

    const result = await withFaultCapture(client, "rcpt_1", async () => "ok");

    expect(result).toBe("ok");
    expect(finalizeReceipt).not.toHaveBeenCalled();
  });
});
