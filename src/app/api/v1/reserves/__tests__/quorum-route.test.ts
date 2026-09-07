import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as postPropose } from "../quorum/propose/route";
import { POST as postSign } from "../quorum/sign/route";
import { GET as getProposals } from "../quorum/proposals/route";
import * as quorum from "@/lib/reserves/threshold-quorum";

describe("Sovereign Quorum API Endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/reserves/quorum/propose", () => {
    it("creates a proposal and returns 201", async () => {
      vi.spyOn(quorum, "createQuorumProposal").mockResolvedValue({
        id: "prop_1",
        proposalId: "PROP-AES-001",
        actionType: "QUARANTINE_VAULT",
        payload: { batchNumber: "BKO-01" },
        payloadDigest: "digest123",
        proposerState: "ML",
        requiredThreshold: 2,
        status: "PENDING",
        expiresAt: new Date("2026-09-09T12:00:00Z"),
        executedAt: null,
        executionResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/propose", {
        method: "POST",
        body: JSON.stringify({
          action_type: "QUARANTINE_VAULT",
          payload: { batchNumber: "BKO-01" },
          proposer_state: "ML",
        }),
      });

      const res = await postPropose(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.proposal.proposal_id).toBe("PROP-AES-001");
      expect(data.proposal.status).toBe("PENDING");
    });

    it("rejects missing fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/propose", {
        method: "POST",
        body: JSON.stringify({
          action_type: "QUARANTINE_VAULT",
        }),
      });

      const res = await postPropose(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/reserves/quorum/sign", () => {
    it("submits state signature and returns 200 with execution status", async () => {
      vi.spyOn(quorum, "submitQuorumSignature").mockResolvedValue({
        proposalId: "PROP-AES-001",
        signerState: "BF",
        totalSignatures: 2,
        requiredThreshold: 2,
        status: "EXECUTED",
        executed: true,
        executionResult: { quarantinedBatchNumber: "BKO-01", executed: true },
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/sign", {
        method: "POST",
        body: JSON.stringify({
          proposal_id: "PROP-AES-001",
          signer_state: "BF",
          signature: "sig_mock",
        }),
      });

      const res = await postSign(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("EXECUTED");
      expect(data.executed).toBe(true);
    });

    it("rejects missing signature fields with 400", async () => {
      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/sign", {
        method: "POST",
        body: JSON.stringify({
          proposal_id: "PROP-AES-001",
        }),
      });

      const res = await postSign(req);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/reserves/quorum/proposals", () => {
    it("returns active proposals and dead-man surveillance metrics", async () => {
      vi.spyOn(quorum, "listQuorumProposals").mockResolvedValue({
        proposals: [
          {
            proposal_id: "PROP-AES-001",
            action_type: "QUARANTINE_VAULT",
            payload: {},
            payload_digest: "digest",
            proposer_state: "ML",
            required_threshold: 2,
            signature_count: 1,
            signatures: [{ signer_state: "ML", signed_at: "2026-09-07T12:00:00Z" }],
            status: "PENDING",
            expires_at: "2026-09-09T12:00:00Z",
            executed_at: null,
            execution_result: null,
          },
        ],
        surveillance: {
          states: [{ countryCode: "ML", status: "ONLINE", lastSeenAt: null, silenceHours: 2 }],
          isAnyStateDark: false,
          deadManAlertTriggered: false,
        },
      });

      const req = new NextRequest("https://passport.metis.gold/api/v1/reserves/quorum/proposals");
      const res = await getProposals(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.proposals).toHaveLength(1);
      expect(data.surveillance.isAnyStateDark).toBe(false);
    });
  });
});
