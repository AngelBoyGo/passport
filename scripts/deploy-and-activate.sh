#!/bin/bash
set -euo pipefail

cd /opt/passport

echo "=== 1. REBUILD WITH LATEST CODE ==="
docker stop passport_app_1 2>/dev/null || true
docker rm passport_app_1 2>/dev/null || true
docker-compose build app 2>&1 | tail -3
docker-compose up -d app
sleep 15

echo "=== 2. INSTALL @NOBLE IN CONTAINER ==="
docker exec passport_app_1 npm install @noble/ed25519 @noble/hashes --no-save 2>&1 | tail -1

echo "=== 3. COPY ACTIVATION SCRIPT TO APP DIR ==="
docker exec passport_app_1 sh -c 'cp /tmp/activate-agents-v2.js /app/activate-agents-v2.js 2>/dev/null || true'

# Fix the module paths in the script
docker exec passport_app_1 sh -c "
sed -i \"s|require('../node_modules/@noble/ed25519.js')|require('@noble/ed25519')|g\" /app/activate-agents-v2.js 2>/dev/null
sed -i \"s|require('../node_modules/@noble/ed25519.js') || {}|require('@noble/ed25519')|g\" /app/activate-agents-v2.js 2>/dev/null
"

echo "=== 4. RUN ACTIVATION ==="
docker exec -e PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
  -w /app \
  passport_app_1 \
  node /app/activate-agents-v2.js

echo "=== 5. VERIFY ==="
curl -s http://localhost:3000/api/health
echo ""
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300
echo ""
echo "=== DONE ==="