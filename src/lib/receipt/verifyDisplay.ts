import { ErrorTranche, OperationalDomain } from "@prisma/client";
import { computeDomainCommitment } from "./canonical";

export const REDACTED_BLINDED_DOMAIN = "REDACTED_BLINDED_HASH";

export interface ReceiptVerifyDisplayInput {
  domain: OperationalDomain | null;
  domainCommitment?: string | null;
  blindSalt?: string | null;
  errorTranche: ErrorTranche | null;
  status: string;
}

export interface ReceiptVerifyDisplayFields {
  operationalDomain: string;
  blinded?: boolean;
  domainCommitment?: string;
  errorTranche?: ErrorTranche;
}

/**
 * Confirms whether a plaintext domain matches a blinded receipt commitment.
 */
export function confirmBlindedDomainMatch(
  requestedDomain: string,
  blindSalt: string,
  domainCommitment: string
): boolean {
  return (
    computeDomainCommitment(requestedDomain, blindSalt) === domainCommitment
  );
}

/**
 * Normalizes receipt metadata for the public verify page.
 */
export function receiptVerifyDisplayFields(
  receipt: ReceiptVerifyDisplayInput
): ReceiptVerifyDisplayFields {
  const fields: ReceiptVerifyDisplayFields = {
    operationalDomain: receipt.blindSalt
      ? REDACTED_BLINDED_DOMAIN
      : (receipt.domain ?? OperationalDomain.SYSTEM_INTEGRATION),
  };

  if (receipt.blindSalt) {
    fields.blinded = true;
    if (receipt.domainCommitment) {
      fields.domainCommitment = receipt.domainCommitment;
    }
  }

  if (receipt.status !== "pending" && receipt.errorTranche != null) {
    fields.errorTranche = receipt.errorTranche;
  }

  return fields;
}
