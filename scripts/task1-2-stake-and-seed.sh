#!/bin/bash
set -euo pipefail

DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)

echo "=== TASK 1: FIX OPERATOR STAKE ==="
docker exec "$DB" psql -U passport -d passport -c "
UPDATE \"Operator\" SET \"stakeBalanceCents\" = 5000
WHERE email = 'callora@metis.gold';
"
echo "Stake fixed. Verifying:"
docker exec "$DB" psql -U passport -d passport -c "
SELECT email, credits, \"stakeBalanceCents\", tier FROM \"Operator\" WHERE email = 'callora@metis.gold';
"

echo "=== TASK 2: SEED DOMAIN TENANCY (post evidence per agent) ==="
# Get the first 5 agent commitments
AGENTS=$(docker exec "$DB" psql -U passport -d passport -t -A -c "
SELECT \"subjectCommitment\" FROM \"AgentEnrollment\"
WHERE status = 'ISSUED'
ORDER BY \"createdAt\" DESC
LIMIT 5;
")

echo "Agents: $AGENTS"

# Get the ISSUER key hash to find the API key
# We'll use the Callora ISSUER key directly
ISSUER="pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4"

i=1
for COMMITMENT in $AGENTS; do
  echo "Seeding evidence for agent $i: ${COMMITMENT:0:16}..."
  curl -s -X POST "http://localhost:3000/api/v1/passport/agents/$COMMITMENT/evidence" \
    -H "Authorization: Bearer $ISSUER" \
    -H "Content-Type: application/json" \
    -d "{
      \"source_type\": \"task_deliverable\",
      \"payload\": {
        \"task_id\": \"seed_tenant_${i}\",
        \"digest\": \"$(echo -n "seed-data-${i}" | sha256sum | cut -d' ' -f1)\",
        \"observed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\"
      },
      \"signature\": \"$(printf '0%.0s' {1..128})\"
    }" | head -c 100
  echo ""
  i=$((i+1))
done

echo ""
echo "=== SEEDING COMPLETE ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'