import { describe, it, expect } from "vitest";
import {
  decideFromPolicy,
  normalizePolicyParams,
  DEFAULT_POLICY,
} from "../policy";

const BASE_DP = {
  integrity: { ok: true, issues: [] as string[] },
  rails: { enabled: 3, quarantined: 0 },
  disputes_open: 0,
  cycles_since_research_scan: 0,
};

describe("normalizePolicyParams", () => {
  it("returns defaults for empty input", () => {
    expect(normalizePolicyParams({})).toEqual(DEFAULT_POLICY);
  });

  it("clamps out-of-range values (candidates cannot disable safety thresholds)", () => {
    const p = normalizePolicyParams({
      minIntegrityIssuesForAttestation: 0,
      minOpenDisputesForInvestigate: 999,
      maxCyclesSinceResearchScan: 5,
      minQuarantinedRailsForTick: 1,
    });
    expect(p.minIntegrityIssuesForAttestation).toBe(1); // floor enforced
    expect(p.minOpenDisputesForInvestigate).toBe(20); // ceiling enforced
    expect(p.maxCyclesSinceResearchScan).toBe(6);
  });

  it("snaps non-numeric garbage to defaults", () => {
    const p = normalizePolicyParams({ minIntegrityIssuesForAttestation: "evil" });
    expect(p.minIntegrityIssuesForAttestation).toBe(DEFAULT_POLICY.minIntegrityIssuesForAttestation);
  });
});

describe("decideFromPolicy", () => {
  it("prioritizes attestation on integrity issues", () => {
    const d = decideFromPolicy(
      { ...BASE_DP, integrity: { ok: false, issues: ["x"] }, disputes_open: 5, rails: { enabled: 3, quarantined: 2 } },
      DEFAULT_POLICY
    );
    expect(d.action).toBe("TRIGGER_ATTESTATION");
  });

  it("escalates RUN_TICK when quarantined rails meet the threshold", () => {
    const d = decideFromPolicy(
      { ...BASE_DP, rails: { enabled: 3, quarantined: 1 } },
      DEFAULT_POLICY
    );
    expect(d.action).toBe("RUN_TICK");
  });

  it("escalates INVESTIGATE_DISPUTE at the threshold", () => {
    const d = decideFromPolicy({ ...BASE_DP, disputes_open: 1 }, DEFAULT_POLICY);
    expect(d.action).toBe("INVESTIGATE_DISPUTE");
  });

  it("proposes RUN_RESEARCH_SCAN when staleness exceeds the configured cadence", () => {
    const d = decideFromPolicy(
      { ...BASE_DP, cycles_since_research_scan: 40 },
      DEFAULT_POLICY
    );
    expect(d.action).toBe("RUN_RESEARCH_SCAN");
  });

  it("is NOOP when nothing exceeds thresholds", () => {
    const d = decideFromPolicy(BASE_DP, DEFAULT_POLICY);
    expect(d.action).toBe("NOOP");
  });

  it("threshold changes change decisions — candidate policies are meaningfully different", () => {
    const lax = normalizePolicyParams({ minOpenDisputesForInvestigate: 10 });
    const strict = normalizePolicyParams({ minOpenDisputesForInvestigate: 1 });
    const dp = { ...BASE_DP, disputes_open: 5 };
    expect(decideFromPolicy(dp, lax).action).toBe("NOOP");
    expect(decideFromPolicy(dp, strict).action).toBe("INVESTIGATE_DISPUTE");
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const a = decideFromPolicy(BASE_DP, DEFAULT_POLICY);
    const b = decideFromPolicy(BASE_DP, DEFAULT_POLICY);
    expect(a).toEqual(b);
  });
});