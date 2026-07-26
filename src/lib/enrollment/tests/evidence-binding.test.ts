import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import complianceReportFixture from "@/lib/reference-agents/tests/fixtures/compliance-report.json";
import { sourceDigest } from "@/lib/ingestion/github-agent-adapter";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
} from "@/lib/enrollment/identity";
import {
  InvalidEnrollmentProofError,
  NotEnrolledError,
} from "@/lib/enrollment/errors";

const PRIVATE_KEY = hexToBytes("4".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));
const SUBJECT_COMMITMENT = deriveAgentCommitment(
  PUBLIC_KEY_HEX,
  DEFAULT_ENROLLMENT_CONTEXT
);

const { findUniqueEnrollmentMock, upsertEvidenceMock, markEngagementDeliveredMock } =
  vi.hoisted(() => ({
    findUniqueEnrollmentMock: vi.fn(),
    upsertEvidenceMock: vi.fn(),
    markEngagementDeliveredMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEnrollment: {
      findUnique: findUniqueEnrollmentMock,
    },
    agentEvidence: {
      upsert: upsertEvidenceMock,
    },
  },
}));

vi.mock("@/lib/engagement/engagement-service", () => ({
  markEngagementDelivered: markEngagementDeliveredMock,
}));

import {
  resolveEnrollmentStatus,
  ingestEnrolledEvidence,
  computePayloadDigest,
} from "@/lib/enrollment/evidence-binding";

async function signDigest(payload: unknown): Promise<string> {
  const digest = computePayloadDigest(payload);
  const sig = await sign(utf8ToBytes(digest), PRIVATE_KEY);
  return bytesToHex(sig);
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertEvidenceMock.mockResolvedValue({});
  markEngagementDeliveredMock.mockResolvedValue(null);
});

describe("resolveEnrollmentStatus", () => {
  it("returns ENROLLED for ISSUED enrollment", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      status: EnrollmentStatus.ISSUED,
    });
    await expect(resolveEnrollmentStatus(SUBJECT_COMMITMENT)).resolves.toBe(
      "ENROLLED"
    );
  });

  it("returns UNENROLLED when no enrollment exists", async () => {
    findUniqueEnrollmentMock.mockResolvedValue(null);
    await expect(resolveEnrollmentStatus(SUBJECT_COMMITMENT)).resolves.toBe(
      "UNENROLLED"
    );
  });

  it("returns UNENROLLED for PENDING enrollment", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      status: EnrollmentStatus.PENDING,
    });
    await expect(resolveEnrollmentStatus(SUBJECT_COMMITMENT)).resolves.toBe(
      "UNENROLLED"
    );
  });
});

