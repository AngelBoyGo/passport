#!/bin/bash
set -euo pipefail

cd /opt/passport

echo "=== 1. PULL ==="
git pull origin main 2>&1 | tail -1

echo "=== 2. ENABLE SERVICE AUTH BYPASS ==="
grep -q "EVIDENCE_SERVICE_AUTH_BYPASS" .env.production || echo "EVIDENCE_SERVICE_AUTH_BYPASS=true" >> .env.production

echo "=== 3. REBUILD ==="
docker stop passport_app_1 2>/dev/null || true
docker rm passport_app_1 2>/dev/null || true
docker-compose build app 2>&1 | tail -3
docker-compose up -d app
sleep 15

echo "=== 4. INSTALL @NOBLE ==="
docker exec passport_app_1 npm install @noble/ed25519 @noble/hashes --no-save 2>&1 | tail -1

echo "=== 5. RUN ACTIVATION ==="
docker cp /tmp/activate-agents-v2.js passport_app_1:/app/activate-agents-v2.js
docker exec passport_app_1 sh -c '
sed -i "s|../node_modules/@noble/ed25519.js|@noble/ed25519|g" /app/activate-agents-v2.js
sed -i "s|../node_modules/@noble/hashes/sha2.js|@noble/hashes/sha2.js|g" /app/activate-agents-v2.js
sed -i "s|../node_modules/@noble/hashes/utils.js|@noble/hashes/utils.js|g" /app/activate-agents-v2.js
'

docker exec -e PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
  -w /app \
  passport_app_1 \
  node /app/activate-agents-v2.js

echo "=== 6. VERIFY ==="
curl -s http://localhost:3000/api/health
echo ""
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300
echo ""
echo "=== DONE ==="