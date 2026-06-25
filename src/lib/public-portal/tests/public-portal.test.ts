import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  groupByMock,
  findManyMock,
  countMock,
  getReceiptWithHistoryMock,
  verifyReceiptMock,
  findBridgeMock,
  findEnrollmentMock,
} = vi.hoisted(() => ({
  groupByMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  getReceiptWithHistoryMock: vi.fn(),
  verifyReceiptMock: vi.fn(),
  findBridgeMock: vi.fn(),
  findEnrollmentMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEvidence: {
      groupBy: groupByMock,
      findMany: findManyMock,
      count: countMock,
    },
    evidenceReceiptLink: {
      findFirst: findBridgeMock,
    },
    agentEnrollment: {
      findUnique: findEnrollmentMock,
    },
  },
}));

vi.mock("@/lib/receipt-service", () => ({
  getReceiptWithHistory: (...args: unknown[]) =>
    getReceiptWithHistoryMock(...args),
  dbReceiptToPayload: (row: Record<string, unknown>) => ({
    receipt_id: row.receiptId,
    issued_at:
      row.issuedAt instanceof Date
        ? row.issuedAt.toISOString()
        : String(row.issuedAt),
    operator_id: row.operatorId,
    agent_id: row.agentId,
    receipt_type: row.receiptType,
    status: row.status,
    input_digest: row.inputDigest,
    authority_scope: row.authorityScope,
    expiry:
      row.expiry instanceof Date
        ? row.expiry.toISOString()
        : String(row.expiry),
    revocation_status: row.revocationStatus ?? "active",
    output_hash: row.outputHash ?? undefined,
    refusal_reason: row.refusalReason ?? undefined,
    terminal_reason: row.terminalReason ?? undefined,
    prev_receipt_hash: row.prevReceiptHash ?? undefined,
    content_hash: row.contentHash,
    signature: row.signature ?? undefined,
  }),
}));

vi.mock("@/lib/receipt/verify", () => ({
  verifyReceipt: (...args: unknown[]) => verifyReceiptMock(...args),
}));

import {
  computeRates,
  evidenceOutcomeLabel,
  getLeaderboard,
  getAgentProfile,
  getReceiptPublicManifest,
  parseLeaderboardLimit,
} from "@/lib/public-portal/portal-service";
import { REFERENCE_AGENTS } from "@/lib/reference-agents/registry";
import {
  normalizeEvidence,
  toMaskedEvidence,
} from "@/lib/ingestion/github-agent-adapter";
import repoStewardFixture from "@/lib/reference-agents/tests/fixtures/repo-steward.json";
import issueTriageFixture from "@/lib/reference-agents/tests/fixtures/issue-triage.json";
import complianceReportFixture from "@/lib/reference-agents/tests/fixtures/compliance-report.json";

/** 64-hex agent commitment hashes sharing the same 12-hex footprint prefix. */
const AGENT_A = "a".repeat(64);
const AGENT_B = "a".repeat(12) + "b".repeat(52);
const FOOTPRINT = "a".repeat(12);

const RAW_LEAKAGE_TOKENS = [
  "acme/secret-repo",
  "refs/heads/main",
  "https://github.com/acme/secret-repo",
  "fix the auth bug in login.ts",
  "Agent-Logs-Url: https://logs.internal.example/sess-1",
];

type EvidenceSeed = {
  normalizedEventType: string;
  rawErrorClassification?: string | null;
  validationSignalPresent?: boolean;
  sessionLogUrlCommitment?: string | null;
  sourceType?: string;
  artifactType?: string;
  observedAt: Date;
  agentIdentityCommitment?: string;
};

