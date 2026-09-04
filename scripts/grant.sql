INSERT INTO "AngelCoinAccount" (id,"subjectCommitment","creditState","accessTier","createdAt","updatedAt")
SELECT gen_random_uuid()::text, e."subjectCommitment", 'ACTIVE', 'FULL', NOW(), NOW()
FROM "AgentEnrollment" e WHERE e.status='ISSUED'
ON CONFLICT ("subjectCommitment") DO NOTHING;

INSERT INTO "AngelCoinJournalEntry" (id,"accountId","entryType",amount,"createdAt")
SELECT gen_random_uuid()::text, ac.id, 'OPERATOR_GRANT', 100, NOW()
FROM "AngelCoinAccount" ac
WHERE ac."subjectCommitment" SIMILAR TO '[0-9a-f]{64}'
AND NOT EXISTS (SELECT 1 FROM "AngelCoinJournalEntry" je WHERE je."accountId" = ac.id AND je."entryType" = 'OPERATOR_GRANT');

SELECT 'GRANTS COMPLETE: ' || COUNT(*) FROM "AngelCoinJournalEntry" WHERE "entryType" = 'OPERATOR_GRANT';