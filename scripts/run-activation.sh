#!/bin/bash
set -euo pipefail

# Run the activation script from a fresh Node container with @noble installed
docker run --rm --network passport_default \
  -v /opt/passport/scripts:/app/scripts \
  -w /app \
  node:20-alpine \
  sh -c '
    npm install @noble/ed25519 @noble/hashes --no-save 2>/dev/null
    PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
    node scripts/activate-agents-v2.js
  '