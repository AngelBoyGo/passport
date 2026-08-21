import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    webhookSubscription: {
      findMany: vi.fn(),
    },
    agentEvidence: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  evaluateAndDispatchReputationSignals,
} from "@/lib/webhooks/webhook-service";

describe("Real-Time Reputation Webhook Signals (Section 2.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches reputation.degraded when failure rate spikes or tier drops", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    prismaMock.webhookSubscription.findMany.mockResolvedValue([
      {
        id: "sub_1",
        url: "https://gateway.test/reputation-inbox",
        secret: "whsec_test",
        events: ["reputation.degraded"],
        active: true,
      },
    ]);

    await evaluateAndDispatchReputationSignals("op_123", "a".repeat(64), {
      event: "reputation.degraded",
      reason: "SLA_BREACH_THRESHOLD_EXCEEDED",
      failure_rate: 0.25,
      previous_failure_rate: 0.05,
    });

    expect(prismaMock.webhookSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          events: { has: "reputation.degraded" },
        }),
      })
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/reputation-inbox",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Passport-Event": "reputation.degraded",
        }),
      })
    );
  });

  it("dispatches reputation.milestone when milestone reached", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    prismaMock.webhookSubscription.findMany.mockResolvedValue([
      {
        id: "sub_2",
        url: "https://gateway.test/reputation-inbox",
        secret: "whsec_test",
        events: ["reputation.milestone"],
        active: true,
      },
    ]);

    await evaluateAndDispatchReputationSignals("op_123", "a".repeat(64), {
      event: "reputation.milestone",
      milestone: 100,
      evidence_count: 100,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/reputation-inbox",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Passport-Event": "reputation.milestone",
        }),
      })
    );
  });
});