function evidenceRow(seed: EvidenceSeed) {
  return {
    normalizedEventType: seed.normalizedEventType,
    rawErrorClassification: seed.rawErrorClassification ?? null,
    validationSignalPresent: seed.validationSignalPresent ?? false,
    sessionLogUrlCommitment: seed.sessionLogUrlCommitment ?? null,
    sourceType: seed.sourceType ?? "github_push_webhook",
    artifactType: seed.artifactType ?? "commit",
    observedAt: seed.observedAt,
    agentIdentityCommitment: seed.agentIdentityCommitment ?? AGENT_A,
  };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function assertNoRawLeakage(value: unknown) {
  const json = JSON.stringify(value);
  for (const token of RAW_LEAKAGE_TOKENS) {
    expect(json).not.toContain(token);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  findBridgeMock.mockResolvedValue(null);
  findEnrollmentMock.mockResolvedValue(null);
  process.env.INGESTION_COMMITMENT_SALT = "vitest-ingestion-commitment-salt";
});

describe("computeRates", () => {
  it("returns null rates when no eligible observed evidence units exist", () => {
    const rates = computeRates([
      evidenceRow({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        observedAt: daysAgo(1),
      }),
    ]);
    expect(rates).toEqual({
      success_rate: null,
      correction_rate: null,
      failure_rate: null,
      validation_visibility_rate: null,
      trace_visibility_rate: null,
    });
  });

  it("computes artifact-completion success_rate and companion rates", () => {
    const rates = computeRates([
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: daysAgo(1),
      }),
      evidenceRow({
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        validationSignalPresent: true,
        sessionLogUrlCommitment: "abc123commitmenthash",
        observedAt: daysAgo(2),
      }),
      evidenceRow({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        observedAt: daysAgo(3),
      }),
      evidenceRow({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        observedAt: daysAgo(4),
      }),
    ]);

    expect(rates.success_rate).toBeCloseTo(0.5);
    expect(rates.correction_rate).toBeCloseTo(0.5);
    expect(rates.failure_rate).toBeCloseTo(0.5);
    expect(rates.validation_visibility_rate).toBeCloseTo(0.5);
    expect(rates.trace_visibility_rate).toBeCloseTo(0.5);
  });

  it("counts otel_genai_trace rows toward trace_visibility_rate", () => {
    const rates = computeRates([
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        sourceType: "otel_genai_trace",
        observedAt: daysAgo(1),
      }),
    ]);
    expect(rates.trace_visibility_rate).toBe(1);
  });
});

describe("getLeaderboard", () => {
  it("aggregates counts, 30d rates, and trajectory from mixed evidence", async () => {
    const lastObserved = daysAgo(1);
    groupByMock.mockResolvedValue([
      {
        agentIdentityCommitment: AGENT_A,
        _count: { _all: 4 },
        _max: { observedAt: lastObserved },
      },
    ]);

    const events30d = [
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: daysAgo(2),
      }),
      evidenceRow({
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        validationSignalPresent: true,
        sessionLogUrlCommitment: "sesscommit",
        observedAt: daysAgo(3),
      }),
      evidenceRow({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        observedAt: daysAgo(4),
      }),
      evidenceRow({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        observedAt: daysAgo(5),
      }),
    ];

    const events7d = events30d.filter((e) => e.observedAt >= daysAgo(7));
    const eventsPrior7d = [
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: daysAgo(10),
      }),
    ];

    findManyMock.mockImplementation(
      async (args: { where: { observedAt?: { gte?: Date; lt?: Date } } }) => {
        const gte = args.where.observedAt?.gte;
        const lt = args.where.observedAt?.lt;
        if (lt) {
          return eventsPrior7d.filter(
            (e) => (!gte || e.observedAt >= gte) && e.observedAt < lt
          );
        }
        if (gte && gte >= daysAgo(8)) {
          return events7d.filter((e) => e.observedAt >= gte);
        }
        if (gte) {
          return events30d.filter((e) => e.observedAt >= gte);
        }
        return events30d;
      }
    );

    countMock.mockResolvedValue(1);

    const rows = await getLeaderboard({ limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent_commitment_hash: AGENT_A,
      public_footprint_identifier: FOOTPRINT,
      evidence_count: 4,
      artifact_count: 1,
      last_observed_at: lastObserved.toISOString(),
    });
    expect(rows[0].success_rate_rolling_30d).toBeCloseTo(0.5);
    expect(rows[0].correction_rate_rolling_30d).toBeCloseTo(0.5);
    expect(rows[0].failure_rate_rolling_30d).toBeCloseTo(0.5);
    expect(["UP", "FLAT", "DOWN"]).toContain(rows[0].trajectory_7d);
    assertNoRawLeakage(rows);
  });

  it("returns two distinct rows when agents share a 12-hex footprint prefix", async () => {
    groupByMock.mockResolvedValue([
      {
        agentIdentityCommitment: AGENT_B,
        _count: { _all: 3 },
        _max: { observedAt: daysAgo(2) },
      },
      {
        agentIdentityCommitment: AGENT_A,
        _count: { _all: 2 },
        _max: { observedAt: daysAgo(1) },
      },
    ]);

    findManyMock.mockResolvedValue([
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        observedAt: daysAgo(1),
      }),
    ]);
    countMock.mockResolvedValue(0);

    const rows = await getLeaderboard({ limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0].agent_commitment_hash).toBe(AGENT_B);
    expect(rows[1].agent_commitment_hash).toBe(AGENT_A);
    expect(rows[0].public_footprint_identifier).toBe(FOOTPRINT);
    expect(rows[1].public_footprint_identifier).toBe(FOOTPRINT);
    expect(rows[0].agent_commitment_hash).not.toBe(rows[1].agent_commitment_hash);
  });

  it("returns null 30d rates when the 30d window has no eligible units", async () => {
    groupByMock.mockResolvedValue([
      {
        agentIdentityCommitment: AGENT_A,
        _count: { _all: 1 },
        _max: { observedAt: daysAgo(40) },
      },
    ]);

    findManyMock.mockImplementation(
      async (args: { where: { observedAt?: { gte?: Date; lt?: Date } } }) => {
        const gte = args.where.observedAt?.gte;
        const lt = args.where.observedAt?.lt;
        if (lt && gte && gte >= daysAgo(8)) {
          return [
            evidenceRow({
              normalizedEventType: "AGENT_ARTIFACT_CREATED",
              observedAt: daysAgo(3),
            }),
          ];
        }
        if (gte && gte >= daysAgo(8)) {
          return [
            evidenceRow({
              normalizedEventType: "AGENT_ARTIFACT_CREATED",
              observedAt: daysAgo(3),
            }),
          ];
        }
        return [];
      }
    );
    countMock.mockResolvedValue(1);

    const rows = await getLeaderboard({ limit: 5 });
    expect(rows[0].success_rate_rolling_30d).toBeNull();
    expect(rows[0].trajectory_7d).toBe("FLAT");
  });
});

