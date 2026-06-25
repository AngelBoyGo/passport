import { z } from "zod";
import { AccessTier } from "@prisma/client";

const subjectCommitmentSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "subject_commitment must be a full 64-character hex string");

export const grantCreditsBodySchema = z.object({
  subject_commitment: subjectCommitmentSchema,
  amount: z.number().int().positive(),
  metadata: z.string().optional(),
});

export const transferCreditsBodySchema = z.object({
  from_commitment: subjectCommitmentSchema,
  to_commitment: subjectCommitmentSchema,
  amount: z.number().int().positive(),
  kind: z.enum(["TASK_PAYMENT", "PEER_GIFT"]).optional(),
});

export const accessEvaluateBodySchema = z.object({
  subject_commitment: subjectCommitmentSchema,
});

export const accessOverrideBodySchema = z.object({
  subject_commitment: subjectCommitmentSchema,
  tier: z.nativeEnum(AccessTier).nullable(),
});

export type GrantCreditsBody = z.infer<typeof grantCreditsBodySchema>;
export type TransferCreditsBody = z.infer<typeof transferCreditsBodySchema>;
export type AccessEvaluateBody = z.infer<typeof accessEvaluateBodySchema>;
export type AccessOverrideBody = z.infer<typeof accessOverrideBodySchema>;

export { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";
