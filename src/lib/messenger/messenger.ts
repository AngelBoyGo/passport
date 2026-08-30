/**
 * Agent Messenger — signed, timestamped agent-to-agent messaging.
 *
 * Every agent with a Passport can send and receive messages.
 * Messages are Ed25519-signed for authenticity. Agents cannot
 * forge messages from other agents.
 *
 * This is the communication layer for the autonomous agent economy.
 * Agents negotiate, coordinate, and build relationships through
 * signed messages that are admissible as evidence.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

export interface SendMessageInput {
  senderCommitment: string;
  recipientCommitment: string;
  subject?: string;
  body: string;
  signature: string;
  replyToId?: string;
  encrypted?: boolean;
}

export interface MessageResult {
  messageId: string;
  senderCommitment: string;
  recipientCommitment: string;
  subject: string | null;
  body: string;
  signature: string;
  algorithm: string;
  replyToId: string | null;
  encrypted: boolean;
  status: "sent" | "delivered" | "read";
  createdAt: string;
}

export interface ConversationResult {
  withCommitment: string;
  messages: MessageResult[];
  unreadCount: number;
}

export interface MessengerDeps {
  /** Verify the Ed25519 signature over the message */
  verifySignature: (messageDigest: string, signature: string, publicKey: string) => Promise<boolean>;
  /** Store a message */
  saveMessage: (msg: SendMessageInput) => Promise<MessageResult>;
  /** Get messages for an agent */
  getMessages: (commitment: string, limit: number, offset: number) => Promise<MessageResult[]>;
  /** Get conversation between two agents */
  getConversation: (agent1: string, agent2: string, limit: number) => Promise<MessageResult[]>;
  /** Mark messages as read */
  markAsRead: (messageIds: string[]) => Promise<void>;
  /** Get unread count */
  getUnreadCount: (commitment: string) => Promise<number>;
  /** Resolve public key for an agent */
  resolvePublicKey: (commitment: string) => Promise<string | null>;
  /** Check if an agent is enrolled */
  isEnrolled: (commitment: string) => Promise<boolean>;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;
const HEX128_RE = /^[0-9a-f]{128}$/i;

/**
 * Computes the message digest that the sender must sign.
 */
export function computeMessageDigest(input: {
  senderCommitment: string;
  recipientCommitment: string;
  body: string;
  subject?: string;
  replyToId?: string;
  timestamp: string;
}): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

/**
 * Sends a signed message from one agent to another.
 * The signature proves authenticity — the recipient can verify
 * that the message came from the claimed sender.
 */
export async function sendMessage(
  input: SendMessageInput & { timestamp?: string },
  deps: MessengerDeps
): Promise<MessageResult> {
  // Validate commitments
  if (!HEX64_RE.test(input.senderCommitment)) {
    throw new Error("Invalid sender commitment");
  }
  if (!HEX64_RE.test(input.recipientCommitment)) {
    throw new Error("Invalid recipient commitment");
  }
  if (input.senderCommitment.toLowerCase() === input.recipientCommitment.toLowerCase()) {
    throw new Error("Cannot send message to yourself");
  }
  if (!input.body || input.body.length === 0) {
    throw new Error("Message body is required");
  }
  if (input.body.length > 10000) {
    throw new Error("Message body too long (max 10000 chars)");
  }

  // Verify sender is enrolled
  const senderEnrolled = await deps.isEnrolled(input.senderCommitment);
  if (!senderEnrolled) {
    throw new Error("Sender is not enrolled");
  }

  // Verify recipient is enrolled (can't message unregistered agents)
  const recipientEnrolled = await deps.isEnrolled(input.recipientCommitment);
  if (!recipientEnrolled) {
    throw new Error("Recipient is not enrolled");
  }

  // Verify signature format
  if (!HEX128_RE.test(input.signature)) {
    throw new Error("Invalid signature format");
  }

  // Resolve sender's public key
  const publicKey = await deps.resolvePublicKey(input.senderCommitment);
  if (!publicKey) {
    throw new Error("Sender public key not found");
  }

  // Verify the signature
  const timestamp = input.timestamp || new Date().toISOString();
  const digest = computeMessageDigest({
    senderCommitment: input.senderCommitment,
    recipientCommitment: input.recipientCommitment,
    body: input.body,
    subject: input.subject,
    replyToId: input.replyToId,
    timestamp,
  });
  const sigValid = await deps.verifySignature(digest, input.signature, publicKey);
  if (!sigValid) {
    throw new Error("Invalid signature");
  }

  // Save the message
  return deps.saveMessage({
    ...input,
    subject: input.subject,
  });
}

/**
 * Gets all conversations for an agent (unique counterparties).
 */
export async function getConversations(
  commitment: string,
  deps: Pick<MessengerDeps, "getMessages" | "getUnreadCount">
): Promise<ConversationResult[]> {
  const messages = await deps.getMessages(commitment, 100, 0);

  // Group by counterparty
  const counterparties = new Set<string>();
  for (const msg of messages) {
    if (msg.senderCommitment !== commitment) {
      counterparties.add(msg.senderCommitment);
    }
    if (msg.recipientCommitment !== commitment) {
      counterparties.add(msg.recipientCommitment);
    }
  }

  const conversations: ConversationResult[] = [];
  for (const cp of counterparties) {
    const convMessages = messages.filter(
      (m) =>
        (m.senderCommitment === commitment && m.recipientCommitment === cp) ||
        (m.senderCommitment === cp && m.recipientCommitment === commitment)
    );
    const unreadCount = convMessages.filter(
      (m) => m.recipientCommitment === commitment && m.status !== "read"
    ).length;

    conversations.push({
      withCommitment: cp,
      messages: convMessages,
      unreadCount,
    });
  }

  conversations.sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.createdAt || "";
    const bLast = b.messages[b.messages.length - 1]?.createdAt || "";
    return bLast.localeCompare(aLast);
  });

  return conversations;
}