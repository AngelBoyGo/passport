import { describe, it, expect } from "vitest";

describe("vitest jsdom project", () => {
  it("runs tsx tests in a browser-like environment", () => {
    expect(typeof document).toBe("object");
    expect(document.createElement("div")).toBeInstanceOf(HTMLElement);
  });
});
