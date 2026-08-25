# Bridge × AngelCoin — Integration Design (Test-First)

**Status:** Design / DRAFT (no code shipped)
**Version:** 0.2
**Owner:** Passport Platform Engineering
**External dependencies:** Stripe · Bridge **Open Issuance** (branded stablecoin issuance, Sept 2025), Stripe **stablecoin payments** (accept USDC), Bridge Settlement/Transfer APIs, optional **Tempo L1** (2026).

---

## 0. Objective & TL;DR

Give AngelCoin **real, verifiable settlement value** by issuing it as a **1:1-reserved branded dollar stablecoin via Bridge Open Issuance**, and lay Passport's existing internal ledgers over it as the **custodial layer**.

- `Operator.credits` and the AngelCoin journal remain the **fast, free, internal** unit of account.
- Bridge becomes the **mint / redeem / custody / compliance** rail for actual money.
- Deposits mint `ANGL` (branded stablecoin) and credit the journal; withdrawals burn and pay out.
- Engagement escrow can **optionally settle on-chain** to a worker's wallet.
- Agents (non-human) hold **operator-controlled wallets**, always attributable to a verified identity.

**Design method:** test-first. A feature is *done* only when its acceptance tests are green in CI. The test bank in §2 is the contract; implementation must not advance a component whose tests fail.

---

## 1. Architecture (custodial-first)

```
 [ Operator (KYC'd) ]       [ AI Agent (commitment) ]      [ Gateway / 3rd party ]
         │                          │                              │
  Operator.credits wallet      AngelCoinAccount journal        (reads/attest)
  (stripe fiat|USDC topup)     (commitment-scoped credits)
         │                          │
         │   ┌──────────────────────┴──────────────────────┐
         │   │              PASSPORT (issuer)              │
         │   │   • custodial ledger (Postgres)             │
         │   │   • mint / burn journal events              │
         │   │   • optional on-chain escrow settle         │
         └───┴──────────────┬──────────────────────────────┘
                            │ Bridge REST + webhooks (HMAC)
              ┌─────────────▼─────────────┐
              │     BRIDGE / STRIPE       │
              │  Open Issuance: Issuer     │
              │  reserve mgmt, KYB/KYC/AML │
              │  transfers, 1:1 swaps     │
              └───────────────────────────┘
```

**Global invariant (asserted by a root test):**
At every moment, the sum of on-ledger AngelCoin credits ≤ the verified minted backing on Bridge.
Minting is allowed only after a confirmed deposit; burning only after a confirmed withdrawal.

---

## 2. Test-first acceptance bank

Each row is a test that must pass before the associated implementation is considered delivered. Implementation approach follows in §3.

### 2.A Bridge adapter — `src/lib/bridge/`
| ID | Acceptance test | Note |
|---|---|---|
| A1 | `listAccounts(sandbox)` returns `Array<{ id, custodialStatus }>` from a mocked Bridge client | thin typed wrapper; no retries yet |
| A2 | `createDeposit(ref)` persists a `PendingExternalTransfer` with `metadata { subjectCommitment, operatorId, intent }` | full traceability |
| A3 | `getTransferStatus(ref)` resolves `pending\|confirmed\|failed` and mirrors into `ExternalSettlement` | poll / webhook fallback |
| A4 | `verifyBridgeWebhook(req)` accepts a **valid** HMAC and rejects an invalid one before any DB mutation | mirrors existing `computeWebhookSignature` |
| A5 | `applyDeposit(idempotencyKey)` mints **exactly once** even if the webhook is retried | unique `(bridge_transfer_id, rail)` |
| A6 | `burnAndPayout(ref, amount)` is idempotent and refuses if backing reserve is insufficient | arcidx reserve floor |

### 2.B Deposit / on-ramp
| ID | Acceptance test | |
|---|---|---|
| B1 | `POST /api/v1/account/topup` with `method:"stablecoin"` creates a Stripe Checkout Session (USDC) and returns `clientSecret` | secure payment link |
| B2 | Stripe webhook `checkout.session.completed` (orderKind=topup) increments `Operator.credits` by the fiat micro-equivalent and records an `OperatorLedger` row | |
| B3 | Bridge webhook `deposit.confirmed` → journal event `OPERATOR_GRANT` on target commitment, `metadata.bridgeRef` set | |
| B4 | The same webhook redelivered does **not** double-credit (unique `(rail, reference)` insert-or-skip) | idempotency covered by `ExternalSettlement` |

### 2.C Wallets — `BridgeWallet` model
| ID | Acceptance | |
|---|---|---|
| C1 | `ensureOperatorWallet(operatorId)` returns the same address for the operator (idempotent) | |
| C2 | `ensureAgentWallet(commitment)` fails unless the commitment is tied to a KYC’d operator | agent ≠ independent identity |
| C3 | A withdrawal to an external address requires an authorized human owner | gate first |
| C4 | Wallet currency + chain are recorded (`USD`, chain nullable until first withdrawal) | |

### 2.D Escrow settlement — `src/lib/engagement`
| ID | Acceptance | |
|---|---|---|
| D1 | `releaseEscrowToWorker` accepts `settleOnChain:boolean`; when `true`, an ANGL transfer to the worker wallet is enqueued after the atomic internal `UNLOCK + SPEND + TASK_PAYMENT` | |
| D2 | On-chain try executed exactly once; duplicate enqueue refused via unique `ExternalSettlement(rail=bridge_transfer, reference=tx)` | |
| D3 | A worker external withdrawal burns ANGL and produces a Passport receipt linking the receipt to the on-chain tx hash | proof-of-payout |
| D4 | Internal (custodial) settle remains instantaneous and free; on-chain is asynchronous / non-blocking | |

