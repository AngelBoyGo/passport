import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrollmentStatus } from "@prisma/client";
import { getPublicKey, sign } from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";
import { computePresentationDigest } from "@/lib/enrollment/presentation";

const PRIVATE_KEY = hexToBytes("4".repeat(64));
const PUBLIC_KEY_HEX = bytesToHex(getPublicKey(PRIVATE_KEY));

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentEnrollment: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

import { updatePresentation } from "@/lib/enrollment/presentation-service";
import { NotEnrolledError } from "@/lib/enrollment/errors";

const SUBJECT = "e".repeat(64);

async function signPresentation(fields: {
  photoUrl: string;
  photoContentSha256: string;
  photoMimeType: string;
}): Promise<string> {
  const digest = computePresentationDigest({
    subjectCommitment: SUBJECT,
    ...fields,
  });
  const sig = await sign(utf8ToBytes(digest), PRIVATE_KEY);
  return bytesToHex(sig);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updatePresentation", () => {
  it("stores signed photo reference for enrolled agent", async () => {
    findUniqueMock.mockResolvedValue({
      subjectCommitment: SUBJECT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    const updatedAt = new Date("2026-06-28T12:00:00.000Z");
    updateMock.mockResolvedValue({
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "f".repeat(64),
      photoMimeType: "image/png",
      photoUpdatedAt: updatedAt,
    });

    const signature = await signPresentation({
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "f".repeat(64),
      photoMimeType: "image/png",
    });

    const result = await updatePresentation({
      subjectCommitment: SUBJECT,
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "f".repeat(64),
      photoMimeType: "image/png",
      signature,
    });

    expect(result.presentation).toEqual({
      url: "https://cdn.example.com/agent.png",
      content_sha256: "f".repeat(64),
      mime_type: "image/png",
      updated_at: updatedAt.toISOString(),
    });
  });

  it("clears presentation with signed empty fields", async () => {
    findUniqueMock.mockResolvedValue({
      subjectCommitment: SUBJECT,
      publicKey: PUBLIC_KEY_HEX,
      status: EnrollmentStatus.ISSUED,
    });

    updateMock.mockResolvedValue({
      photoUrl: null,
      photoContentSha256: null,
      photoMimeType: null,
      photoUpdatedAt: null,
    });

    const signature = await signPresentation({
      photoUrl: "",
      photoContentSha256: "",
      photoMimeType: "",
    });

    const result = await updatePresentation({
      subjectCommitment: SUBJECT,
      photoUrl: "",
      photoContentSha256: "",
      photoMimeType: "",
      signature,
    });

    expect(result.presentation).toBeNull();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          photoUrl: null,
          photoContentSha256: null,
          photoMimeType: null,
          photoUpdatedAt: null,
        },
      })
    );
  });

  it("rejects when not enrolled", async () => {
    findUniqueMock.mockResolvedValue(null);

    const signature = await signPresentation({
      photoUrl: "https://cdn.example.com/agent.png",
      photoContentSha256: "f".repeat(64),
      photoMimeType: "image/png",
    });

    await expect(
      updatePresentation({
        subjectCommitment: SUBJECT,
        photoUrl: "https://cdn.example.com/agent.png",
        photoContentSha256: "f".repeat(64),
        photoMimeType: "image/png",
        signature,
      })
    ).rejects.toBeInstanceOf(NotEnrolledError);
  });
});
