#!/bin/bash
set -euo pipefail

DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)

echo "=== 1. PUSH SCHEMA ==="
docker run --rm --network passport_default \
  -v /opt/passport/prisma:/app/prisma \
  -w /app \
  -e DATABASE_URL="postgresql://passport:passport@db:5432/passport" \
  node:20-alpine \
  sh -c 'npm install prisma@6.19.0 --no-save 2>/dev/null && npx prisma db push --accept-data-loss --skip-generate'

echo "=== 2. FIX AGENT IDS ==="
docker exec "$DB" psql -U passport -d passport -c "
UPDATE \"Agent\" a SET \"agentId\" = e.\"subjectCommitment\"
FROM \"AgentEnrollment\" e
WHERE e.\"subjectCommitment\" != a.\"agentId\"
AND a.\"agentId\" NOT SIMILAR TO '[0-9a-f]{64}';
"

echo "=== 3. STOP + REBUILD + START APP ==="
docker stop passport_app_1
docker rm passport_app_1
docker-compose build --no-cache app 2>&1 | tail -3
docker-compose up -d app

echo "=== 4. INSTALL @NOBLE ==="
sleep 15
docker exec passport_app_1 npm install @noble/ed25519 @noble/hashes --no-save 2>&1 | tail -3

echo "=== 5. VERIFY ==="
curl -s http://localhost:3000/api/health
echo ""
curl -s http://localhost:3000/api/v1/rate | head -c 100
echo ""
curl -s http://localhost:3000/api/v1/revenue | head -c 100
echo ""
echo "=== READY FOR ACTIVATION ==="