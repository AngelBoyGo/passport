#!/bin/bash
set -euo pipefail
DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)

# Fix stake
docker exec "$DB" psql -U passport -d passport -c "UPDATE \"Operator\" SET \"stakeBalanceCents\" = 5000 WHERE email = 'callora@metis.gold';"
echo "STAKE FIXED"

# Get first 5 agent commitments
COMMITMENTS=$(docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT e.\"subjectCommitment\" FROM \"AgentEnrollment\" e WHERE e.status = 'ISSUED' ORDER BY e.\"createdAt\" DESC LIMIT 5;")
echo "AGENTS=$COMMITMENTS"

# Seed evidence for each
i=1
for C in $COMMITMENTS; do
  echo "Seeding agent $i..."
  DIGEST=$(echo -n "seed-data-$i" | sha256sum | cut -d' ' -f1)
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  curl -s -X POST "http://localhost:3000/api/v1/passport/agents/$C/evidence" \
    -H "Authorization: Bearer pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4" \
    -H "Content-Type: application/json" \
    -d "{\"source_type\":\"task_deliverable\",\"payload\":{\"task_id\":\"seed_$i\",\"digest\":\"$DIGEST\",\"observed_at\":\"$NOW\"},\"signature\":\"$(printf '0%.0s' $(seq 1 128))\"}" | head -c 80
  echo ""
  i=$((i+1))
done

echo "=== EVIDENCE SEEDED ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'