describe("evidenceOutcomeLabel", () => {
  it("maps normalized event types to additive outcome labels", () => {
    expect(evidenceOutcomeLabel("AGENT_ARTIFACT_CREATED")).toBe("produced");
    expect(evidenceOutcomeLabel("VALIDATION_OBSERVED")).toBe("validated");
    expect(evidenceOutcomeLabel("HUMAN_CORRECTION_OBSERVED")).toBe("corrected");
    expect(evidenceOutcomeLabel("EXECUTION_FAILURE_OBSERVED")).toBe("failed");
    expect(evidenceOutcomeLabel("AGENT_RUN_OBSERVED")).toBe("observed");
  });
});

describe("getAgentProfile", () => {
  it("returns distributions and reverse-chronological timeline", async () => {
    const older = daysAgo(5);
    const newer = daysAgo(1);
    findManyMock.mockResolvedValue([
      evidenceRow({
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        rawErrorClassification: "NONE",
        validationSignalPresent: true,
        sessionLogUrlCommitment: "logcommit",
        observedAt: newer,
        sourceType: "otel_genai_trace",
        artifactType: "trace_span",
      }),
      evidenceRow({
        normalizedEventType: "HUMAN_CORRECTION_OBSERVED",
        observedAt: daysAgo(3),
      }),
      evidenceRow({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        observedAt: daysAgo(4),
      }),
      evidenceRow({
        normalizedEventType: "AGENT_RUN_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        observedAt: older,
        sourceType: "github_push_webhook",
        artifactType: "commit",
      }),
    ]);

    const profile = await getAgentProfile(AGENT_A);
    expect(profile).not.toBeNull();
    expect(profile!.agent_commitment_hash).toBe(AGENT_A);
    expect(profile!.enrollment_status).toBe("UNENROLLED");
    expect(profile!.totals).toEqual({
      evidence_count: 4,
      artifact_count: 1,
      correction_count: 1,
      failure_count: 1,
    });
    expect(profile!.distributions.normalized_event_type).toMatchObject({
      AGENT_RUN_OBSERVED: 1,
      AGENT_ARTIFACT_CREATED: 1,
      HUMAN_CORRECTION_OBSERVED: 1,
      EXECUTION_FAILURE_OBSERVED: 1,
    });
    expect(profile!.distributions.error_tranche).toMatchObject({
      LOGIC_DETECTION: 1,
      NONE: 1,
    });
    expect(profile!.timeline[0].observed_at).toBe(newer.toISOString());
    expect(profile!.timeline[profile!.timeline.length - 1].observed_at).toBe(
      older.toISOString()
    );
    expect(profile!.timeline[0]).toMatchObject({
      source_type: "otel_genai_trace",
      artifact_type: "trace_span",
      session_log_available: true,
      validation_signal_present: true,
      outcome: "produced",
    });
    expect(profile!.timeline.every((entry) => entry.outcome != null)).toBe(
      true
    );
    expect(profile!.trend_windows["30d"].success_rate).not.toBeNull();
    assertNoRawLeakage(profile);
  });

  it("returns null for unknown agent", async () => {
    findManyMock.mockResolvedValue([]);
    const profile = await getAgentProfile(AGENT_A);
    expect(profile).toBeNull();
  });

  it("surfaces ENROLLED when an ISSUED enrollment exists", async () => {
    findManyMock.mockResolvedValue([
      evidenceRow({
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        observedAt: daysAgo(1),
      }),
    ]);
    findEnrollmentMock.mockResolvedValue({ status: "ISSUED" });

    const profile = await getAgentProfile(AGENT_A);
    expect(profile).not.toBeNull();
    expect(profile!.enrollment_status).toBe("ENROLLED");
  });

  it("preserves APF profile readback fields without APF-owned packet semantics", async () => {
    const observedAt = new Date("2026-06-20T10:00:00.000Z");
    findManyMock.mockResolvedValue([
      evidenceRow({
        normalizedEventType: "AGENT_ARTIFACT_CREATED",
        sourceType: "compliance_report",
        artifactType: "compliance_report",
        observedAt,
      }),
    ]);
    findEnrollmentMock.mockResolvedValue({ status: "ISSUED" });

    const profile = await getAgentProfile(AGENT_A);

    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      agent_commitment_hash: AGENT_A,
      enrollment_status: "ENROLLED",
      totals: {
        evidence_count: 1,
        artifact_count: 1,
        correction_count: 0,
        failure_count: 0,
      },
      distributions: {
        normalized_event_type: {
          AGENT_ARTIFACT_CREATED: 1,
        },
      },
      timeline: [
        {
          source_type: "compliance_report",
          artifact_type: "compliance_report",
          observed_at: observedAt.toISOString(),
          session_log_available: false,
          validation_signal_present: false,
          outcome: "produced",
        },
      ],
    });
    expect(JSON.stringify(profile)).not.toContain("completeness");
    expect(JSON.stringify(profile)).not.toContain("gaps");
    assertNoRawLeakage(profile);
  });

  it("surfaces outcome per reference agent after normalize-to-profile flow", async () => {
    const cases = [
      {
        label: "repo steward",
        sourceType: "github_push_webhook" as const,
        payload: repoStewardFixture,
        commitment: REFERENCE_AGENTS.REPO_STEWARD.subjectCommitment,
        expectedOutcome: "produced",
      },
      {
        label: "issue triage",
        sourceType: "github_issue_event" as const,
        payload: issueTriageFixture,
        commitment: REFERENCE_AGENTS.ISSUE_TRIAGE.subjectCommitment,
        expectedOutcome: "produced",
      },
      {
        label: "compliance evidence",
        sourceType: "compliance_report" as const,
        payload: complianceReportFixture,
        commitment: REFERENCE_AGENTS.COMPLIANCE_EVIDENCE.subjectCommitment,
        expectedOutcome: "produced",
      },
    ];

    for (const testCase of cases) {
      const normalized = normalizeEvidence({
        sourceType: testCase.sourceType,
        payload: testCase.payload,
      });
      const masked = toMaskedEvidence(normalized[0]);
      findManyMock.mockResolvedValue([
        {
          normalizedEventType: masked.normalizedEventType,
          rawErrorClassification: masked.rawErrorClassification,
          validationSignalPresent: masked.validationSignalPresent,
          sessionLogUrlCommitment: masked.sessionLogUrlCommitment,
          sourceType: masked.sourceType,
          artifactType: masked.artifactType,
          observedAt: masked.observedAt,
          agentIdentityCommitment: masked.agentIdentityCommitment,
        },
      ]);

      const profile = await getAgentProfile(testCase.commitment);
      expect(profile).not.toBeNull();
      expect(profile!.timeline[0].outcome).toBe(testCase.expectedOutcome);
      assertNoRawLeakage(profile);
    }
  });
});

