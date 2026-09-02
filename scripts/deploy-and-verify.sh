#!/bin/bash
set -euo pipefail

cd /opt/passport

# Stop and remove all containers (volumes persist)
docker stop passport_app_1 passport_db_1 passport_caddy_1 2>/dev/null || true
docker rm passport_app_1 passport_db_1 passport_caddy_1 2>/dev/null || true

# Start fresh (picks up new env)
docker-compose up -d
sleep 15

# Verify health
echo "=== HEALTH ==="
curl -s http://localhost:3000/api/health

# Verify PoW difficulty
echo ""
echo "=== POW ==="
docker exec passport_app_1 sh -c 'echo "DIFFICULTY=$AUTONOMOUS_POW_DIFFICULTY"'

# Deploy agents
echo ""
echo "=== DEPLOYING ==="
docker exec passport_app_1 node /tmp/deploy-agents.js 5