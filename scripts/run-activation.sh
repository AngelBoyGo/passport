#!/bin/bash
set -euo pipefail

# Run the activation script from a fresh Node container with @noble installed
docker run --rm --network passport_default \
  -v /opt/passport/scripts:/app/scripts \
  -w /app \
  node:20-alpine \
  sh -c '
    npm install @noble/ed25519 @noble/hashes --no-save 2>/dev/null
    PASSPORT_ISSUER_KEY=${PASSPORT_ISSUER_KEY:?set PASSPORT_ISSUER_KEY} \
    node scripts/activate-agents-v2.js
  '