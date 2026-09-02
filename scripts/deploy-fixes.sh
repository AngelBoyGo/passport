#!/bin/bash
set -euo pipefail

cd /opt/passport

# Find the DB container dynamically
DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)
echo "DB Container: $DB"

# Push schema (syncs all new tables/columns)
echo "=== PUSHING SCHEMA ==="
docker run --rm --network passport_default \
  -v /opt/passport/prisma:/app/prisma \
  -w /app \
  -e DATABASE_URL="postgresql://passport:passport@db:5432/passport" \
  node:20-alpine \
  sh -c 'npm install prisma@6.19.0 --no-save 2>/dev/null && npx prisma db push --accept-data-loss --skip-generate'

# Fix existing agent IDs (display_name → commitment)
echo "=== FIXING AGENT IDS ==="
docker exec "$DB" psql -U passport -d passport -c "
UPDATE \"Agent\" a
SET \"agentId\" = e.\"subjectCommitment\"
FROM \"AgentEnrollment\" e
WHERE e.\"subjectCommitment\" != a.\"agentId\"
AND a.\"agentId\" NOT SIMILAR TO '[0-9a-f]{64}';
"
echo "Agent IDs fixed: $(docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT COUNT(*) FROM \"Agent\" WHERE \"agentId\" SIMILAR TO '[0-9a-f]{64}';") agents with hex agentIds"

# Rebuild the Docker image with new code
echo "=== REBUILDING DOCKER IMAGE ==="
docker-compose stop app
docker-compose build --no-cache app 2>&1 | tail -3
docker-compose up -d app

sleep 15

# Verify
echo "=== VERIFY ==="
curl -s http://localhost:3000/api/health
echo ""
echo "=== NEW ROUTES ==="
curl -s http://localhost:3000/api/v1/rate | head -c 100
echo ""
curl -s http://localhost:3000/api/v1/revenue | head -c 100
echo ""
curl -s http://localhost:3000/api/v1/receipts/monetary | head -c 100
echo ""
echo "=== DEPLOYMENT COMPLETE ==="