### 2.E Withdraw & settlement rails — `agent-pay` / metering
| ID | Acceptance | |
|---|---|---|
| E1 | `POST /api/v1/agent-pay/withdraw` verifies the calling signature + wallet; burns ANGL from the journal and queues a Bridge payout | |
| E2 | Existing `settleExternalRailPayment` is extended for `rail:"bridge_issuance"` and re-verifies the rail HMAC | reuses idempotent `ExternalSettlement` |

### 2.F Compliance & admin
| ID | Acceptance | |
|---|---|---|
| F1 | Withdrawal destination screened via Bridge/consides; flagged addresses rejected with `reason` | |
| F2 | Withdrawal refused (403) when the operator record lacks `kycStatus: approved` | |
| F3 | Audit journal append-only; each mint/burn stores `kycStatus`, `geofence`, and `bridgeRef` | |
| F4 | No yield is passed to ANGL holders (backing reserve return accrues only to the operator/company) | asserted via policy + tests |

---

## 3. Implementation blueprint

### 3.1 New module `src/lib/bridge/`
- `client.ts` — typed REST wrapper over Bridge; throws on non-2xx; configurable retry/backoff.
- `types.ts` — `DepositConfirmation`, `WithdrawalRequest`, `WalletAuthorization`.
- `verify.ts` — HMAC signature verification (mirror the `webhook-service.ts` constant-time pattern; never log secrets).

### 3.2 Prisma schema additions
```prisma
model BridgeWallet {
  id                String   @id @default(cuid())
  operatorId        String   @unique
  subjectCommitment String?
  bridgeExternalId  String?
  chainAddress      String?
  curated           Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([operatorId])
}

model OperatorLedger {
  id         String   @id @default(cuid())
  operatorId String
  deltaMicros Int
  kind       String   // 'fiat_topup' | 'stablecoin_topup' | 'refund'
  metadata   String?
  createdAt  DateTime @default(now())
  @@index([operatorId, createdAt])
}
```
Extend the existing `ExternalSettlement` `rail` enum with `"bridge_issuance"` and `"bridge_transfer"`. `AgentCoinJournalEntry.metadata` carries `{ bridgeRef, rail, txHash? }`.

### 3.3 Deposit flow (custodial first)
1. `POST /api/v1/account/topup` → Stripe Checkout Session with `payment_method_types:['usdc']`, amount 1 USD, `metadata.orderKind='topup'`, `customer_id` = operator.
2. Stripe `checkout.session.completed` → existent `stripe/webhook` path credits `Operator.credits` + writes `OperatorLedgerEntry`.
3. Optional on-chain: same amount minted as ANGL and journal `OPERATOR_GRANT` on the commitment, `bridgeRef` in metadata — only after Bridge `deposit.confirmed`.

### 3.4 Escrow on-chain
In `engagement-service.acceptEngagement`:
```
await enqueueWorkerTransfer(workerWallet, amount)   // if settleOnChain
await releaseEscrowToWorker(...)                     // internal, always
```
Internal settle stays instantaneous and free; on-chain is best-effort, enqueued, and non-blocking.

### 3.5 Withdrawal / payouts
New `POST /api/v1/agent-pay/withdraw` (Bearer + agent Ed25519 proof): burn credits → queue Bridge payout → record txHash receipt.

---

## 4. Environment / config
| Var | Description |
|---|---|
| `BRIDGE_CLIENT_ID` / `BRIDGE_CLIENT_SECRET` | Bridge platform/issuance credentials |
| `BRIDGE_ENV` | `sandbox` \| `live` |
| `BRIDGE_WEBHOOK_SECRET` | HMAC for Bridge webhooks |
| `STRIPE_USDC_PRICE` | unit price (1 USD) for stablecoin Checkout sessions |
| `ANGL_RESERVE_POLICY` | `1:1` |
| `ANGL_WITHDRAW_KYC_ONLY` | `true` in live, `false` in sandbox |

**Money rules:** all amounts integer micro-/cents only (no floats) — matching `Operator.credits`/journal `amount: Int`. Exchange `USD ↔ ANGL` fixed 1:1 (Bridge 1:1 swap network). No compounding.

---

## 5. Build order (test-first, green at each step)
1. **A1–A6** — Bridge client + HMAC + idempotent deposit (Bridge mocked).
2. **B1–B4** — stablecoin topup checkout + webhook credit tests.
3. **C1–C3** — wallet mapping tests.
4. **D1–D4** — optional on-chain escrow settlement.
5. **E1–E2** — withdraw + `ExternalSettlement` bridge rail.
6. **F1–F4** — compliance gates.

Each step ships green; no feature advances with failing acceptance tests.

---

## 6. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Regulatory: issuer-of-record is Passport (Bridge runs infra) | Bridge does licensing/reserves; complete KYB; ToS frames ANGL as “value receipt” (not investment) |
| Agents cannot KYC | wallets map to a KYC’d operator; agents are subordinate records |
| Yield could imply a security | second-class float interest never passes to holders; it is company revenue (equity/LLC stakes, not token yield) |
| Webhook replays / chargebacks | idempotent `ExternalSettlement` unique + reconciliation job |
| Tempo L1 immaturity | chain-agnostic first (Bridge Ether/Sol/Poly); Tempo behind a feature flag |

---

## 7. First concrete step (recommended)

**Ship the onboarding test bank A + B with mocked Bridge**, and in parallel start **Bridge KYB** (long lead time). Phase B (Stripe USDC topup ✓ for `Operator.credits`) is the smallest motion that gives AngelCoin real settlement value today, and it exercises the stripes of the same `ExternalSettlement` idempotency we’ll rely on for Bridge later.

_Next doc:_ add a short `docs/bridge-angelcoin-README.md` with a "do this with the API" quickstart once the first wave of tests is green.