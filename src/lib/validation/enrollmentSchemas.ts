import { z } from "zod";

const publicKeySchema = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/i,
    "public_key must be a 64-character hex ed25519 public key"
  );

const subjectCommitmentSchema = z
  .string()
  .regex(
    /^[0-9a-f]{64}$/i,
    "subject_commitment must be a full 64-character hex string"
  );

const signatureSchema = z
  .string()
  .regex(
    /^[0-9a-f]{128}$/i,
    "signature must be a 128-character hex ed25519 signature"
  );

export const enrollStartBodySchema = z.object({
  public_key: publicKeySchema,
  context: z.string().min(1).optional(),
});

export const enrollCompleteBodySchema = z.object({
  subject_commitment: subjectCommitmentSchema,
  signature: signatureSchema,
});

export const ingestEvidenceBodySchema = z.object({
  source_type: z.enum([
    "github_push_webhook",
    "github_commit_payload",
    "github_issue_event",
    "compliance_report",
    "otel_genai_trace",
  ]),
  payload: z.unknown(),
  signature: signatureSchema,
});

export type EnrollStartBody = z.infer<typeof enrollStartBodySchema>;
export type EnrollCompleteBody = z.infer<typeof enrollCompleteBodySchema>;

export { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";
