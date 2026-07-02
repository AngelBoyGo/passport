import { describe, it, expect } from "vitest";
import {
  parseBackupArgs,
  redactDatabaseUrl,
  validateBackupOutputPath,
  parseRestoreVerifyArgs,
  formatRestoreVerifyHelp,
} from "@/lib/release/backup-args";

describe("parseBackupArgs", () => {
  it("rejects missing DATABASE_URL", () => {
    const parsed = parseBackupArgs(["--output", "./backups/passport.sql"], {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/DATABASE_URL/i);
    }
  });

  it("accepts DATABASE_URL from env with output path", () => {
    const parsed = parseBackupArgs(
      ["--output", "./backups/passport.sql"],
      { DATABASE_URL: "postgresql://passport:secret@localhost:5432/passport" }
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.databaseUrl).toContain("postgresql://");
      expect(parsed.outputPath).toBe("./backups/passport.sql");
      expect(parsed.dryRun).toBe(false);
    }
  });

  it("prefers CLI database url over env", () => {
    const parsed = parseBackupArgs(
      [
        "--database-url",
        "postgresql://cli:cli@localhost:5432/passport",
        "--output",
        "./backups/passport.sql",
      ],
      { DATABASE_URL: "postgresql://env:env@localhost:5432/passport" }
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.databaseUrl).toContain("cli:cli@");
    }
  });

  it("detects dry-run flag", () => {
    const parsed = parseBackupArgs(
      ["--output", "./backups/passport.sql", "--dry-run"],
      { DATABASE_URL: "postgresql://passport:secret@localhost:5432/passport" }
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.dryRun).toBe(true);
    }
  });
});

describe("redactDatabaseUrl", () => {
  it("hides password in logs/output", () => {
    const redacted = redactDatabaseUrl(
      "postgresql://passport:supersecret@localhost:5432/passport?schema=public"
    );
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("passport:***@");
  });

  it("leaves url without password unchanged except user segment", () => {
    const redacted = redactDatabaseUrl(
      "postgresql://passport@localhost:5432/passport"
    );
    expect(redacted).toBe("postgresql://passport@localhost:5432/passport");
  });
});

describe("validateBackupOutputPath", () => {
  it("rejects path traversal", () => {
    const result = validateBackupOutputPath("../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/path traversal/i);
    }
  });

  it("rejects empty output path", () => {
    const result = validateBackupOutputPath("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/output path/i);
    }
  });

  it("accepts safe relative paths", () => {
    const result = validateBackupOutputPath("./backups/passport-20260703.sql");
    expect(result.ok).toBe(true);
  });
});

describe("parseRestoreVerifyArgs", () => {
  it("requires --dump-path", () => {
    const parsed = parseRestoreVerifyArgs(["--dry-run"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/--dump-path/i);
    }
  });

  it("rejects dump path traversal", () => {
    const parsed = parseRestoreVerifyArgs(["--dump-path", "../../tmp/evil.sql"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/path traversal/i);
    }
  });

  it("accepts valid dump path and dry-run", () => {
    const parsed = parseRestoreVerifyArgs([
      "--dump-path",
      "./backups/passport.sql",
      "--dry-run",
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.dumpPath).toBe("./backups/passport.sql");
      expect(parsed.dryRun).toBe(true);
    }
  });
});

describe("formatRestoreVerifyHelp", () => {
  it("documents restore verify skeleton usage", () => {
    const help = formatRestoreVerifyHelp();
    expect(help).toContain("restore:verify");
    expect(help).toContain("--dump-path");
  });
});
