import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ERROR_TRANCHES, OPERATIONAL_DOMAINS } from "../enums.js";

const rootRequire = createRequire(resolve(__dirname, "../../../package.json"));
const { ErrorTranche, OperationalDomain } = rootRequire("@prisma/client");

describe("enum drift guard", () => {
  it("OPERATIONAL_DOMAINS matches Prisma OperationalDomain enum", () => {
    const prismaValues = Object.values(OperationalDomain).sort();
    const localValues = [...OPERATIONAL_DOMAINS].sort();
    expect(localValues).toEqual(prismaValues);
  });

  it("ERROR_TRANCHES matches Prisma ErrorTranche enum", () => {
    const prismaValues = Object.values(ErrorTranche).sort();
    const localValues = [...ERROR_TRANCHES].sort();
    expect(localValues).toEqual(prismaValues);
  });
});