describe("getReceiptPublicManifest", () => {
  it("returns manifest shape with parent_hash null and proof_chain_available", async () => {
    const issuedAt = new Date("2026-06-10T12:00:00Z");
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_test123",
        issuedAt,
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "invocation",
        status: "success",
        inputDigest: "digest-secret-task-prompt",
        authorityScope: "codegen",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        outputHash: "output-secret",
        prevReceiptHash: "prevhash",
        contentHash: "contenthash",
        signature: "deadbeef",
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [],
    });
    verifyReceiptMock.mockResolvedValue({ valid: true, receipt: {} });

    const manifest = await getReceiptPublicManifest("rcpt_test123");
    expect(manifest).not.toBeNull();
    expect(manifest).toMatchObject({
      receipt_id: "rcpt_test123",
      record_type: "success",
      commitment_hash: "contenthash",
      previous_hash: "prevhash",
      parent_hash: null,
      observed_at: issuedAt.toISOString(),
      verification_status: "verified",
      proof_chain_available: true,
      inclusion_path: [
        {
          receipt_id: "rcpt_test123",
          commitment_hash: "contenthash",
          previous_hash: "prevhash",
        },
      ],
      enforcement_state: null,
      linked_liability_event_id: null,
    });
    expect(manifest!.masked_fields).toEqual(
      expect.arrayContaining([
        "input_digest",
        "output_hash",
        "operator_id",
        "agent_id",
      ])
    );
    assertNoRawLeakage(manifest);
  });

  it("returns null inclusion_path when proof chain is unavailable", async () => {
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_no_chain",
        issuedAt: new Date("2026-06-10T12:00:00Z"),
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "custody",
        status: "success",
        inputDigest: "digest",
        authorityScope: "ingest.public-evidence.github_push_webhook",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        contentHash: "contenthash",
        signature: "deadbeef",
        prevReceiptHash: null,
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [],
    });
    verifyReceiptMock.mockResolvedValue({ valid: true, receipt: {} });

    const manifest = await getReceiptPublicManifest("rcpt_no_chain");
    expect(manifest!.proof_chain_available).toBe(false);
    expect(manifest!.inclusion_path).toBeNull();
  });

  it("builds inclusion_path genesis-to-target from history chain", async () => {
    const genesisAt = new Date("2026-06-08T12:00:00Z");
    const targetAt = new Date("2026-06-10T12:00:00Z");
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_target",
        issuedAt: targetAt,
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "custody",
        status: "success",
        inputDigest: "digest-target",
        authorityScope: "ingest.public-evidence.github_push_webhook",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        contentHash: "hash_target",
        signature: "sig_target",
        prevReceiptHash: "hash_genesis",
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [
        {
          receiptId: "rcpt_genesis",
          issuedAt: genesisAt,
          contentHash: "hash_genesis",
          prevReceiptHash: null,
        },
      ],
    });
    verifyReceiptMock.mockResolvedValue({ valid: true, receipt: {} });

    const manifest = await getReceiptPublicManifest("rcpt_target");
    expect(manifest!.inclusion_path).toEqual([
      {
        receipt_id: "rcpt_genesis",
        commitment_hash: "hash_genesis",
        previous_hash: null,
      },
      {
        receipt_id: "rcpt_target",
        commitment_hash: "hash_target",
        previous_hash: "hash_genesis",
      },
    ]);
    assertNoRawLeakage(manifest);
  });

  it("surfaces enforcement_state and linked_liability_event_id from bridge join", async () => {
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_bridged",
        issuedAt: new Date("2026-06-10T12:00:00Z"),
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "custody",
        status: "failure_tombstone",
        inputDigest: "digest",
        authorityScope: "ingest.public-evidence.github_push_webhook",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        contentHash: "contenthash",
        signature: "deadbeef",
        prevReceiptHash: "prevhash",
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [],
    });
    findBridgeMock.mockResolvedValue({
      enforcementState: "ENFORCEMENT_ELIGIBLE",
      liabilityEventId: "slash_ledger_99",
    });
    verifyReceiptMock.mockResolvedValue({ valid: true, receipt: {} });

    const manifest = await getReceiptPublicManifest("rcpt_bridged");
    expect(manifest!.enforcement_state).toBe("ENFORCEMENT_ELIGIBLE");
    expect(manifest!.linked_liability_event_id).toBe("slash_ledger_99");
    assertNoRawLeakage(manifest);
  });

  it("returns null enforcement fields when no bridge row exists (backward compat)", async () => {
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_legacy",
        issuedAt: new Date("2026-06-10T12:00:00Z"),
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "invocation",
        status: "success",
        inputDigest: "digest",
        authorityScope: "codegen",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        contentHash: "contenthash",
        signature: "deadbeef",
        prevReceiptHash: null,
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [],
    });
    findBridgeMock.mockResolvedValue(null);
    verifyReceiptMock.mockResolvedValue({ valid: true, receipt: {} });

    const manifest = await getReceiptPublicManifest("rcpt_legacy");
    expect(manifest!.enforcement_state).toBeNull();
    expect(manifest!.linked_liability_event_id).toBeNull();
  });

  it("sets verification_status failed when signature present but verifyReceipt invalid", async () => {
    getReceiptWithHistoryMock.mockResolvedValue({
      receipt: {
        receiptId: "rcpt_bad_sig",
        issuedAt: new Date("2026-06-10T12:00:00Z"),
        operatorId: "op_cus_test",
        agentId: "agent-1",
        receiptType: "invocation",
        status: "success",
        inputDigest: "digest",
        authorityScope: "codegen",
        expiry: new Date("2027-06-10T12:00:00Z"),
        revocationStatus: "active",
        contentHash: "contenthash",
        signature: "present-but-invalid",
        prevReceiptHash: null,
        operator: { stripeCustomerId: "cus_test" },
        agent: { agentId: "agent-1" },
      },
      history: [],
    });
    verifyReceiptMock.mockResolvedValue({
      valid: false,
      error: "Invalid signature or tampered content",
    });

    const manifest = await getReceiptPublicManifest("rcpt_bad_sig");
    expect(manifest!.verification_status).toBe("failed");
    expect(manifest!.verification_status).not.toBe("verified");
  });

  it("returns null when receipt is missing", async () => {
    getReceiptWithHistoryMock.mockResolvedValue(null);
    const manifest = await getReceiptPublicManifest("rcpt_missing");
    expect(manifest).toBeNull();
  });
});

