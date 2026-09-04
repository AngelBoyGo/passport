#!/bin/bash
set -euo pipefail

# Fix the engagement status to PAID
DB=24044c4a5a15_passport_db_1
docker exec $DB psql -U passport -d passport -c "
UPDATE \"Engagement\" SET status = 'PAID', \"paidAt\" = NOW()
WHERE \"taskId\" = 'first_tx_1788460382' AND status = 'DELIVERED';"

# Verify engagement status
docker exec $DB psql -U passport -d passport -c "
SELECT \"taskId\", status, amount, \"paidAt\" FROM \"Engagement\" WHERE \"taskId\" = 'first_tx_1788460382';"

# Verify leaderboard
echo "=== LEADERBOARD ==="
curl -s http://localhost:3000/api/v1/leaderboard | head -c 500

echo ""
echo "=== REVENUE ==="
curl -s http://localhost:3000/api/v1/revenue | grep -o '"protocol_fees":{[^}]*}'

echo ""
echo "=== NETWORK ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'

echo ""
echo "=== TRUST REPORTS ==="
# Get first two agent commitments from leaderboard
curl -s http://localhost:3000/api/v1/network | head -c 0
for C in $(docker exec $DB psql -U passport -d passport -t -A -c "SELECT DISTINCT ae.\"agentIdentityCommitment\" FROM \"AgentEvidence\" ae INNER JOIN \"AgentEnrollment\" e ON e.\"subjectCommitment\" = ae.\"agentIdentityCommitment\" WHERE e.status='ISSUED' LIMIT 2;"); do
  echo "Trust report for ${C:0:16}..."
  curl -s "http://localhost:3000/api/v1/verify/$C" | grep -o '"score":[0-9]*' | head -1
  curl -s "http://localhost:3000/api/v1/verify/$C" | grep -o '"tier":"[^"]*"' | head -1
  curl -s "http://localhost:3000/api/v1/verify/$C" | grep -o '"verified":[a-z]*' | head -1
done