import { z } from "zod";
import { OperationalDomain, ErrorTranche } from "@prisma/client";

const receiptTypeSchema = z.enum(["custody", "competence"]);

const finalizeStatusSchema = z.enum([
  "success",
  "refusal",
  "null",
  "graceful_shutdown",
  "timeout",
  "failure_tombstone",
]);

export const issueReceiptBodySchema = z.object({
  agent_id: z.string().min(1),
  receipt_type: receiptTypeSchema,
  input_digest: z.string().min(1),
  authority_scope: z.string().min(1),
  expiry: z.string().min(1),
  prev_receipt_hash: z.string().optional(),
  domain: z.nativeEnum(OperationalDomain).optional(),
});

export const finalizeReceiptBodySchema = z
  .object({
    status: finalizeStatusSchema,
    output_hash: z.string().optional(),
    refusal_reason: z.string().optional(),
    terminal_reason: z.string().optional(),
    error_tranche: z.nativeEnum(ErrorTranche).optional(),
  })
  .transform((data) => ({
    ...data,
    error_tranche:
      data.error_tranche === undefined || data.status === "success"
        ? ErrorTranche.NONE
        : data.error_tranche,
  }));

export type IssueReceiptBody = z.infer<typeof issueReceiptBodySchema> & {
  domain: OperationalDomain;
};

export type FinalizeReceiptBody = z.infer<typeof finalizeReceiptBodySchema>;

export function parseIssueReceiptBody(body: unknown) {
  const parsed = issueReceiptBodySchema.safeParse(body);
  if (!parsed.success) {
    return parsed;
  }
  return {
    success: true as const,
    data: {
      ...parsed.data,
      domain: parsed.data.domain ?? OperationalDomain.SYSTEM_INTEGRATION,
    },
  };
}

export function parseFinalizeReceiptBody(body: unknown) {
  return finalizeReceiptBodySchema.safeParse(body);
}

export function zodValidationErrorResponse(error: z.ZodError) {
  return {
    error: "Validation failed",
    issues: error.flatten(),
  };
}