describe("parseLeaderboardLimit", () => {
  it("clamps upper bound to 100", () => {
    expect(parseLeaderboardLimit("500")).toEqual({ ok: true, limit: 100 });
  });
});

describe("GET /api/v1/leaderboard", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();
    groupByMock.mockResolvedValue([]);
  });

  it("clamps limit to 100 and rejects negative or non-numeric values", async () => {
    const { GET } = await import("@/app/api/v1/leaderboard/route");

    const badNegative = await GET(
      new Request("http://localhost/api/v1/leaderboard?limit=-5") as import("next/server").NextRequest
    );
    expect(badNegative.status).toBe(400);

    const badNaN = await GET(
      new Request("http://localhost/api/v1/leaderboard?limit=abc") as import("next/server").NextRequest
    );
    expect(badNaN.status).toBe(400);

    groupByMock.mockResolvedValue([]);
    const clamped = await GET(
      new Request("http://localhost/api/v1/leaderboard?limit=500") as import("next/server").NextRequest
    );
    expect(clamped.status).toBe(200);
    const body = await clamped.json();
    expect(body.leaderboard).toEqual([]);
    expect(groupByMock).toHaveBeenCalled();
  });
});

describe("GET /api/v1/profiles/[hash]", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();
  });

  it("returns 400 for malformed hash and 404 when agent not found", async () => {
    const { GET } = await import("@/app/api/v1/profiles/[hash]/route");

    const bad = await GET(
      new Request("http://localhost/api/v1/profiles/short") as import("next/server").NextRequest,
      { params: Promise.resolve({ hash: "short" }) }
    );
    expect(bad.status).toBe(400);

    findManyMock.mockResolvedValue([]);
    const missing = await GET(
      new Request(`http://localhost/api/v1/profiles/${AGENT_A}`) as import("next/server").NextRequest,
      { params: Promise.resolve({ hash: AGENT_A }) }
    );
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/v1/receipts/[id]/public-manifest", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetInMemoryRateLimits } = await import("@/lib/rateLimit");
    resetInMemoryRateLimits();
  });

  it("returns 404 when manifest is not found", async () => {
    getReceiptWithHistoryMock.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/v1/receipts/[id]/public-manifest/route"
    );
    const response = await GET(
      new Request("http://localhost/api/v1/receipts/rcpt_missing/public-manifest") as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "rcpt_missing" }) }
    );
    expect(response.status).toBe(404);
  });
});

describe("backward compatibility", () => {
  it("importing portal modules has no side effects on existing gate route", async () => {
    await import("@/lib/public-portal/portal-service");
    const gate = await import("@/app/api/v1/gate/verify/route");
    expect(typeof gate.POST).toBe("function");
  });
});
