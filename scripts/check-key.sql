SELECT ak.name, ak.role, ak."operatorId", o.email
FROM "ApiKey" ak
LEFT JOIN "Operator" o ON o.id = ak."operatorId"
WHERE ak."keyHash" = encode(digest('pp_ent_39bc2cfce209c7d7d1b0f25593ab29677096156a2bbac676c71e148b57090fd4','sha256'),'hex');