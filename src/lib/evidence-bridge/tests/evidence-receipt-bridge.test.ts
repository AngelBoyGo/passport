import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorTranche } from "@prisma/client";

const {
  issueReceiptMock,
  finalizeReceiptMock,
  findUniqueLinkMock,
  createLinkMock,
  countCorrectionsMock,
  findOperatorMock,
  applySlashingMock,
  transactionMock,
} = vi.hoisted(() => ({
  issueReceiptMock: vi.fn(),
  finalizeReceiptMock: vi.fn(),
  findUniqueLinkMock: vi.fn(),
  createLinkMock: vi.fn(),
  countCorrectionsMock: vi.fn(),
  findOperatorMock: vi.fn(),
  applySlashingMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/receipt-service", () => ({
  issueReceipt: issueReceiptMock,
  finalizeReceipt: finalizeReceiptMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    evidenceReceiptLink: {
      findUnique: findUniqueLinkMock,
      create: createLinkMock,
    },
    agentEvidence: {
      count: countCorrectionsMock,
    },
    operator: {
      findUnique: findOperatorMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/escrow/slashing", () => ({
  applySlashingInTransaction: applySlashingMock,
}));

import { validateFinalizeInput } from "@/lib/receipt/finalize";
import {
  mapEvidenceToReceiptPlan,
  bridgeEvidenceToReceipt,
  type EvidenceBridgeInput,
} from "@/lib/evidence-bridge/evidence-receipt-bridge";

const AGENT_COMMITMENT = "b".repeat(64);
const EVENT_HASH = "c".repeat(64);
const MINTER_ID = "op_public_evidence_minter";
const ENFORCEMENT_OP_ID = "op_real_enforcement";

function bridgeEvidence(
  overrides: Partial<EvidenceBridgeInput> = {}
): EvidenceBridgeInput {
  return {
    id: "ev_db_1",
    sourceType: "github_push_webhook",
    agentIdentityCommitment: AGENT_COMMITMENT,
    eventCommitmentHash: EVENT_HASH,
    normalizedEventType: "AGENT_ARTIFACT_CREATED",
    rawErrorClassification: null,
    validationSignalPresent: false,
    observedAt: new Date("2026-06-15T12:00:00Z"),
    ...overrides,
  };
}

const RAW_LEAKAGE_TOKENS = [
  "acme/secret-repo",
  "refs/heads/main",
  "https://github.com/acme/secret-repo",
  "fix the auth bug in login.ts",
];

function assertNoRawLeakage(value: unknown) {
  const json = JSON.stringify(value);
  for (const token of RAW_LEAKAGE_TOKENS) {
    expect(json).not.toContain(token);
  }
}

describe("mapEvidenceToReceiptPlan", () => {
  it("maps subject commitment and event hash to receipt fields", () => {
    const plan = mapEvidenceToReceiptPlan(bridgeEvidence());
    expect(plan.agent_id).toBe(AGENT_COMMITMENT);
    expect(plan.input_digest).toBe(EVENT_HASH);
    expect(plan.authority_scope).toBe("ingest.public-evidence.github_push_webhook");
    expect(plan.receipt_type).toBe("custody");
    expect(plan.finalize.status).toBe("success");
    expect(plan.finalize.error_tranche).toBe(ErrorTranche.NONE);
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });

  it("maps failures to failure_tombstone with hashed terminal_reason and NONE tranche", () => {
    const plan = mapEvidenceToReceiptPlan(
      bridgeEvidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
      })
    );
    expect(plan.finalize.status).toBe("failure_tombstone");
    expect(plan.finalize.error_tranche).toBe(ErrorTranche.NONE);
    expect(plan.finalize.terminal_reason).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.finalize.terminal_reason).not.toContain("LOGIC_DETECTION");
    expect(validateFinalizeInput(plan.finalize).valid).toBe(true);
  });
});

