import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { sourceDigest } from "@/lib/ingestion/github-agent-adapter";
import { verifyPayloadSignature } from "@/lib/enrollment/proof";
import { isValidPublicKeyHex } from "@/lib/enrollment/identity";

export type ReceiptVerifyArgs =
  | {
      ok: true;
      baseUrl?: string;
      subjectCommitment?: string;
      payloadArg: string;
      signature?: string;
      publicKey?: string;
    }
  | { ok: false; error: string };

export type ReceiptVerifyCheck = {
  name: string;
  ok: boolean;
  reason?: string;
  detail?: string;
};

export type ReceiptVerifyResult = {
  ok: boolean;
  checks: ReceiptVerifyCheck[];
};

type ResolvedVerifyInput = {
  baseUrl?: string;
  subjectCommitment?: string;
  payload: unknown;
  signature?: string;
  publicKey?: string;
};

/**
 * Parses CLI args for the receipt forensic verifier.
 */
export function parseReceiptVerifyArgs(argv: string[]): ReceiptVerifyArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      return { ok: false, error: `Missing value for ${arg}` };
    }
    values.set(arg, next);
    i += 1;
  }

  const payloadArg = values.get("--payload");
  if (!payloadArg) {
    return { ok: false, error: "--payload is required" };
  }

  const baseUrl = values.get("--base-url")?.replace(/\/+$/, "");
  const subjectCommitment = values.get("--subject-commitment")?.toLowerCase();
  const signature = values.get("--signature")?.toLowerCase();
  const publicKey = values.get("--public-key")?.toLowerCase();

  if (subjectCommitment && !/^[0-9a-f]{64}$/i.test(subjectCommitment)) {
    return {
      ok: false,
      error: "--subject-commitment must be a 64-character hex string",
    };
  }

  if (publicKey && !isValidPublicKeyHex(publicKey)) {
    return {
      ok: false,
      error: "--public-key must be a 64-character hex ed25519 public key",
    };
  }

  if (signature && !/^[0-9a-f]{128}$/i.test(signature)) {
    return {
      ok: false,
      error: "--signature must be a 128-character hex ed25519 signature",
    };
  }

  return {
    ok: true,
    baseUrl,
    subjectCommitment,
    payloadArg,
    signature,
    publicKey,
  };
}

/**
 * Loads evidence payload from a filesystem path or inline JSON string.
 */
export function loadPayloadFromArg(payloadArg: string): unknown {
  const candidatePath = resolve(process.cwd(), payloadArg);
  const raw =
    existsSync(candidatePath) && !payloadArg.trimStart().startsWith("{")
      ? readFileSync(candidatePath, "utf8")
      : payloadArg;

  return JSON.parse(raw) as unknown;
}

async function resolvePublicKey(
  input: ResolvedVerifyInput,
  fetchImpl: typeof fetch
): Promise<{ publicKey?: string; check?: ReceiptVerifyCheck }> {
  if (input.publicKey) {
    return { publicKey: input.publicKey };
  }

  if (!input.baseUrl || !input.subjectCommitment) {
    return {};
  }

  const passportUrl = `${input.baseUrl}/api/v1/passport/agents/${input.subjectCommitment}/passport`;
  const response = await fetchImpl(passportUrl);
  if (!response.ok) {
    return {
      check: {
        name: "passport_readback",
        ok: true,
        reason:
          response.status === 404
            ? "passport HTTP 404 — agent not enrolled yet"
            : `passport HTTP ${response.status} — could not derive public key`,
      },
    };
  }

  const body = (await response.json()) as { public_key?: unknown };
  if (typeof body.public_key !== "string" || !isValidPublicKeyHex(body.public_key)) {
    return {
      check: {
        name: "passport_readback",
        ok: false,
        reason: "passport response missing valid public_key",
      },
    };
  }

  return {
    publicKey: body.public_key.toLowerCase(),
    check: {
      name: "passport_readback",
      ok: true,
      reason: "derived public_key from passport GET",
    },
  };
}

async function checkProfileReadback(
  input: ResolvedVerifyInput,
  fetchImpl: typeof fetch
): Promise<ReceiptVerifyCheck | undefined> {
  if (!input.baseUrl || !input.subjectCommitment) {
    return undefined;
  }

  const profileUrl = `${input.baseUrl}/api/v1/profiles/${input.subjectCommitment}`;
  const response = await fetchImpl(profileUrl);
  if (response.status === 404) {
    return {
      name: "profile_readback",
      ok: true,
      reason: "profile HTTP 404 — expected before first evidence",
    };
  }

  if (!response.ok) {
    return {
      name: "profile_readback",
      ok: true,
      reason: `profile HTTP ${response.status} — informational only`,
    };
  }

  const profile = (await response.json()) as {
    enrollment_status?: unknown;
    agent_commitment_hash?: unknown;
  };

  const status = String(profile.enrollment_status ?? "unknown");
  const commitmentMatch =
    profile.agent_commitment_hash === input.subjectCommitment
      ? "commitment matches"
      : "commitment mismatch (informational)";

  return {
    name: "profile_readback",
    ok: true,
    reason: `enrollment_status=${status}; ${commitmentMatch}`,
  };
}

/**
 * Recomputes payload digest, optionally verifies ed25519 signature, and optionally probes read routes.
 */
export async function verifyReceiptForensics(
  input: ResolvedVerifyInput,
  fetchImpl: typeof fetch = fetch
): Promise<ReceiptVerifyResult> {
  const checks: ReceiptVerifyCheck[] = [];

  const payloadDigest = sourceDigest(input.payload);
  checks.push({
    name: "payload_digest",
    ok: true,
    detail: payloadDigest,
  });

  if (!input.signature) {
    checks.push({
      name: "digest_signature",
      ok: true,
      reason: "skipped",
    });
  } else {
    const { publicKey, check: passportCheck } = await resolvePublicKey(
      input,
      fetchImpl
    );
    if (passportCheck) {
      checks.push(passportCheck);
    }

    if (!publicKey) {
      checks.push({
        name: "digest_signature",
        ok: false,
        reason:
          "signature provided but no --public-key and passport GET did not yield a key",
      });
    } else {
      const valid = await verifyPayloadSignature(
        publicKey,
        payloadDigest,
        input.signature
      );
      checks.push({
        name: "digest_signature",
        ok: valid,
        reason: valid
          ? "ed25519 signature over UTF-8(payload_digest) verified"
          : "signature does not verify over UTF-8(payload_digest) with given public key",
      });
    }
  }

  const profileCheck = await checkProfileReadback(input, fetchImpl);
  if (profileCheck) {
    checks.push(profileCheck);
  }

  const requiredChecks = checks.filter(
    (check) =>
      check.name === "payload_digest" ||
      check.name === "digest_signature" ||
      (check.name === "passport_readback" && check.ok === false)
  );

  return {
    ok: requiredChecks.every((check) => check.ok),
    checks,
  };
}

/**
 * End-to-end forensic verify from parsed CLI args.
 */
export async function verifyReceiptFromArgs(
  args: Extract<ReceiptVerifyArgs, { ok: true }>,
  fetchImpl: typeof fetch = fetch
): Promise<ReceiptVerifyResult> {
  const payload = loadPayloadFromArg(args.payloadArg);
  return verifyReceiptForensics(
    {
      baseUrl: args.baseUrl,
      subjectCommitment: args.subjectCommitment,
      payload,
      signature: args.signature,
      publicKey: args.publicKey,
    },
    fetchImpl
  );
}
