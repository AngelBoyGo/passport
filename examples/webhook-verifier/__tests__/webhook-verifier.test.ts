import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeWebhookSignature } from "@/lib/webhooks/webhook-service";

const FIXTURES = resolve("examples/webhook-verifier/fixtures");
const CLI = resolve("examples/webhook-verifier/verify.ts");
// Use the repo-local tsx binary (works on Windows and CI where `npx` may not resolve).
const TSX = join(resolve("node_modules/.bin"), process.platform === "win32" ? "tsx.cmd" : "tsx");

function runCli(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    return { status: 0, stdout };
  } catch (e: any) {
    const combined = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
    return { status: e.status ?? 2, stdout: combined.trim() };
  }
}

describe("Webhook verifier — committed known-answer fixture", () => {
  const base = [
    "--payload", join(FIXTURES, "payload.json"),
    "--signature", join(FIXTURES, "signature.txt"),
    "--secret", join(FIXTURES, "secret.txt"),
  ];

  it("has an honest fixture: committed signature equals recompute", () => {
    const payload = JSON.parse(readFileSync(join(FIXTURES, "payload.json"), "utf8"));
    const secret = readFileSync(join(FIXTURES, "secret.txt"), "utf8").trim();
    const expected = readFileSync(join(FIXTURES, "signature.txt"), "utf8").trim();
    expect(computeWebhookSignature(payload, secret)).toBe(expected);
  });

  it("CLI exits 0/PASS on the valid fixture", () => {
    const { status, stdout } = runCli(base);
    expect(status).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("CLI exits 1/FAIL on a tampered payload", () => {
    const original = readFileSync(join(FIXTURES, "payload.json"), "utf8");
    const tampered = original.replace('"current_failure_rate": 0.35', '"current_failure_rate": 0.99');
    const tamperedFile = join(FIXTURES, "tampered.payload.json");
    writeFileSync(tamperedFile, tampered);
    try {
      const { status, stdout } = runCli([
        "--payload", tamperedFile,
        "--signature", join(FIXTURES, "signature.txt"),
        "--secret", join(FIXTURES, "secret.txt"),
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain("FAIL");
    } finally {
      rmSync(tamperedFile, { force: true });
    }
  });

  it("CLI exits 1/FAIL on a wrong secret", () => {
    const wrongSecret = join(FIXTURES, "wrong-secret.txt");
    writeFileSync(wrongSecret, "whsec_wrong_secret");
    try {
      const { status, stdout } = runCli([
        "--payload", join(FIXTURES, "payload.json"),
        "--signature", join(FIXTURES, "signature.txt"),
        "--secret", wrongSecret,
      ]);
      expect(status).toBe(1);
      expect(stdout).toContain("FAIL");
    } finally {
      rmSync(wrongSecret, { force: true });
    }
  });
});