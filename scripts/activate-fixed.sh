#!/bin/bash
set -euo pipefail

# Copy script to /tmp (writable)
docker exec passport_app_1 sh -c 'cp /tmp/activate-agents-v2.js /tmp/activate-v2.js'

# Fix module paths inside the container
docker exec passport_app_1 sh -c '
sed -i "s|../node_modules/@noble/ed25519.js|@noble/ed25519|g" /tmp/activate-v2.js
sed -i "s|../node_modules/@noble/hashes/sha2.js|@noble/hashes/sha2.js|g" /tmp/activate-v2.js
sed -i "s|../node_modules/@noble/hashes/utils.js|@noble/hashes/utils.js|g" /tmp/activate-v2.js
'

# Run from /app with NODE_PATH pointing to node_modules
docker exec \
  -e PASSPORT_ISSUER_KEY=pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4 \
  -e NODE_PATH=/app/node_modules \
  -w /app \
  passport_app_1 \
  node /tmp/activate-v2.js