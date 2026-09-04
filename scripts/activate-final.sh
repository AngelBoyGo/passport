#!/bin/bash
set -euo pipefail

echo "=== FIXING SCRIPT AND RUNNING ==="

# Copy to /tmp inside container
docker exec passport_app_1 sh -c 'cp /tmp/activate-agents-v2.js /tmp/activate-v2.js'

# Fix module paths
docker exec passport_app_1 sh -c '
sed -i "s|../node_modules/@noble/ed25519.js|@noble/ed25519|g" /tmp/activate-v2.js
sed -i "s|../node_modules/@noble/hashes/sha2.js|@noble/hashes/sha2.js|g" /tmp/activate-v2.js
sed -i "s|../node_modules/@noble/hashes/utils.js|@noble/hashes/utils.js|g" /tmp/activate-v2.js
'

# Run with NODE_PATH pointing to /app/node_modules
echo "=== RUNNING ACTIVATION ==="
docker exec \
  -e PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
  -e NODE_PATH=/app/node_modules \
  -e EVIDENCE_SERVICE_AUTH_BYPASS=true \
  -w /app \
  passport_app_1 \
  node /tmp/activate-v2.js

echo ""
echo "=== VERIFY ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300