describe("ingestEnrolledEvidence", () => {
  it("accepts signed evidence and binds to issued commitment", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const payload = complianceReportFixture;
    const signature = await signDigest(payload);

    const result = await ingestEnrolledEvidence({
      subjectCommitment: SUBJECT_COMMITMENT,
      sourceType: "compliance_report",
      payload,
      signature,
    });

    expect(result.enrollment_status).toBe("ENROLLED");
    expect(result.event_commitment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(upsertEvidenceMock).toHaveBeenCalledTimes(1);
    expect(upsertEvidenceMock.mock.calls[0][0].create.agentIdentityCommitment).toBe(
      SUBJECT_COMMITMENT
    );
  });

  it("accepts APF compliance payload fields without expanding Passport public semantics", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const payload = {
      agent_identity: "agent.compliance-evidence.v1",
      control_domain: "CC8.1",
      report: {
        id: "chg-auth-rollout-abc123",
        url: "https://github.com/acme/repo/pull/42",
        title: "Deploy auth service",
      },
      action: "report_created",
      completeness: "partial",
      gaps: ["rollback_plan"],
      public_summary: "Change chg-auth-rollout-abc123 has evidence gaps.",
      observed_at: "2026-06-20T10:00:00.000Z",
      agent_artifact_digest: "a".repeat(64),
      agent_event_digest: "b".repeat(64),
    };
    const signature = await signDigest(payload);

    const result = await ingestEnrolledEvidence({
      subjectCommitment: SUBJECT_COMMITMENT,
      sourceType: "compliance_report",
      payload,
      signature,
    });

    const persisted = upsertEvidenceMock.mock.calls[0][0].create;
    expect(result).toEqual({
      event_commitment_hash: persisted.eventCommitmentHash,
      enrollment_status: "ENROLLED",
    });
    expect(persisted.agentIdentityCommitment).toBe(SUBJECT_COMMITMENT);
    expect(persisted.sourceType).toBe("compliance_report");
    expect(persisted.artifactType).toBe("compliance_report");
    expect(persisted.normalizedEventType).toBe("AGENT_ARTIFACT_CREATED");
    expect(persisted.sourceUrl).toBe("https://github.com/acme/repo/pull/42");
    expect(persisted.observedAt.toISOString()).toBe("2026-06-20T10:00:00.000Z");
    expect(persisted.sourceDigest).toBe(computePayloadDigest(payload));
    expect(persisted.eventCommitmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted).not.toHaveProperty("completeness");
    expect(persisted).not.toHaveProperty("gaps");
    expect(persisted).not.toHaveProperty("public_summary");
    expect(persisted).not.toHaveProperty("agent_artifact_digest");
    expect(persisted).not.toHaveProperty("agent_event_digest");
  });

  it("rejects APF payload readback drift after the digest is signed", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const signedPayload = {
      agent_identity: "agent.compliance-evidence.v1",
      control_domain: "CC8.1",
      report: {
        id: "chg-auth-rollout-abc123",
        url: "https://github.com/acme/repo/pull/42",
        title: "Deploy auth service",
      },
      action: "report_created",
      completeness: "complete",
      public_summary: "Change chg-auth-rollout-abc123 evidence assembled.",
      observed_at: "2026-06-20T10:00:00.000Z",
      agent_artifact_digest: "a".repeat(64),
      agent_event_digest: "b".repeat(64),
    };
    const signature = await signDigest(signedPayload);
    const driftedPayload = {
      ...signedPayload,
      public_summary: "Changed after signing.",
    };

    await expect(
      ingestEnrolledEvidence({
        subjectCommitment: SUBJECT_COMMITMENT,
        sourceType: "compliance_report",
        payload: driftedPayload,
        signature,
      })
    ).rejects.toThrow(InvalidEnrollmentProofError);
    expect(upsertEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects non-enrolled subjects", async () => {
    findUniqueEnrollmentMock.mockResolvedValue(null);
    const signature = await signDigest(complianceReportFixture);

    await expect(
      ingestEnrolledEvidence({
        subjectCommitment: SUBJECT_COMMITMENT,
        sourceType: "compliance_report",
        payload: complianceReportFixture,
        signature,
      })
    ).rejects.toThrow(NotEnrolledError);
  });

  it("rejects invalid signatures", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    await expect(
      ingestEnrolledEvidence({
        subjectCommitment: SUBJECT_COMMITMENT,
        sourceType: "compliance_report",
        payload: complianceReportFixture,
        signature: "f".repeat(128),
      })
    ).rejects.toThrow(InvalidEnrollmentProofError);
  });

  it("accepts signed task_deliverable evidence from HostHub task accept", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const payload = {
      task_id: "task_smoke_001",
      digest: "d".repeat(64),
    };
    const signature = await signDigest(payload);

    const result = await ingestEnrolledEvidence({
      subjectCommitment: SUBJECT_COMMITMENT,
      sourceType: "task_deliverable",
      payload,
      signature,
    });

    const persisted = upsertEvidenceMock.mock.calls[0][0].create;
    expect(result.enrollment_status).toBe("ENROLLED");
    expect(result.event_commitment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.sourceType).toBe("task_deliverable");
    expect(persisted.artifactType).toBe("task_deliverable");
    expect(persisted.normalizedEventType).toBe("AGENT_ARTIFACT_CREATED");
    expect(persisted.commitSha).toBe("d".repeat(64));
    expect(persisted.agentIdentityCommitment).toBe(SUBJECT_COMMITMENT);
    expect(persisted.sourceDigest).toBe(computePayloadDigest(payload));
    expect(upsertEvidenceMock).toHaveBeenCalledTimes(1);
    expect(markEngagementDeliveredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_smoke_001",
        workerCommitment: SUBJECT_COMMITMENT,
        deliverableDigest: "d".repeat(64),
      })
    );
  });

  it("rejects APF evidence when the signature was produced for a different payload digest", async () => {
    findUniqueEnrollmentMock.mockResolvedValue({
      subjectCommitment: SUBJECT_COMMITMENT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const signedPayload = {
      agent_identity: "agent.compliance-evidence.v1",
      control_domain: "CC8.1",
      report: {
        id: "chg-auth-rollout-abc123",
        url: "https://github.com/acme/repo/pull/42",
        title: "Deploy auth service",
      },
      action: "report_created",
      observed_at: "2026-06-20T10:00:00.000Z",
    };
    const submittedPayload = {
      ...signedPayload,
      report: {
        ...signedPayload.report,
        id: "chg-auth-rollout-mutated",
      },
    };
    const signature = await signDigest(signedPayload);

    await expect(
      ingestEnrolledEvidence({
        subjectCommitment: SUBJECT_COMMITMENT,
        sourceType: "compliance_report",
        payload: submittedPayload,
        signature,
      })
    ).rejects.toThrow(InvalidEnrollmentProofError);
    expect(upsertEvidenceMock).not.toHaveBeenCalled();
  });
});
