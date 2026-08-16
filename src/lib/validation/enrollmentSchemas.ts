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
    "task_deliverable",
  ]),
  payload: z.unknown(),
  signature: signatureSchema,
});

export const updatePresentationBodySchema = z.object({
  photo_url: z.string(),
  photo_content_sha256: z
    .string()
    .regex(
      /^$|^[0-9a-f]{64}$/i,
      "photo_content_sha256 must be empty or a 64-character hex string"
    ),
  photo_mime_type: z.string(),
  signature: signatureSchema,
});

export type EnrollStartBody = z.infer<typeof enrollStartBodySchema>;
export type EnrollCompleteBody = z.infer<typeof enrollCompleteBodySchema>;
export type UpdatePresentationBody = z.infer<typeof updatePresentationBodySchema>;

export const loginBodySchema = z.object({
  email: z.string().email("email must be a valid email address"),
  password: z.string().min(1, "password is required"),
});

export const signupBodySchema = z.object({
  email: z.string().email("email must be a valid email address"),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type SignupBody = z.infer<typeof signupBodySchema>;

export { zodValidationErrorResponse } from "@/lib/validation/receiptSchemas";
