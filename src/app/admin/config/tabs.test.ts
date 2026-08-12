import { describe, expect, it } from "vitest";
import { ADMIN_TABS } from "@/app/admin/config/tabs";

describe("admin module registry", () => {
  it("keeps executive modules uniquely addressable", () => {
    const ids = ADMIN_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["command-center", "trust-operations", "economy", "reliability"]);
  });
});
