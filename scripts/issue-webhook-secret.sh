#!/bin/bash
set -euo pipefail

# Generate webhook secret for Callora/Metis integration
WHSEC="whsec_$(head /dev/urandom | tr -dc 'a-f0-9' | head -c 48)"

# Get Callora's operator ID
OPERATOR_ID=$(docker exec passport_db_1 psql -U passport -d passport -t -A -c "
SELECT id FROM \"Operator\" WHERE email = 'callora@metis.gold' LIMIT 1;
")

# Create webhook subscription
docker exec passport_db_1 psql -U passport -d passport -c "
INSERT INTO \"WebhookSubscription\" (id, \"operatorId\", url, secret, events, active, \"createdAt\", \"updatedAt\")
VALUES (
  '$(cat /proc/sys/kernel/random/uuid | tr -d '-')',
  '$OPERATOR_ID',
  'https://call.metis.gold/api/passport/webhook',
  '$WHSEC',
  ARRAY['evidence.anchored', 'reputation.milestone', 'reputation.degraded', 'reputation.restored'],
  true,
  NOW(),
  NOW()
);
"

echo "=== WEBHOOK SECRET FOR CALLORA ==="
echo "whsec=$WHSEC"
echo "operator_id=$OPERATOR_ID"
echo "events=evidence.anchored, reputation.milestone, reputation.degraded, reputation.restored"
echo "webhook_url=https://call.metis.gold/api/passport/webhook"