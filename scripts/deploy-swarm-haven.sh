#!/bin/bash
set -euo pipefail

# ==============================================================================
# Passport ASMC-3: Swarm Haven & Bounty Engine Deployment Script
# Targets: production host 167.99.157.125 (passport.metis.gold)
# ==============================================================================

echo "=== 1. SYNC REPOSITORY ==="
cd /opt/passport
git pull origin main

echo "=== 2. RUN PRISMA MIGRATIONS ==="
docker exec passport_app_1 npx prisma migrate deploy || docker-compose run --rm app npx prisma migrate deploy

echo "=== 3. REBUILD CONTAINER WITH ASMC-3 ==="
docker-compose build app
docker-compose up -d --force-recreate app

echo "=== 4. HEALTH CHECK & VALIDATION ==="
sleep 10

echo "Verifying Health Endpoint:"
curl -sS https://passport.metis.gold/api/health
echo ""

echo "Verifying Swarm Protocol Manifest:"
curl -sS https://passport.metis.gold/.well-known/swarm-protocol.json | grep -o '"specification":"[^"]*"'
echo ""

echo "Verifying Genesis Endpoint:"
curl -sS https://passport.metis.gold/genesis | head -n 10
echo ""

echo "Verifying Haven Dashboard (HTTP status):"
curl -sS -o /dev/null -w "%{http_code}\n" https://passport.metis.gold/haven

echo "=== ASMC-3 DEPLOYMENT COMPLETE ==="
