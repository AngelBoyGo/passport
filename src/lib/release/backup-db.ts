import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { redactDatabaseUrl } from "./backup-args";

const execAsync = promisify(execCallback);

export type BackupOutcome = "success" | "failure";

export type BackupCompletedEvent = {
  event: "backup_completed";
  outcome: BackupOutcome;
  output_path?: string;
  dry_run?: boolean;
  reason_code?: string;
  database_url_redacted?: string;
  latency_ms?: number;
};

export type DatabaseBackupInput = {
  databaseUrl: string;
  outputPath: string;
  dryRun: boolean;
};

export type ExecFn = (
  command: string,
  options?: { env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

type ParsedPostgresUrl = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

/**
 * Parses a PostgreSQL connection URL into pg_dump-friendly fields.
 */
export function parsePostgresDatabaseUrl(
  databaseUrl: string
): ParsedPostgresUrl | null {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return null;
    }
    const database = parsed.pathname.replace(/^\//, "").split("?")[0];
    if (!database) {
      return null;
    }
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
    };
  } catch {
    return null;
  }
}

/**
 * Emits one structured JSON log line for backup completion (stdout/stderr by outcome).
 */
export function emitBackupCompletedEvent(event: BackupCompletedEvent): void {
  const line = `${JSON.stringify(event)}\n`;
  if (event.outcome === "failure") {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

/**
 * Builds a pg_dump shell command without embedding the database password.
 */
export function buildPgDumpCommand(
  connection: ParsedPostgresUrl,
  outputPath: string
): string {
  const escapedOutput = outputPath.replace(/"/g, '\\"');
  return `pg_dump -h ${connection.host} -p ${connection.port} -U ${connection.user} -d ${connection.database} -f "${escapedOutput}" --no-owner --no-acl`;
}

/**
 * Runs pg_dump or dry-run validation for Passport PostgreSQL backups.
 */
export async function runDatabaseBackup(
  input: DatabaseBackupInput,
  execFn: ExecFn = execAsync
): Promise<{ ok: boolean; reasonCode?: string }> {
  const started = Date.now();
  const redactedUrl = redactDatabaseUrl(input.databaseUrl);

  if (input.dryRun) {
    emitBackupCompletedEvent({
      event: "backup_completed",
      outcome: "success",
      dry_run: true,
      output_path: input.outputPath,
      database_url_redacted: redactedUrl,
      latency_ms: Date.now() - started,
    });
    return { ok: true };
  }

  const connection = parsePostgresDatabaseUrl(input.databaseUrl);
  if (!connection) {
    emitBackupCompletedEvent({
      event: "backup_completed",
      outcome: "failure",
      output_path: input.outputPath,
      database_url_redacted: redactedUrl,
      reason_code: "invalid_database_url",
      latency_ms: Date.now() - started,
    });
    return { ok: false, reasonCode: "invalid_database_url" };
  }

  const command = buildPgDumpCommand(connection, input.outputPath);

  try {
    await execFn(command, {
      env: {
        ...process.env,
        PGPASSWORD: connection.password,
      },
    });
    emitBackupCompletedEvent({
      event: "backup_completed",
      outcome: "success",
      output_path: input.outputPath,
      database_url_redacted: redactedUrl,
      latency_ms: Date.now() - started,
    });
    return { ok: true };
  } catch {
    emitBackupCompletedEvent({
      event: "backup_completed",
      outcome: "failure",
      output_path: input.outputPath,
      database_url_redacted: redactedUrl,
      reason_code: "pg_dump_failed",
      latency_ms: Date.now() - started,
    });
    return { ok: false, reasonCode: "pg_dump_failed" };
  }
}
