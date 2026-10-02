#!/bin/bash
set -euo pipefail

# Re-copy activation scripts into the container
docker cp /tmp/activate-agents-v2.js passport_app_1:/tmp/
docker cp /tmp/deploy-agents.js passport_app_1:/tmp/

# Re-enroll agents (PoW difficulty 4, saves private keys)
echo "=== ENROLLING AGENTS ==="
docker exec passport_app_1 node /tmp/deploy-agents.js 5

# Now run the @noble-based evidence posting with the SAME agents
# (the v2 script enrolls new agents, but we need to post evidence for the ones we just enrolled)
# Since we can't easily combine both, just run the v2 script which does everything
echo "=== RUNNING FULL ACTIVATION (v2 with @noble) ==="
docker exec -e PASSPORT_ISSUER_KEY=${PASSPORT_ISSUER_KEY:?set PASSPORT_ISSUER_KEY} passport_app_1 node /tmp/activate-agents-v2.js

echo "=== VERIFY ==="
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300
echo ""
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'