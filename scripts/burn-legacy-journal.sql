-- Burn unbacked, journal-only legacy ANGEL.
--
-- Some accounts carry an AngelCoin journal balance but NO AgentWallet row, so
-- they are NOT part of canonical supply (Σ AgentWallet.balance). They are inert
-- but a latent drift hazard: any future mutation on such an account would make
-- the wallet and journal diverge. The reserve-backed forward path now prevents
-- NEW journal-only balances (see src/lib/angelcoin/ledger-service.ts), so this
-- one-time reconciliation zeroes the existing ones with a compensating
-- ADJUSTMENT.
--
-- Idempotent: a second run computes availableBalance = 0 for every account and
-- inserts nothing. Read-only until the INSERT; wrapped in one transaction.
--
-- Apply with:
--   docker exec -i passport-db-1 psql -U passport -d passport < burn-legacy-journal.sql

\set ON_ERROR_STOP on

BEGIN;

WITH j AS (
  SELECT a.id,
    COALESCE(SUM(CASE
      WHEN e."entryType" IN ('OPERATOR_GRANT','PEER_GIFT','TASK_PAYMENT','SAFETY_NET_TOPUP','RECOVERY_AWARD') THEN e.amount
      WHEN e."entryType" = 'SPEND'      THEN -e.amount
      WHEN e."entryType" = 'LOCK'       THEN -e.amount
      WHEN e."entryType" = 'UNLOCK'     THEN  e.amount
      WHEN e."entryType" = 'ADJUSTMENT' THEN  e.amount
      ELSE 0 END), 0) AS avail
  FROM "AngelCoinAccount" a
  LEFT JOIN "AngelCoinJournalEntry" e ON e."accountId" = a.id
  WHERE NOT EXISTS (
    SELECT 1 FROM "AgentWallet" w WHERE w."subjectCommitment" = a."subjectCommitment"
  )
  GROUP BY a.id
)
INSERT INTO "AngelCoinJournalEntry" (id, "accountId", "entryType", amount, metadata, "createdAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  j.id,
  'ADJUSTMENT',
  -j.avail,
  '{"source":"reconcile-legacy-burn","note":"zero unbacked journal-only balance"}',
  NOW()
FROM j
WHERE j.avail <> 0;

INSERT INTO "AdminAuditLog" (id, "operatorId", action, "targetId", details, "createdAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  'system-reconcile',
  'legacy_journal_burn',
  'journal-only-unbacked',
  'Burned unbacked journal-only legacy ANGEL by zeroing availableBalance (compensating ADJUSTMENT).',
  NOW();

COMMIT;
