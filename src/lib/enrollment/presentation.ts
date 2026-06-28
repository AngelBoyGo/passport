import { canonicalJson, sha256Hex } from "@/lib/receipt/canonical";
import { InvalidEnrollmentInputError } from "@/lib/enrollment/errors";

export const ALLOWED_PHOTO_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type PresentationDigestInput = {
  subjectCommitment: string;
  photoUrl: string;
  photoContentSha256: string;
  photoMimeType: string;
};

export type AgentPresentation = {
  url: string;
  content_sha256: string;
  mime_type: string;
  updated_at: string;
};

/**
 * Computes the presentation digest agents must sign for photo updates.
 */
export function computePresentationDigest(input: PresentationDigestInput): string {
  return sha256Hex(
    canonicalJson({
      subject_commitment: input.subjectCommitment.toLowerCase(),
      photo_url: input.photoUrl,
      photo_content_sha256: input.photoContentSha256.toLowerCase(),
      photo_mime_type: input.photoMimeType,
    })
  );
}

/**
 * Returns true when the URL is empty (clear) or a valid https URL.
 */
export function isValidHttpsPhotoUrl(url: string): boolean {
  if (url === "") {
    return true;
  }
  const lower = url.toLowerCase();
  if (
    lower.startsWith("data:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("ipfs:")
  ) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns true when mime type is empty (clear) or on the allowlist.
 */
export function isAllowedPhotoMimeType(mimeType: string): boolean {
  if (mimeType === "") {
    return true;
  }
  return ALLOWED_PHOTO_MIME_TYPES.has(mimeType);
}

/**
 * Validates presentation fields; throws InvalidEnrollmentInputError on failure.
 */
export function validatePresentationFields(fields: {
  photoUrl: string;
  photoContentSha256: string;
  photoMimeType: string;
}): void {
  const clearing =
    fields.photoUrl === "" &&
    fields.photoContentSha256 === "" &&
    fields.photoMimeType === "";

  if (clearing) {
    return;
  }

  if (!isValidHttpsPhotoUrl(fields.photoUrl)) {
    throw new InvalidEnrollmentInputError("photo_url must use https");
  }

  if (!/^[0-9a-f]{64}$/i.test(fields.photoContentSha256)) {
    throw new InvalidEnrollmentInputError(
      "photo_content_sha256 must be a 64-character hex string"
    );
  }

  if (!fields.photoMimeType) {
    throw new InvalidEnrollmentInputError("photo_mime_type is required");
  }

  if (!isAllowedPhotoMimeType(fields.photoMimeType)) {
    throw new InvalidEnrollmentInputError(
      "photo_mime_type must be one of: image/png, image/jpeg, image/webp, image/gif"
    );
  }
}

/**
 * Maps persisted enrollment photo columns to API presentation or null.
 */
export function toAgentPresentation(row: {
  photoUrl: string | null;
  photoContentSha256: string | null;
  photoMimeType: string | null;
  photoUpdatedAt: Date | null;
}): AgentPresentation | null {
  if (
    !row.photoUrl ||
    !row.photoContentSha256 ||
    !row.photoMimeType ||
    !row.photoUpdatedAt
  ) {
    return null;
  }

  return {
    url: row.photoUrl,
    content_sha256: row.photoContentSha256,
    mime_type: row.photoMimeType,
    updated_at: row.photoUpdatedAt.toISOString(),
  };
}
