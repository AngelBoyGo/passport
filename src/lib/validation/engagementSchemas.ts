import { z } from "zod";

const subjectCommitmentSchema = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/i,
    "commitment must be a full 64-character hex string"
  );

export const createEngagementBodySchema = z.object({
  task_id: z.string().trim().min(1).max(256),
  hirer_commitment: subjectCommitmentSchema,
  worker_commitment: subjectCommitmentSchema,
  amount: z.number().int().positive(),
});

export type CreateEngagementBody = z.infer<typeof createEngagementBodySchema>;

export { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";
