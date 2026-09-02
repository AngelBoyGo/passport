#!/bin/bash
DB=$(docker ps --format "{{.Names}}" | grep "postgres" | head -1)
echo "=== AGENTS ==="
docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT COUNT(*) FROM \"Agent\";"
echo "=== ENROLLMENTS ==="
docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT COUNT(*) FROM \"AgentEnrollment\" WHERE status = 'ISSUED';"
echo "=== WALLETS ==="
docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT COUNT(*) FROM \"AgentWallet\";"
echo "=== EVIDENCE ==="
docker exec "$DB" psql -U passport -d passport -t -A -c "SELECT COUNT(*) FROM \"AgentEvidence\";"
echo "=== LEADERBOARD ==="
curl -s http://localhost:3000/api/v1/leaderboard | head -c 300