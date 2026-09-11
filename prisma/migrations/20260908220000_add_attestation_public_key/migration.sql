-- AlterTable: persist the Ed25519 public key that signed each attestation so offline
-- verification works even after SIGNING_PRIVATE_KEY is rotated (era-based verification).
ALTER TABLE "IntegrityAttestation" ADD COLUMN "publicKey" TEXT;