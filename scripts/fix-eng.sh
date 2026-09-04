#!/bin/bash
# This script fixes the engagement status
DB=24044c4a5a15_passport_db_1
docker exec -i $DB psql -U passport -d passport << 'EOSQL'
UPDATE "Engagement" SET status = 'PAID', "paidAt" = NOW() WHERE "taskId" = 'first_tx_1788460382' AND status = 'DELIVERED';
SELECT "taskId", status, amount, "paidAt" FROM "Engagement" WHERE "taskId" = 'first_tx_1788460382';
EOSQL