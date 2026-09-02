#!/bin/bash
set -euo pipefail

cd /opt/passport

echo "=== 1. PULL LATEST CODE ==="
git pull origin main 2>&1 | tail -3

echo "=== 2. PUSH DATABASE SCHEMA ==="
DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)
docker run --rm --network passport_default \
  -v /opt/passport/prisma:/app/prisma \
  -w /app \
  -e DATABASE_URL="postgresql://passport:passport@db:5432/passport" \
  node:20-alpine \
  sh -c 'npm install prisma@6.19.0 --no-save 2>/dev/null && npx prisma db push --accept-data-loss --skip-generate'

echo "=== 3. REBUILD DOCKER IMAGE ==="
docker-compose stop app
docker-compose build --no-cache app 2>&1 | tail -3
docker-compose up -d app

echo "=== 4. INSTALL @NOBLE IN CONTAINER ==="
sleep 15
docker exec passport_app_1 npm install @noble/ed25519 @noble/hashes --no-save 2>&1 | tail -3

echo "=== 5. FIX EXISTING AGENT IDS ==="
docker exec "$DB" psql -U passport -d passport -c "
UPDATE \"Agent\" a
SET \"agentId\" = e.\"subjectCommitment\"
FROM \"AgentEnrollment\" e
WHERE e.\"subjectCommitment\" != a.\"agentId\"
AND a.\"agentId\" NOT SIMILAR TO '[0-9a-f]{64}';
"

echo "=== 6. VERIFY DEPLOYMENT ==="
curl -s http://localhost:3000/api/health
echo ""
echo "--- NEW ROUTES ---"
curl -s http://localhost:3000/api/v1/rate | head -c 100
echo ""
curl -s http://localhost:3000/api/v1/revenue | head -c 100
echo ""
curl -s http://localhost:3000/api/v1/receipts/monetary | head -c 100
echo ""
echo "=== DEPLOYMENT COMPLETE ==="