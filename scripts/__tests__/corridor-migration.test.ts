/**
 * Phase 40 — ensure the corrective corridor-tables migration is tracked and non-regressable.
 *
 * The Phase-16 diplomatic corridor tables (TransitShipment / CustomsCheckpoint /
 * BorderTaxSettlement) were historically applied only via `db push` and never captured by a
 * Prisma migration, so a fresh production deploy would silently miss them. This test guards
 * the reconciliation migration that fixes that gap.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const passportRoot = path.resolve(__dirname, "../..");
const migrationDir = path.join(passportRoot, "prisma/migrations/20260917010000_reconcile_phase16_corridor_tables");
const migrationSql = path.join(migrationDir, "migration.sql");

describe("Phase 16 corridor reconciliation migration", () => {
  it("the corrective migration directory exists", () => {
    expect(existsSync(migrationDir)).toBe(true);
  });

  it("contains a migration.sql", () => {
    expect(existsSync(migrationSql)).toBe(true);
  });

  it("creates the three previously-untracked corridor tables", () => {
    const sql = readFileSync(migrationSql, "utf8");
    for (const table of ["TransitShipment", "CustomsCheckpoint", "BorderTaxSettlement"]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("re-establishes the corridor foreign keys", () => {
    const sql = readFileSync(migrationSql, "utf8");
    expect(sql).toContain('ADD CONSTRAINT "BorderTaxSettlement_shipmentId_fkey"');
    expect(sql).toContain('ADD CONSTRAINT "BorderTaxSettlement_checkpointId_fkey"');
  });

  it("is not destructive to existing data tables (no DROP TABLE)", () => {
    const sql = readFileSync(migrationSql, "utf8");
    expect(sql).not.toMatch(/DROP TABLE/);
  });
});
