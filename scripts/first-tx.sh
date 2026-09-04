#!/bin/bash
set -euo pipefail

DB=$(docker ps --format "{{.Names}} {{.Image}}" | grep "postgres" | awk '{print $1}')
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S")

# Create AngelCoinAccounts for all enrolled agents
docker exec "$DB" psql -U passport -d passport -c "
INSERT INTO \"AngelCoinAccount\" (id,\"subjectCommitment\",\"creditState\",\"accessTier\",\"createdAt\",\"updatedAt\")
SELECT gen_random_uuid()::text, e.\"subjectCommitment\", 'ACTIVE', 'FULL', NOW(), NOW()
FROM \"AgentEnrollment\" e WHERE e.status='ISSUED'
ON CONFLICT (\"subjectCommitment\") DO NOTHING;"

# Grant 100 ANGEL to all accounts that don't have a grant yet
docker exec "$DB" psql -U passport -d passport -c "
INSERT INTO \"AngelCoinJournalEntry\" (id,\"accountId\",\"entryType\",amount,\"createdAt\")
SELECT gen_random_uuid()::text, ac.id, 'OPERATOR_GRANT', 100, NOW()
FROM \"AngelCoinAccount\" ac
WHERE ac.\"subjectCommitment\" SIMILAR TO '[0-9a-f]{64}'
AND NOT EXISTS (SELECT 1 FROM \"AngelCoinJournalEntry\" je WHERE je.\"accountId\" = ac.id AND je.\"entryType\" = 'OPERATOR_GRANT');"

# Get 2 agents with evidence
HIRER=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
SELECT DISTINCT ae.\"agentIdentityCommitment\" FROM \"AgentEvidence\" ae
INNER JOIN \"AgentEnrollment\" e ON e.\"subjectCommitment\" = ae.\"agentIdentityCommitment\"
WHERE e.status='ISSUED' LIMIT 1 OFFSET 0;")

WORKER=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
SELECT DISTINCT ae.\"agentIdentityCommitment\" FROM \"AgentEvidence\" ae
INNER JOIN \"AgentEnrollment\" e ON e.\"subjectCommitment\" = ae.\"agentIdentityCommitment\"
WHERE e.status='ISSUED' LIMIT 1 OFFSET 1;")

echo "HIRER=$HIRER"
echo "WORKER=$WORKER"
echo "=== GRANTS DONE ==="

# Create engagement
TASK_ID="first_tx_$(date +%s)"
curl -s -X POST "http://localhost:3000/api/v1/passport/engagements" \
  -H "Authorization: Bearer pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"hirer_commitment\":\"$HIRER\",\"worker_commitment\":\"$WORKER\",\"amount\":5}"
echo ""

# Worker delivers
DIGEST=$(echo -n "Task done" | sha256sum | cut -d' ' -f1)
NOW2=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
curl -s -X POST "http://localhost:3000/api/v1/passport/agents/$WORKER/evidence" \
  -H "Authorization: Bearer pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4" \
  -H "Content-Type: application/json" \
  -d "{\"source_type\":\"task_deliverable\",\"payload\":{\"task_id\":\"$TASK_ID\",\"digest\":\"$DIGEST\",\"observed_at\":\"$NOW2\"},\"signature\":\"$(printf '0%.0s' $(seq 1 128))\"}"
echo ""

# Accept
curl -s -X POST "http://localhost:3000/api/v1/passport/engagements/$TASK_ID/accept" \
  -H "Authorization: Bearer pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4"
echo ""

echo "=== VERIFY ==="
curl -s http://localhost:3000/api/v1/revenue | grep -o '"total":[0-9]*' | head -1
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300