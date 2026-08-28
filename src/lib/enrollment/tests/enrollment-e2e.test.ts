import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import complianceReportFixture from "@/lib/reference-agents/tests/fixtures/compliance-report.json";
import {
  DEFAULT_ENROLLMENT_CONTEXT,
  deriveAgentCommitment,
} from "@/lib/enrollment/identity";
import {
  computePayloadDigest,
  ingestEnrolledEvidence,
} from "@/lib/enrollment/evidence-binding";
import { evaluateReceiptEligibility } from "@/lib/reference-agents/receipt-eligibility";
import { getAgentProfile } from "@/lib/public-portal/portal-service";

const PRIVATE_KEY = hexToBytes("5".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));

const {
  findUniqueEnrollmentMock,
  upsertEnrollmentMock,
  updateEnrollmentMock,
  findFirstEnrollmentMock,
  findManyEvidenceMock,
  upsertEvidenceMock,
  findFirstEvidenceMock,
} = vi.hoisted(() => ({
  findUniqueEnrollmentMock: vi.fn(),
  upsertEnrollmentMock: vi.fn(),
  updateEnrollmentMock: vi.fn(),
  findFirstEnrollmentMock: vi.fn(),
  findManyEvidenceMock: vi.fn(),
  upsertEvidenceMock: vi.fn(),
  findFirstEvidenceMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEnrollment: {
      findUnique: findUniqueEnrollmentMock,
      findFirst: findFirstEnrollmentMock,
      upsert: upsertEnrollmentMock,
      update: updateEnrollmentMock,
    },
    agentEvidence: {
      findMany: findManyEvidenceMock,
      upsert: upsertEvidenceMock,
      findFirst: findFirstEvidenceMock,
    },
  },
}));

import {
  startEnrollment,
  completeEnrollment,
} from "@/lib/enrollment/enrollment-service";

type EnrollmentRow = {
  id: string;
  subjectCommitment: string;
  publicKey: string;
  context: string;
  status: EnrollmentStatus;
  challengeNonce: string | null;
  challengeExpiresAt: Date | null;
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let enrollmentStore: Map<string, EnrollmentRow>;
let evidenceStore: Array<Record<string, unknown>>;

async function signMessage(message: string): Promise<string> {
  const sig = await sign(utf8ToBytes(message), PRIVATE_KEY);
  return bytesToHex(sig);
}

beforeEach(() => {
  enrollmentStore = new Map();
  evidenceStore = [];
  process.env.INGESTION_COMMITMENT_SALT = "vitest-ingestion-commitment-salt";
  vi.clearAllMocks();

  findUniqueEnrollmentMock.mockImplementation(
    async (args: { where: { subjectCommitment: string } }) =>
      enrollmentStore.get(args.where.subjectCommitment) ?? null
  );

  upsertEnrollmentMock.mockImplementation(
    async (args: {
      where: { subjectCommitment: string };
      create: Omit<EnrollmentRow, "id" | "createdAt" | "updatedAt">;
      update: Partial<EnrollmentRow>;
    }) => {
      const existing = enrollmentStore.get(args.where.subjectCommitment);
      if (existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        enrollmentStore.set(args.where.subjectCommitment, updated);
        return updated;
      }
      const created: EnrollmentRow = {
        id: "enr_e2e",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.create,
      };
      enrollmentStore.set(args.where.subjectCommitment, created);
      return created;
    }
  );

  updateEnrollmentMock.mockImplementation(
    async (args: {
      where: { subjectCommitment: string };
      data: Partial<EnrollmentRow>;
    }) => {
      const existing = enrollmentStore.get(args.where.subjectCommitment);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      enrollmentStore.set(args.where.subjectCommitment, updated);
      return updated;
    }
  );

  upsertEvidenceMock.mockImplementation(async (args: { create: Record<string, unknown> }) => {
    evidenceStore.push(args.create);
    return args.create;
  });

  findManyEvidenceMock.mockImplementation(
    async (args: { where: { agentIdentityCommitment: string } }) =>
      evidenceStore.filter(
        (row) => row.agentIdentityCommitment === args.where.agentIdentityCommitment
      )
  );
});

describe("enrollment end-to-end flow", () => {
  it("enrolls, ingests evidence, surfaces ENROLLED profile, and passes receipt eligibility", async () => {
    const started = await startEnrollment(PUBLIC_KEY_HEX);
    expect(started.status).toBe(EnrollmentStatus.PENDING);
    expect(started.challengeNonce).toBeTruthy();

    const signature = await signMessage(started.challengeNonce!);
    const completed = await completeEnrollment(
      started.subjectCommitment,
      signature
    );
    expect(completed.status).toBe(EnrollmentStatus.ISSUED);

    const payload = complianceReportFixture;
    const payloadDigest = computePayloadDigest(payload);
    const evidenceSignature = await signMessage(payloadDigest);

    const ingested = await ingestEnrolledEvidence({
      subjectCommitment: started.subjectCommitment,
      sourceType: "compliance_report",
      payload,
      signature: evidenceSignature,
    });
    expect(ingested.enrollment_status).toBe("ENROLLED");

    const profile = await getAgentProfile(started.subjectCommitment);
    expect(profile).not.toBeNull();
    expect(profile!.enrollment_status).toBe("ENROLLED");
    expect(profile!.totals.evidence_count).toBe(1);

    const stored = evidenceStore[0];
    expect(stored.agentIdentityCommitment).toBe(started.subjectCommitment);

    const eligibility = evaluateReceiptEligibility({
      agentIdentityCommitment: started.subjectCommitment,
      sourceType: stored.sourceType as unknown as import("@/lib/ingestion/github-agent-adapter").SourceType,
      normalizedEventType: stored.normalizedEventType as unknown as import("@/lib/ingestion/github-agent-adapter").NormalizedEventType,
      observedAt: stored.observedAt as Date,
      eventCommitmentHash: String(stored.eventCommitmentHash),
      commitSha: (stored.commitSha as string | null) ?? null,
      sourceUrl: (stored.sourceUrl as string | null) ?? null,
      validationSignalPresent: Boolean(stored.validationSignalPresent),
    });
    expect(eligibility.eligible).toBe(true);

    expect(
      deriveAgentCommitment(PUBLIC_KEY_HEX, DEFAULT_ENROLLMENT_CONTEXT)
    ).toBe(started.subjectCommitment);
  });
});
