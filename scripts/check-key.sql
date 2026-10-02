SELECT ak.name, ak.role, ak."operatorId", o.email
FROM "ApiKey" ak
LEFT JOIN "Operator" o ON o.id = ak."operatorId"
WHERE ak."keyHash" = encode(digest('REPLACE_WITH_ISSUER_KEY_VIA_ENV','sha256'),'hex');