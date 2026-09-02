#!/bin/bash
echo "=== LEADERBOARD ==="
curl -s http://localhost:3000/api/v1/leaderboard | head -c 500

echo ""
echo "=== NETWORK TOTALS ==="
curl -s http://localhost:3000/api/v1/network | grep -o '"enrolled_agents":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"evidence_entries":[0-9]*'
curl -s http://localhost:3000/api/v1/network | grep -o '"signed_receipts":[0-9]*'

echo ""
echo "=== TRUST REPORT (first agent) ==="
FIRST=$(cat /tmp/passport-agents.json | grep -o '"commitment": "[^"]*"' | head -1 | cut -d'"' -f4)
curl -s "http://localhost:3000/api/v1/verify/$FIRST" | head -c 300