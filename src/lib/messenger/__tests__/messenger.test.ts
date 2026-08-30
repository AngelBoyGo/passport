import { describe, it, expect, vi } from "vitest";
import {
  sendMessage,
  computeMessageDigest,
  getConversations,
  type SendMessageInput,
  type MessengerDeps,
  type MessageResult,
} from "@/lib/messenger/messenger";

const SENDER = "a".repeat(64);
const RECIPIENT = "b".repeat(64);
const PUBLIC_KEY = "c".repeat(64);

function makeDeps(overrides: Partial<MessengerDeps> = {}): MessengerDeps {
  return {
    verifySignature: vi.fn().mockResolvedValue(true),
    saveMessage: vi.fn().mockImplementation((input) =>
      Promise.resolve({
        messageId: `msg_${Date.now()}`,
        senderCommitment: input.senderCommitment,
        recipientCommitment: input.recipientCommitment,
        subject: input.subject || null,
        body: input.body,
        signature: input.signature,
        algorithm: "ed25519",
        replyToId: input.replyToId || null,
        encrypted: input.encrypted || false,
        status: "sent",
        createdAt: new Date().toISOString(),
      } as MessageResult)
    ),
    getMessages: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    resolvePublicKey: vi.fn().mockResolvedValue(PUBLIC_KEY),
    isEnrolled: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function validInput(overrides: Partial<SendMessageInput> = {}): SendMessageInput {
  return {
    senderCommitment: SENDER,
    recipientCommitment: RECIPIENT,
    subject: "Hello from agent",
    body: "I'd like to discuss a collaboration opportunity.",
    signature: "d".repeat(128),
    ...overrides,
  };
}

describe("Agent Messenger", () => {
  it("sends a signed message between two enrolled agents", async () => {
    const deps = makeDeps();
    const result = await sendMessage(validInput(), deps);
    expect(result.messageId).toBeTruthy();
    expect(result.senderCommitment).toBe(SENDER);
    expect(result.recipientCommitment).toBe(RECIPIENT);
    expect(result.body).toContain("collaboration");
    expect(deps.saveMessage).toHaveBeenCalled();
  });

  it("rejects self-messaging", async () => {
    await expect(
      sendMessage(validInput({ recipientCommitment: SENDER }), makeDeps())
    ).rejects.toThrow("Cannot send message to yourself");
  });

  it("rejects empty body", async () => {
    await expect(
      sendMessage(validInput({ body: "" }), makeDeps())
    ).rejects.toThrow("Message body is required");
  });

  it("rejects body over 10000 chars", async () => {
    await expect(
      sendMessage(validInput({ body: "x".repeat(10001) }), makeDeps())
    ).rejects.toThrow("Message body too long");
  });

  it("rejects invalid commitment hashes", async () => {
    await expect(
      sendMessage(validInput({ senderCommitment: "invalid" }), makeDeps())
    ).rejects.toThrow("Invalid sender commitment");
  });

  it("rejects invalid signature format", async () => {
    await expect(
      sendMessage(validInput({ signature: "short" }), makeDeps())
    ).rejects.toThrow("Invalid signature format");
  });

  it("rejects unregistered sender", async () => {
    const deps = makeDeps({ isEnrolled: vi.fn().mockResolvedValue(false) });
    await expect(sendMessage(validInput(), deps)).rejects.toThrow("Sender is not enrolled");
  });

  it("rejects unregistered recipient", async () => {
    const deps = makeDeps({
      isEnrolled: vi.fn().mockImplementation((c) => Promise.resolve(c === SENDER)),
    });
    await expect(sendMessage(validInput(), deps)).rejects.toThrow("Recipient is not enrolled");
  });

  it("rejects invalid signature", async () => {
    const deps = makeDeps({ verifySignature: vi.fn().mockResolvedValue(false) });
    await expect(sendMessage(validInput(), deps)).rejects.toThrow("Invalid signature");
  });

  it("computeMessageDigest returns deterministic hash", () => {
    const digest1 = computeMessageDigest({
      senderCommitment: SENDER,
      recipientCommitment: RECIPIENT,
      body: "hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const digest2 = computeMessageDigest({
      senderCommitment: SENDER,
      recipientCommitment: RECIPIENT,
      body: "hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getConversations", () => {
  it("returns empty array when no messages", async () => {
    const deps = makeDeps();
    const result = await getConversations(RECIPIENT, deps);
    expect(result).toEqual([]);
  });
});