import { describe, it, expect, vi } from "vitest";
import {
  emitBackupCompletedEvent,
  runDatabaseBackup,
} from "@/lib/release/backup-db";

describe("emitBackupCompletedEvent", () => {
  it("writes structured JSON with backup_completed event", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    emitBackupCompletedEvent({
      event: "backup_completed",
      outcome: "success",
      dry_run: true,
      output_path: "./backups/passport.sql",
      latency_ms: 12,
    });
    expect(write).toHaveBeenCalled();
    const line = String(write.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(parsed.event).toBe("backup_completed");
    expect(parsed.outcome).toBe("success");
    expect(parsed.dry_run).toBe(true);
    write.mockRestore();
  });
});

describe("runDatabaseBackup", () => {
  it("dry-run validates without executing pg_dump", async () => {
    const exec = vi.fn();
    const result = await runDatabaseBackup(
      {
        databaseUrl: "postgresql://passport:secret@localhost:5432/passport",
        outputPath: "./backups/passport.sql",
        dryRun: true,
      },
      exec
    );
    expect(result.ok).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it("invokes pg_dump when not dry-run", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const result = await runDatabaseBackup(
      {
        databaseUrl: "postgresql://passport:secret@localhost:5432/passport",
        outputPath: "./backups/passport.sql",
        dryRun: false,
      },
      exec
    );
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledOnce();
    const command = String(exec.mock.calls[0]?.[0]);
    expect(command).toContain("pg_dump");
    expect(command).not.toContain("secret");
  });
});
