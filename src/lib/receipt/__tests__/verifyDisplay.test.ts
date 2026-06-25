import { describe, it, expect } from "vitest";
import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { receiptVerifyDisplayFields } from "@/lib/receipt/verifyDisplay";

describe("receiptVerifyDisplayFields", () => {
  it("includes operational domain and error tranche for finalized receipts", () => {
    const fields = receiptVerifyDisplayFields({
      domain: OperationalDomain.FINANCIAL_CLEARING,
      errorTranche: ErrorTranche.DATA_LEAKAGE,
      status: "failure_tombstone",
    });

    expect(fields).toEqual({
      operationalDomain: OperationalDomain.FINANCIAL_CLEARING,
      errorTranche: ErrorTranche.DATA_LEAKAGE,
    });
  });

  it("defaults missing domain to SYSTEM_INTEGRATION for display", () => {
    const fields = receiptVerifyDisplayFields({
      domain: null,
      errorTranche: ErrorTranche.NONE,
      status: "success",
    });

    expect(fields.operationalDomain).toBe(OperationalDomain.SYSTEM_INTEGRATION);
    expect(fields.errorTranche).toBe(ErrorTranche.NONE);
  });

  it("omits error tranche on pending receipts", () => {
    const fields = receiptVerifyDisplayFields({
      domain: OperationalDomain.CODE_GENERATION,
      errorTranche: null,
      status: "pending",
    });

    expect(fields.operationalDomain).toBe(OperationalDomain.CODE_GENERATION);
    expect(fields.errorTranche).toBeUndefined();
  });
});
