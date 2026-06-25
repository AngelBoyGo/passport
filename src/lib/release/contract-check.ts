export type ContractCheckArgs =
  | {
      ok: true;
      baseUrl: string;
      subjectCommitment?: string;
      expectedEnrollmentStatus?: "ENROLLED" | "UNENROLLED";
    }
  | { ok: false; error: string };

export type ContractCheckItem = {
  name: string;
  ok: boolean;
  reason?: string;
};

export type ContractCheckResult = {
  ok: boolean;
  checks: ContractCheckItem[];
};

/** Throwaway 64-hex commitment for read-only enrollment table probe. */
export const ENROLLMENT_READINESS_PROBE_COMMITMENT =
  "0000000000000000000000000000000000000000000000000000000000000000";

type ProfileResponse = {
  agent_commitment_hash?: unknown;
  enrollment_status?: unknown;
  timeline?: unknown;
  completeness?: unknown;
  gaps?: unknown;
};

/**
 * Parses CLI args for the Passport contract checker.
 */
export function parseContractCheckArgs(argv: string[]): ContractCheckArgs {
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

  const baseUrl = values.get("--base-url")?.replace(/\/+$/, "");
  const subjectCommitment = values.get("--subject-commitment");
  const expectedEnrollmentStatus =
    values.get("--expect-enrollment-status") ?? "ENROLLED";

  if (!baseUrl) {
    return { ok: false, error: "--base-url is required" };
  }

  if (subjectCommitment && !/^[0-9a-f]{64}$/i.test(subjectCommitment)) {
    return {
      ok: false,
      error: "--subject-commitment must be a 64-character hex string",
    };
  }

  if (
    expectedEnrollmentStatus !== "ENROLLED" &&
    expectedEnrollmentStatus !== "UNENROLLED"
  ) {
    return {
      ok: false,
      error: "--expect-enrollment-status must be ENROLLED or UNENROLLED",
    };
  }

  return {
    ok: true,
    baseUrl,
    subjectCommitment: subjectCommitment?.toLowerCase(),
    expectedEnrollmentStatus: subjectCommitment
      ? (expectedEnrollmentStatus as "ENROLLED" | "UNENROLLED")
      : undefined,
  };
}

/**
 * Returns true when profile JSON exposes APF-owned completeness/gaps fields.
 */
export function profileLeaksApfOwnedFields(profile: ProfileResponse): string[] {
  const reasons: string[] = [];

  if ("completeness" in profile || "gaps" in profile) {
    reasons.push("Passport profile exposed APF-owned completeness/gaps");
  }

  if (Array.isArray(profile.timeline)) {
    for (const entry of profile.timeline) {
      if (
        entry != null &&
        typeof entry === "object" &&
        ("completeness" in (entry as Record<string, unknown>) ||
          "gaps" in (entry as Record<string, unknown>))
      ) {
        reasons.push("Passport profile exposed APF-owned completeness/gaps");
        break;
      }
    }
  }

  return reasons;
}

/**
 * Validates optional profile readback fields without leaking APF-owned semantics.
 */
export function validateProfileReadback(
  profile: ProfileResponse,
  args: Extract<ContractCheckArgs, { ok: true }>
): ContractCheckItem {
  if (!args.subjectCommitment) {
    return { name: "profile_readback", ok: true, reason: "skipped" };
  }

  const reasons: string[] = [...profileLeaksApfOwnedFields(profile)];

  if (profile.agent_commitment_hash !== args.subjectCommitment) {
    reasons.push("agent_commitment_hash did not match subject commitment");
  }

  if (profile.enrollment_status !== args.expectedEnrollmentStatus) {
    reasons.push(
      `enrollment_status was ${String(profile.enrollment_status)}, expected ${args.expectedEnrollmentStatus}`
    );
  }

  if (reasons.length > 0) {
    return {
      name: "profile_readback",
      ok: false,
      reason: reasons.join("; "),
    };
  }

  return { name: "profile_readback", ok: true };
}

/**
 * Validates enrollment table readiness from a passport GET probe status.
 * 404 = table present (agent not found); 5xx = migration drift; 400 = probe error.
 */
export function validateEnrollmentReadiness(status: number): ContractCheckItem {
  if (status === 404) {
    return { name: "enrollment_readiness", ok: true };
  }

  if (status >= 500) {
    return {
      name: "enrollment_readiness",
      ok: false,
      reason: `passport probe returned HTTP ${status} — AgentEnrollment table may be missing or migrations not applied`,
    };
  }

  if (status === 400) {
    return {
      name: "enrollment_readiness",
      ok: false,
      reason: `passport probe returned HTTP 400 — probe commitment rejected (expected 404 for throwaway agent)`,
    };
  }

  return {
    name: "enrollment_readiness",
    ok: false,
    reason: `passport probe returned HTTP ${status}, expected 404 (not found) for throwaway agent`,
  };
}

/**
 * Runs health, public-key, enrollment_readiness, and optional profile readback checks against a deployment.
 */
export async function checkPassportContract(
  args: Extract<ContractCheckArgs, { ok: true }>,
  fetchImpl: typeof fetch = fetch
): Promise<ContractCheckResult> {
  const checks: ContractCheckItem[] = [];

  const healthUrl = `${args.baseUrl}/api/health`;
  const healthResponse = await fetchImpl(healthUrl);
  if (!healthResponse.ok) {
    checks.push({
      name: "health",
      ok: false,
      reason: `health endpoint returned HTTP ${healthResponse.status}`,
    });
  } else {
    const healthBody = (await healthResponse.json()) as { status?: unknown };
    if (healthBody.status !== "ok") {
      checks.push({
        name: "health",
        ok: false,
        reason: `health status was ${String(healthBody.status)}, expected ok`,
      });
    } else {
      checks.push({ name: "health", ok: true });
    }
  }

  const publicKeyUrl = `${args.baseUrl}/api/v1/public-key`;
  const publicKeyResponse = await fetchImpl(publicKeyUrl);
  if (!publicKeyResponse.ok) {
    checks.push({
      name: "public_key",
      ok: false,
      reason: `public-key endpoint returned HTTP ${publicKeyResponse.status}`,
    });
  } else {
    const publicKeyBody = (await publicKeyResponse.json()) as {
      public_key?: unknown;
    };
    if (
      typeof publicKeyBody.public_key !== "string" ||
      publicKeyBody.public_key.length === 0
    ) {
      checks.push({
        name: "public_key",
        ok: false,
        reason: "public-key response missing public_key",
      });
    } else {
      checks.push({ name: "public_key", ok: true });
    }
  }

  const passportProbeUrl = `${args.baseUrl}/api/v1/passport/agents/${ENROLLMENT_READINESS_PROBE_COMMITMENT}/passport`;
  const passportProbeResponse = await fetchImpl(passportProbeUrl);
  checks.push(validateEnrollmentReadiness(passportProbeResponse.status));

  if (args.subjectCommitment) {
    const profileUrl = `${args.baseUrl}/api/v1/profiles/${args.subjectCommitment}`;
    const profileResponse = await fetchImpl(profileUrl);
    if (!profileResponse.ok) {
      checks.push({
        name: "profile_readback",
        ok: false,
        reason: `profile endpoint returned HTTP ${profileResponse.status}`,
      });
    } else {
      const profile = (await profileResponse.json()) as ProfileResponse;
      checks.push(validateProfileReadback(profile, args));
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}
