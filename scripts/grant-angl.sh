#!/bin/bash
set -euo pipefail

# SAFETY: this script mints journal-only ANGEL (OPERATOR_GRANT with NO reserve
# and NO AgentWallet credit). It is a DEV fixture only. It refuses production
# and requires an explicit opt-in so it can never contaminate a real economy.
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Refusing: NODE_ENV=production (dev fixture)." >&2
  exit 1
fi
if [ "${ALLOW_DEV_GRANT:-}" != "1" ]; then
  echo "Refusing: this mints unbacked ANGEL. Set ALLOW_DEV_GRANT=1 to proceed." >&2
  exit 1
fi

DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)

# Get first 2 agent commitments (hirer and worker)
HIRER=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
SELECT e.\"subjectCommitment\" FROM \"AgentEnrollment\" e
WHERE e.status = 'ISSUED' AND EXISTS (
  SELECT 1 FROM \"AgentEvidence\" ae WHERE ae.\"agentIdentityCommitment\" = e.\"subjectCommitment\"
)
ORDER BY e.\"createdAt\" DESC LIMIT 1 OFFSET 0;
")

WORKER=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
SELECT e.\"subjectCommitment\" FROM \"AgentEnrollment\" e
WHERE e.status = 'ISSUED' AND EXISTS (
  SELECT 1 FROM \"AgentEvidence\" ae WHERE ae.\"agentIdentityCommitment\" = e.\"subjectCommitment\"
)
ORDER BY e.\"createdAt\" DESC LIMIT 1 OFFSET 1;
")

echo "HIRER=$HIRER"
echo "WORKER=$WORKER"

if [ -z "$HIRER" ] || [ -z "$WORKER" ]; then
  echo "ERROR: Need at least 2 agents with evidence"
  exit 1
fi

# Create AngelCoinAccounts and grant 100 ANGEL each
for C in $HIRER $WORKER; do
  ACCT_ID=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
  docker exec "$DB" psql -U passport -d passport -c "
  INSERT INTO \"AngelCoinAccount\" (id, \"subjectCommitment\", \"creditState\", \"accessTier\")
  VALUES ('$ACCT_ID', '$C', 'ACTIVE', 'FULL')
  ON CONFLICT (\"subjectCommitment\") DO NOTHING;
  "

  # Get or find the account ID
  ACCOUNT=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
  SELECT id FROM \"AngelCoinAccount\" WHERE \"subjectCommitment\" = '$C' LIMIT 1;
  ")

  # Insert a grant journal entry
  docker exec "$DB" psql -U passport -d passport -c "
  INSERT INTO \"AngelCoinJournalEntry\" (id, \"accountId\", \"entryType\", amount, metadata, \"createdAt\")
  VALUES (
    '$(cat /proc/sys/kernel/random/uuid | tr -d '-')',
    '$ACCOUNT',
    'OPERATOR_GRANT',
    100,
    '{\"source\":\"seed_grant\"}',
    NOW()
  );
  "
  echo "Granted 100 ANGEL to ${C:0:16}..."
done

echo "=== GRANTS COMPLETE ==="
echo "HIRER=$HIRER"
echo "WORKER=$WORKER"