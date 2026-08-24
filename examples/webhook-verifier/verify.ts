/**
 * Runnable webhook receiver verifier — Known-Answer edition.
 *
 * Run:
 *   npx tsx examples/webhook-verifier/verify.ts \
 *     --payload examples/webhook-verifier/fixtures/payload.json \
 *     --signature examples/webhook-verifier/fixtures/signature.txt \
 *     --secret  examples/webhook-verifier/fixtures/secret.txt
 *
 * Prints `PASS: signature matches` and exits 0 on a valid signature, or
 * `FAIL: <reason>` and exits 1 otherwise. This imports the SAME public utility
 * (`verifyWebhookSignature`) that Passport ships, so a downstream consumer can
 * run this against the committed known-answer fixture to mechanically confirm
 * the published verification rule works.
 */
import { readFileSync } from "node:fs";
import { verifyWebhookSignature } from "../../src/lib/webhooks/webhook-service";

interface Args {
  payload: string;
  signature: string;
  secret: string;
  maxAgeSec?: number;
}

function parseArgs(argv: string[]): Args | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--")) {
      args[key.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  if (!args.payload || !args.signature || !args.secret) return null;
  return {
    payload: args.payload,
    signature: args.signature,
    secret: args.secret,
    ...(args.maxAgeSec ? { maxAgeSec: Number(args.maxAgeSec) } : {}),
  };
}

function load(relPath: string): string {
  return readFileSync(relPath, "utf8");
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(
      "Usage: npx tsx examples/webhook-verifier/verify.ts --payload <file> --signature <file> --secret <file> [--maxAgeSec <sec>]"
    );
    process.exit(2);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(load(parsed.payload));
  } catch {
    console.error("FAIL: could not parse payload file as JSON");
    process.exit(1);
  }
  const signature = load(parsed.signature).trim();
  const secret = load(parsed.secret).trim();

  const result = verifyWebhookSignature({
    payload,
    signature,
    secret,
    ...(parsed.maxAgeSec ? { maxAgeMs: parsed.maxAgeSec * 1000 } : {}),
  });

  if (result.valid) {
    console.log("PASS: signature matches");
    process.exit(0);
  }

  console.error(`FAIL: ${result.error ?? "signature verification failed"}`);
  process.exit(1);
}

main();