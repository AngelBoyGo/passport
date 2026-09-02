#!/bin/bash
# Extract agent credentials from the container
docker cp passport_app_1:/tmp/passport-agents.json /tmp/passport-agents.json
echo "=== AGENTS ==="
cat /tmp/passport-agents.json | head -30

# Get the first agent's commitment
FIRST=$(cat /tmp/passport-agents.json | grep -o '"commitment": "[^"]*"' | head -1 | cut -d'"' -f4)
echo ""
echo "=== TRUST REPORT for $FIRST ==="
curl -s "http://localhost:3000/api/v1/verify/$FIRST" | head -c 500

echo ""
echo "=== AGENT WALLET ==="
curl -s "http://localhost:3000/api/v1/passport/agents/$FIRST/credits" | head -c 300