describe("bridgeEvidenceToReceipt", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVIDENCE_BRIDGE_OPERATOR_ID = MINTER_ID;
    delete process.env.EVIDENCE_ENFORCEMENT_ENABLED;

    findUniqueLinkMock.mockResolvedValue(null);
    countCorrectionsMock.mockResolvedValue(0);
    findOperatorMock.mockResolvedValue({
      id: MINTER_ID,
      stripeCustomerId: "cus_public_minter",
    });

    issueReceiptMock.mockResolvedValue({
      signed: { receipt_id: "rcpt_pending_1" },
      row: { contentHash: "pending_hash" },
    });
    finalizeReceiptMock.mockResolvedValue({
      signed: { receipt_id: "rcpt_final_1" },
      row: { contentHash: "final_content_hash" },
    });

    createLinkMock.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "link_1",
      ...args.data,
    }));

    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({})
    );
    applySlashingMock.mockResolvedValue({
      deductedCents: 2500,
      fullPenaltyCents: 2500,
      insolvent: false,
      ledgerEntryId: "slash_ledger_1",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("mints a custody receipt via system minter with deterministic fields", async () => {
    const result = await bridgeEvidenceToReceipt(bridgeEvidence());

    expect(result).not.toBeNull();
    expect(issueReceiptMock).toHaveBeenCalledWith(
      MINTER_ID,
      expect.objectContaining({
        agent_id: AGENT_COMMITMENT,
        input_digest: EVENT_HASH,
        receipt_type: "custody",
        authority_scope: "ingest.public-evidence.github_push_webhook",
      })
    );
    expect(finalizeReceiptMock).toHaveBeenCalledWith(
      MINTER_ID,
      "rcpt_pending_1",
      expect.objectContaining({
        status: "success",
        error_tranche: ErrorTranche.NONE,
      })
    );
    expect(createLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventCommitmentHash: EVENT_HASH,
          receiptId: "rcpt_final_1",
          receiptCommitmentHash: "final_content_hash",
          attributionMode: "SYSTEM_ATTESTED_PUBLIC_EVIDENCE",
          liabilityEventId: null,
        }),
      })
    );
    assertNoRawLeakage(result);
  });

  it("returns existing link on duplicate eventCommitmentHash without second mint", async () => {
    const existing = {
      id: "link_existing",
      eventCommitmentHash: EVENT_HASH,
      receiptId: "rcpt_existing",
      receiptCommitmentHash: "existing_hash",
      enforcementState: "OBSERVATIONAL_ONLY",
      linkageType: "OBSERVATION",
      liabilityEventId: null,
    };
    findUniqueLinkMock.mockResolvedValue(existing);

    const result = await bridgeEvidenceToReceipt(bridgeEvidence());
    expect(result).toEqual(existing);
    expect(issueReceiptMock).not.toHaveBeenCalled();
    expect(finalizeReceiptMock).not.toHaveBeenCalled();
    expect(createLinkMock).not.toHaveBeenCalled();
  });

  it("returns null when EVIDENCE_BRIDGE_OPERATOR_ID is unset", async () => {
    delete process.env.EVIDENCE_BRIDGE_OPERATOR_ID;
    const result = await bridgeEvidenceToReceipt(bridgeEvidence());
    expect(result).toBeNull();
    expect(issueReceiptMock).not.toHaveBeenCalled();
  });

  it("keeps liabilityEventId null when enforcement flag is OFF", async () => {
    const result = await bridgeEvidenceToReceipt(
      bridgeEvidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: true,
      }),
      { enforcementOperatorId: ENFORCEMENT_OP_ID }
    );
    expect(result!.liabilityEventId).toBeNull();
    expect(applySlashingMock).not.toHaveBeenCalled();
  });

  it("attaches liability when flag ON, eligible, and real operator supplied", async () => {
    process.env.EVIDENCE_ENFORCEMENT_ENABLED = "true";

    const result = await bridgeEvidenceToReceipt(
      bridgeEvidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: true,
      }),
      { enforcementOperatorId: ENFORCEMENT_OP_ID }
    );

    expect(result!.enforcementState).toBe("ENFORCEMENT_ELIGIBLE");
    expect(result!.liabilityEventId).toBe("slash_ledger_1");
    expect(applySlashingMock).toHaveBeenCalledWith(
      expect.anything(),
      ENFORCEMENT_OP_ID,
      "rcpt_final_1",
      ErrorTranche.LOGIC_DETECTION
    );
    expect(applySlashingMock).not.toHaveBeenCalledWith(
      expect.anything(),
      MINTER_ID,
      expect.anything(),
      expect.anything()
    );
  });

  it("never slashes the system minter even when enforcement is enabled", async () => {
    process.env.EVIDENCE_ENFORCEMENT_ENABLED = "true";

    await bridgeEvidenceToReceipt(
      bridgeEvidence({
        normalizedEventType: "EXECUTION_FAILURE_OBSERVED",
        rawErrorClassification: "LOGIC_DETECTION",
        validationSignalPresent: true,
      }),
      { enforcementOperatorId: MINTER_ID }
    );

    expect(applySlashingMock).not.toHaveBeenCalled();
    expect(createLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ liabilityEventId: null }),
      })
    );
  });
});
