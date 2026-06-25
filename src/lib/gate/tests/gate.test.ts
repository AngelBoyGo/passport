import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    receipt: { findMany: findManyMock },
    operator: { findUnique: findUniqueMock },
  },
}));

import {
  verifyGatePass,
  GATE_WINDOW_SCAN_LIMIT,
} from "@/lib/gate/verifyGatePass";
import { OperationalDomain, ErrorTranche } from "@prisma/client";
import { MINIMUM_ESCROW_FLOOR_CENTS } from "@/lib/escrow/constants";

const findMany = findManyMock;
const findUnique = findUniqueMock;
const operatorId = "op_test_gate";

beforeEach(() => {
  findMany.mockReset();
  findUnique.mockReset();
  findUnique.mockResolvedValue({ stakeBalanceCents: MINIMUM_ESCROW_FLOOR_CENTS });
});

function makeRows(
  count: number,
  errorCount: number,
  errorTranche: ErrorTranche = ErrorTranche.DATA_LEAKAGE,
  domain: OperationalDomain = OperationalDomain.FINANCIAL_CLEARING
) {
  return Array.from({ length: count }, (_, i) => ({
    errorTranche: i < errorCount ? errorTranche : ErrorTranche.NONE,
    domain,
    domainCommitment: null,
    blindSalt: null,
  }));
}

describe("verifyGatePass", () => {
  it("blocks when failure rate exceeds 10% (3/20)", async () => {
    findMany.mockResolvedValue(makeRows(20, 3));
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({
      allow_invocation: false,
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
    });
  });

  it("allows exactly 10% failure rate (2/20)", async () => {
    findMany.mockResolvedValue(makeRows(20, 2));
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({ allow_invocation: true });
  });

  it("blocks at 3/20 (>10%) on boundary check", async () => {
    findMany.mockResolvedValue(makeRows(20, 3));
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result.allow_invocation).toBe(false);
    expect(result.reason).toBe("SLA_BREACH_THRESHOLD_EXCEEDED");
  });

  it("isolates by domain — clean FINANCIAL_CLEARING despite dirty CODE_GENERATION", async () => {
    findMany.mockResolvedValue([
      ...makeRows(10, 0, ErrorTranche.DATA_LEAKAGE, OperationalDomain.FINANCIAL_CLEARING),
      ...makeRows(10, 10, ErrorTranche.DATA_LEAKAGE, OperationalDomain.CODE_GENERATION),
    ]);

    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({ allow_invocation: true });
    expect(findMany).toHaveBeenCalledWith({
      where: { operatorId },
      orderBy: { issuedAt: "desc" },
      take: GATE_WINDOW_SCAN_LIMIT,
      select: {
        errorTranche: true,
        domain: true,
        domainCommitment: true,
        blindSalt: true,
      },
    });
  });

  it("rejects blank sheet (zero tenancy)", async () => {
    findMany.mockResolvedValue([]);
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.CUSTOMER_SUPPORT
    );
    expect(result).toEqual({
      allow_invocation: false,
      reason: "ZERO_TENANCY_REJECT",
    });
  });

  it("allows passing state with 20 clean rows", async () => {
    findMany.mockResolvedValue(makeRows(20, 0));
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({ allow_invocation: true });
  });

  it("does not count null errorTranche as errors", async () => {
    const rows = Array.from({ length: 20 }, () => ({
      errorTranche: null as ErrorTranche | null,
      domain: OperationalDomain.FINANCIAL_CLEARING,
      domainCommitment: null,
      blindSalt: null,
    }));
    rows[0] = {
      errorTranche: ErrorTranche.DATA_LEAKAGE,
      domain: OperationalDomain.FINANCIAL_CLEARING,
      domainCommitment: null,
      blindSalt: null,
    };
    rows[1] = {
      errorTranche: ErrorTranche.SLA_BREACH,
      domain: OperationalDomain.FINANCIAL_CLEARING,
      domainCommitment: null,
      blindSalt: null,
    };
    findMany.mockResolvedValue(rows);

    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({ allow_invocation: true });
  });

  it("blocks when stake balance is below minimum enterprise floor", async () => {
    findUnique.mockResolvedValue({ stakeBalanceCents: 4999 });
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({
      allow_invocation: false,
      reason: "INSUFFICIENT_ESCROW_BOND",
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("allows at exactly minimum escrow floor", async () => {
    findUnique.mockResolvedValue({
      stakeBalanceCents: MINIMUM_ESCROW_FLOOR_CENTS,
    });
    findMany.mockResolvedValue(makeRows(20, 0));
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result).toEqual({ allow_invocation: true });
  });

  it("checks escrow bond before historical failure rate", async () => {
    findUnique.mockResolvedValue({ stakeBalanceCents: 1000 });
    findMany.mockResolvedValue(
      Array.from({ length: 20 }, () => ({
        errorTranche: ErrorTranche.DATA_LEAKAGE,
        domain: OperationalDomain.FINANCIAL_CLEARING,
        domainCommitment: null,
        blindSalt: null,
      }))
    );
    const result = await verifyGatePass(
      operatorId,
      OperationalDomain.FINANCIAL_CLEARING
    );
    expect(result.reason).toBe("INSUFFICIENT_ESCROW_BOND");
    expect(findMany).not.toHaveBeenCalled();
  });
});
