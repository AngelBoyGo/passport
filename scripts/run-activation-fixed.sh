#!/bin/bash
set -euo pipefail

# Install @noble inside the running container
echo "=== INSTALLING @NOBLE ==="
docker exec passport_app_1 npm install @noble/ed25519 @noble/hashes --no-save 2>&1 | tail -1

# Copy the activation script
docker cp /tmp/activate-agents-v2.js passport_app_1:/app/activate-agents-v2.js

# Fix module paths: replace relative paths with bare module names
docker exec passport_app_1 sh -c '
sed -i "s|require(../node_modules/@noble/ed25519.js)||g" /app/activate-agents-v2.js
sed -i "s|../node_modules/@noble/ed25519.js||g" /app/activate-agents-v2.js
sed -i "s|../node_modules/@noble/hashes/sha2.js|@noble/hashes/sha2.js|g" /app/activate-agents-v2.js
sed -i "s|../node_modules/@noble/hashes/utils.js|@noble/hashes/utils.js|g" /app/activate-agents-v2.js
'

# Run from /app where node_modules exists
echo "=== RUNNING ACTIVATION ==="
docker exec -e PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
  -w /app \
  passport_app_1 \
  node /app/activate-agents-v2.js

echo ""
echo "=== VERIFY ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300