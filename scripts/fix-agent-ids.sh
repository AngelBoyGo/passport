#!/bin/bash
docker ps --format "{{.Names}} {{.Status}}"
echo "---"
# Find the DB container
DB_CONTAINER=$(docker ps --format "{{.Names}}" | grep -i "db\|postgres\|passport" | grep -v app | grep -v caddy | head -1)
echo "DB Container: $DB_CONTAINER"

if [ -z "$DB_CONTAINER" ]; then
  # Try to find by image
  DB_CONTAINER=$(docker ps --format "{{.Names}} {{.Image}}" | grep "postgres" | awk '{print $1}')
  echo "Found by image: $DB_CONTAINER"
fi

if [ -n "$DB_CONTAINER" ]; then
  # Fix agent IDs
  docker exec "$DB_CONTAINER" psql -U passport -d passport -c "
  SELECT a.id, a.\"agentId\" AS current_id, a.domain,
         e.\"subjectCommitment\" AS enrollment_hash,
         CASE WHEN a.\"agentId\" = e.\"subjectCommitment\" THEN 'MATCHED' ELSE 'MISMATCH' END AS status
  FROM \"Agent\" a
  LEFT JOIN \"AgentEnrollment\" e ON e.\"publicKey\" IS NOT NULL
  ORDER BY a.\"createdAt\" DESC
  LIMIT 15;
  "
else
  echo "No DB container found"
  docker ps -a
fi