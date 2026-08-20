import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createCipheriv, randomBytes } from "node:crypto";
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

export interface EncryptedBackupPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface R2UploadOptions {
  sqlDump: string | Buffer;
  accountId: string;
  bucket: string;
  keyName: string;
  encryptionKeyHex: string;
}

/**
 * Encrypts a SQL dump using AES-256-GCM.
 */
export function encryptBackupPayload(
  sqlDump: string | Buffer,
  keyHex: string
): EncryptedBackupPayload {
  const key = Buffer.from(keyHex.slice(0, 64), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const inputBuffer = typeof sqlDump === "string" ? Buffer.from(sqlDump, "utf-8") : sqlDump;
  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("base64"),
  };
}

/**
 * Builds a Cloudflare R2 S3-compatible REST URL.
 */
export function buildR2EndpointUrl(
  accountId: string,
  bucket: string,
  keyName: string
): string {
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${keyName}`;
}

/**
 * Encrypts and uploads a database dump to Cloudflare R2 object storage.
 */
export async function uploadBackupToR2(
  options: R2UploadOptions
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const encrypted = encryptBackupPayload(options.sqlDump, options.encryptionKeyHex);
    const targetUrl = buildR2EndpointUrl(options.accountId, options.bucket, options.keyName);
    const body = JSON.stringify(encrypted);

    const res = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Passport-Backup-Encrypted": "aes-256-gcm",
      },
      body,
    });

    if (!res.ok) {
      return { ok: false, error: `R2 returned HTTP ${res.status}` };
    }

    return { ok: true, url: targetUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

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
