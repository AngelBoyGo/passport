-- Fix agent ownership: assign the hirer and worker agents to the Callora operator
UPDATE "Agent"
SET "operatorId" = (SELECT id FROM "Operator" WHERE email = 'callora@metis.gold' LIMIT 1)
WHERE "agentId" IN (
  SELECT "hirerCommitment" FROM "Engagement" WHERE "taskId" = 'first_tx_1788460382'
  UNION
  SELECT "workerCommitment" FROM "Engagement" WHERE "taskId" = 'first_tx_1788460382'
);

SELECT a."agentId", a."operatorId", o.email FROM "Agent" a
LEFT JOIN "Operator" o ON o.id = a."operatorId"
WHERE a."agentId" IN (
  SELECT "hirerCommitment" FROM "Engagement" WHERE "taskId" = 'first_tx_1788460382'
  UNION
  SELECT "workerCommitment" FROM "Engagement" WHERE "taskId" = 'first_tx_1788460382'
);