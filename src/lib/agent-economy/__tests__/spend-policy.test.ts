import { describe, it, expect } from "vitest";
import {
  evaluateSpend,
  normalizePolicy,
  DEFAULT_SPEND_POLICY,
  dayStartMs,
  weekStartMs,
  type SpendPolicy,
} from "../spend-policy";

const AGENT = "a".repeat(64);
const CP = "b".repeat(64);

function policy(overrides: Partial<SpendPolicy> = {}): SpendPolicy {
  return { agentCommitment: AGENT, ...DEFAULT_SPEND_POLICY, ...overrides };
}

const base = { spentToday: 0, spentThisWeek: 0 };

describe("autonomous spend policy (pure)", () => {
  it("default policy permits any positive spend", () => {
    const d = evaluateSpend({ policy: policy(), amount: 12345, ...base });
    expect(d.allowed).toBe(true);
  });

  it("denies a non-positive amount", () => {
    expect(evaluateSpend({ policy: policy(), amount: 0, ...base }).code).toBe("invalid_amount");
    expect(evaluateSpend({ policy: policy(), amount: -5, ...base }).code).toBe("invalid_amount");
  });

  it("denies when disabled", () => {
    const d = evaluateSpend({ policy: policy({ enabled: false }), amount: 1, ...base });
    expect(d).toMatchObject({ allowed: false, code: "policy_disabled" });
  });

  it("enforces the per-transaction cap", () => {
    const p = policy({ perTxMaxAngel: 50 });
    expect(evaluateSpend({ policy: p, amount: 50, ...base }).allowed).toBe(true);
    expect(evaluateSpend({ policy: p, amount: 51, ...base })).toMatchObject({
      allowed: false,
      code: "per_tx_exceeded",
    });
  });

  it("enforces the rolling daily cap", () => {
    const p = policy({ dailyMaxAngel: 100 });
    expect(evaluateSpend({ policy: p, amount: 40, spentToday: 60, spentThisWeek: 60 }).allowed).toBe(
      true
    );
    const d = evaluateSpend({ policy: p, amount: 41, spentToday: 60, spentThisWeek: 60 });
    expect(d).toMatchObject({ allowed: false, code: "daily_exceeded" });
    expect(d.remainingDaily).toBe(40);
  });

  it("enforces the rolling weekly cap", () => {
    const p = policy({ weeklyMaxAngel: 500 });
    const d = evaluateSpend({ policy: p, amount: 100, spentToday: 0, spentThisWeek: 450 });
    expect(d).toMatchObject({ allowed: false, code: "weekly_exceeded" });
    expect(d.remainingWeekly).toBe(50);
  });

  it("enforces a counterparty allowlist", () => {
    const p = policy({ counterpartyAllowlist: [CP] });
    expect(evaluateSpend({ policy: p, amount: 5, counterparty: CP, ...base }).allowed).toBe(true);
    expect(
      evaluateSpend({ policy: p, amount: 5, counterparty: "c".repeat(64), ...base })
    ).toMatchObject({ allowed: false, code: "counterparty_not_allowed" });
    expect(evaluateSpend({ policy: p, amount: 5, counterparty: null, ...base })).toMatchObject({
      allowed: false,
      code: "counterparty_not_allowed",
    });
  });

  it("enforces a domain allowlist", () => {
    const p = policy({ domainAllowlist: ["CODE_GENERATION"] });
    expect(evaluateSpend({ policy: p, amount: 5, domain: "CODE_GENERATION", ...base }).allowed).toBe(
      true
    );
    expect(evaluateSpend({ policy: p, amount: 5, domain: "MARKETING", ...base })).toMatchObject({
      allowed: false,
      code: "domain_not_allowed",
    });
  });

  it("normalizePolicy coerces garbage into safe non-negative numbers and string arrays", () => {
    const p = normalizePolicy({
      agentCommitment: AGENT,
      perTxMaxAngel: -5 as unknown as number,
      dailyMaxAngel: "100" as unknown as number,
      counterpartyAllowlist: ["x", "", null, 3] as unknown as string[],
      enabled: undefined as unknown as boolean,
    });
    expect(p.perTxMaxAngel).toBe(0);
    expect(p.dailyMaxAngel).toBe(100);
    expect(p.counterpartyAllowlist).toEqual(["x"]);
    expect(p.enabled).toBe(true);
  });

  it("computes UTC day/week window starts", () => {
    const now = new Date("2026-06-17T15:30:00.000Z"); // Wednesday
    const ds = new Date(dayStartMs(now));
    expect(ds.toISOString()).toBe("2026-06-17T00:00:00.000Z");
    const ws = new Date(weekStartMs(now));
    expect(ws.toISOString()).toBe("2026-06-15T00:00:00.000Z"); // Monday
  });
});
