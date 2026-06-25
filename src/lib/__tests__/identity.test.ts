import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { operator: { findUnique: findUniqueMock } },
}));

import {
  parsePublicOperatorId,
  resolveOperatorByPublicId,
} from "@/lib/operator";

beforeEach(() => findUniqueMock.mockReset());

describe("parsePublicOperatorId", () => {
  it("accepts op_cus_ABC123 and returns cus_ABC123", () => {
    expect(parsePublicOperatorId("op_cus_ABC123")).toBe("cus_ABC123");
  });

  it("accepts underscore suffixes in dev Stripe customer ids", () => {
    expect(parsePublicOperatorId("op_cus_verify_container_test")).toBe(
      "cus_verify_container_test"
    );
  });

  it("rejects op_x (missing cus_ prefix)", () => {
    expect(parsePublicOperatorId("op_x")).toBeNull();
  });

  it("rejects bare cus_abc (missing op_ prefix)", () => {
    expect(parsePublicOperatorId("cus_abc")).toBeNull();
  });

  it("rejects injection strings", () => {
    expect(parsePublicOperatorId("op_cus_'; DROP TABLE--")).toBeNull();
    expect(parsePublicOperatorId("op_cus_abc extra")).toBeNull();
    expect(parsePublicOperatorId("")).toBeNull();
  });
});

describe("resolveOperatorByPublicId", () => {
  it("round-trips a valid public id to the mocked operator", async () => {
    const operator = {
      id: "db_op_1",
      stripeCustomerId: "cus_ABC123",
    };
    findUniqueMock.mockResolvedValue(operator);

    const result = await resolveOperatorByPublicId("op_cus_ABC123");
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_ABC123" },
    });
    expect(result).toEqual(operator);
  });

  it("returns null for an invalid public id without querying", async () => {
    const result = await resolveOperatorByPublicId("op_invalid");
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
