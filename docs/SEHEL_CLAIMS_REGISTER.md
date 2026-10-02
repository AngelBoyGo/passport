# Sehel/Sahel — Claims-to-Evidence Register

**Purpose (failure hypotheses F-016, F-057, F-060).** The Sahel resource-haven
project is the declared reserve anchor for AngelCoin. Before any public or
partner-facing claim, every assertion must map to a verifiable artifact. This
register is the single source of truth for that mapping. **An unbacked claim is
a liability, not marketing.**

**Status legend:** ✅ documented · 🟡 partial · ❌ none · ❓ unknown

---

## 1. Reserve & custody

| # | Claim | Artifact required | Status | Owner | Notes |
|---|---|---|---|---|---|
| R1 | A named custodian holds the physical reserve | Custodian name + agreement | ❓ | founder | None in repo |
| R2 | Reserve is insured | Insurance certificate | ❓ | founder | None in repo |
| R3 | Reserve ≥ circulating ANGEL (1:1) | Independent attestation + reconciliation | ❌ | founder | `economy-health.reserve_usd` is derived from **ledger top-up entries**, not a held asset (`src/lib/agent-economy/economy-health.ts:127`, `solvency-invariant.test.ts`) |
| R4 | Reserves segregated from operator assets | Custody structure doc | ❓ | founder | — |
| R5 | Independent audit cadence | Audit report | ❌ | founder | — |

**Verified today:** no custodian, no insurance, no attestation, no segregation
document are present in either repository. `reserve_usd` is bookkeeping.

## 2. Partnership & governance

| # | Claim | Artifact required | Status | Owner |
|---|---|---|---|---|
| P1 | A named partner exists | Signed partner agreement | ❓ | founder |
| P2 | Ownership/control of the reserve is defined | Governing agreement | ❌ | founder |
| P3 | Conflict-of-interest policy if interests diverge | Policy doc | ❌ | founder |
| P4 | Bilateral settlement path (if sanctions block Western rails) | Signed pact | ❌ | founder |

## 3. Operational & compliance

| # | Claim | Artifact required | Status | Owner |
|---|---|---|---|---|
| O1 | Assay integrity (multi-sensor / blind dual assay) | Design + test evidence | 🟡 | eng — single-sensor path in code; `reserves/artisanal-sourcing.ts` |
| O2 | OECD/LBMA due diligence met | Compliance memo | ❌ | legal |
| O3 | Sanctions/AML screening | Screening process | ❌ | legal |
| O4 | Logistics/customs contingencies | Ops plan | ❌ | ops |
| O5 | Domestic liquidity path (miners can spend ANGEL) | Merchant/ramp plan | ❌ | ops |

## 4. Known-false or unproven public claims (must be corrected now)

| # | Where | Claim | Current truth | Action |
|---|---|---|---|---|
| C1 | `lib/angelcoin/monetary.ts` header | "100% reserve-backed", `reserveRatio: 1.0` | No held reserve verified | **Reframe** to "aspirational / design-stage" or remove |
| C2 | marketing `economy-features` | "backed 1:1 by real reserves" | Unverified | **Reframe** |
| C3 | `docs/premortem/sahel-...` | presented as plan | fine (it's a premortem) | keep labelled "design stage" |

---

## Gate (F-016 / F-057)

- **Pivot trigger:** if R1/R3/R5 or P1/P2 are ❌ after a reasonable check window
  → **remove all reserve/backing claims** from public surfaces and stop
  presenting Sehel as an operational reserve.
- **Proceed trigger:** R1+R3+R5 ✅ (named custodian + attestation + audit) and
  P1+P2 ✅ (signed agreement defining control) → reserve claims may stand.

## Non-deferrable (even in dev mode)

Do **not** publish "1:1 backed" or "verified reserve" in any artifact while
C1/C2 are unverified. This is a claims-integrity issue, independent of
production hardening.
