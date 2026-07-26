import { describe, it, expect, vi } from "vitest";
import {
  parseContractCheckArgs,
  checkPassportContract,
  ENROLLMENT_READINESS_PROBE_COMMITMENT,
  validateEnrollmentReadiness,
} from "@/lib/release/contract-check";

describe("parseContractCheckArgs", () => {
  it("requires --base-url", () => {
    const parsed = parseContractCheckArgs([]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("--base-url is required");
    }
  });

  it("parses base-url and optional profile args", () => {
    const parsed = parseContractCheckArgs([
      "--base-url",
      "https://passport.example.com/",
      "--subject-commitment",
      "a".repeat(64),
      "--expect-enrollment-status",
      "UNENROLLED",
    ]);

    expect(parsed).toEqual({
      ok: true,
      baseUrl: "https://passport.example.com",
      subjectCommitment: "a".repeat(64),
      expectedEnrollmentStatus: "UNENROLLED",
    });
  });

  it("rejects invalid subject commitment", () => {
    const parsed = parseContractCheckArgs([
      "--base-url",
      "https://passport.example.com",
      "--subject-commitment",
      "bad",
    ]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("subject-commitment");
    }
  });

  it("rejects invalid expect-enrollment-status", () => {
    const parsed = parseContractCheckArgs([
      "--base-url",
      "https://passport.example.com",
      "--subject-commitment",
      "a".repeat(64),
      "--expect-enrollment-status",
      "PENDING",
    ]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("expect-enrollment-status");
    }
  });
});

describe("validateEnrollmentReadiness", () => {
  it("passes when passport GET returns 404 (table present, not found)", () => {
    const result = validateEnrollmentReadiness(404);
    expect(result).toEqual({ name: "enrollment_readiness", ok: true });
  });

  it("fails when passport GET returns 5xx (migration drift)", () => {
    const result = validateEnrollmentReadiness(500);
    expect(result.ok).toBe(false);
    expect(result.name).toBe("enrollment_readiness");
    expect(result.reason).toContain("500");
    expect(result.reason).toMatch(/migration|AgentEnrollment/i);
  });

  it("fails when passport GET returns 400 (probe error)", () => {
    const result = validateEnrollmentReadiness(400);
    expect(result.ok).toBe(false);
    expect(result.name).toBe("enrollment_readiness");
    expect(result.reason).toMatch(/probe|400/i);
  });
});

describe("checkPassportContract", () => {
  const passportProbeUrl = `/api/v1/passport/agents/${ENROLLMENT_READINESS_PROBE_COMMITMENT}/passport`;

  function mockBaseFetchImpl(
    overrides: Partial<Record<string, Response>> = {}
  ) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.endsWith("/api/health")) {
        return (
          overrides.health ??
          new Response(JSON.stringify({ status: "ok" }), { status: 200 })
        );
      }
      if (urlStr.endsWith("/api/v1/public-key")) {
        return (
          overrides.publicKey ??
          new Response(
            JSON.stringify({ algorithm: "ed25519", public_key: "a".repeat(64) }),
            { status: 200 }
          )
        );
      }
      if (urlStr.endsWith(passportProbeUrl)) {
        return (
          overrides.enrollmentReadiness ??
          new Response(JSON.stringify({ error: "Passport not found" }), {
            status: 404,
          })
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
  }

  const baseArgs = {
    ok: true as const,
    baseUrl: "https://passport.example.com",
  };

  it("passes when health, public-key, and enrollment_readiness checks succeed", async () => {
    const fetchImpl = mockBaseFetchImpl();

    const result = await checkPassportContract(baseArgs, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.checks.find((c) => c.name === "enrollment_readiness")?.ok).toBe(
      true
    );
  });

  it("fails when enrollment_readiness returns 500", async () => {
    const fetchImpl = mockBaseFetchImpl({
      enrollmentReadiness: new Response(
        JSON.stringify({ error: "Internal server error" }),
        { status: 500 }
      ),
    });

    const result = await checkPassportContract(baseArgs, fetchImpl);
    expect(result.ok).toBe(false);
    const readiness = result.checks.find((c) => c.name === "enrollment_readiness");
    expect(readiness?.ok).toBe(false);
    expect(readiness?.reason).toMatch(/500/i);
  });

  it("fails when health check is unhealthy", async () => {
    const fetchImpl = mockBaseFetchImpl({
      health: new Response(JSON.stringify({ status: "unavailable" }), {
        status: 503,
      }),
    });

    const result = await checkPassportContract(baseArgs, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "health")?.ok).toBe(false);
  });

  it("fails profile readback when completeness/gaps leak", async () => {
    const commitment = "b".repeat(64);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.endsWith("/api/health")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (urlStr.endsWith("/api/v1/public-key")) {
        return new Response(
          JSON.stringify({ algorithm: "ed25519", public_key: "a".repeat(64) }),
          { status: 200 }
        );
      }
      if (urlStr.endsWith(passportProbeUrl)) {
        return new Response(JSON.stringify({ error: "Passport not found" }), {
          status: 404,
        });
      }
      if (urlStr.endsWith(`/api/v1/profiles/${commitment}`)) {
        return new Response(
          JSON.stringify({
            agent_commitment_hash: commitment,
            enrollment_status: "ENROLLED",
            timeline: [
              {
                source_type: "compliance_report",
                completeness: "complete",
                gaps: [],
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await checkPassportContract(
      {
        ok: true,
        baseUrl: "https://passport.example.com",
        subjectCommitment: commitment,
        expectedEnrollmentStatus: "ENROLLED",
      },
      fetchImpl
    );

    expect(result.ok).toBe(false);
    const profileCheck = result.checks.find((c) => c.name === "profile_readback");
    expect(profileCheck?.ok).toBe(false);
    expect(profileCheck?.reason).toContain("completeness");
  });
});
