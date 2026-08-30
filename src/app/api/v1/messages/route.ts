import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";
import { checkInMemoryRateLimit, clientIpFromRequest } from "@/lib/rateLimit";
import { verify } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import "@/lib/receipt/crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/messages — send a signed message to another agent.
 * GET /api/v1/messages — get inbox for the authenticated agent.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = checkInMemoryRateLimit(`messages:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    sender_commitment?: string;
    recipient_commitment?: string;
    subject?: string;
    body?: string;
    signature?: string;
    reply_to_id?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate
  if (!body.sender_commitment || !body.recipient_commitment || !body.body || !body.signature) {
    return NextResponse.json(
      { error: "Missing required fields: sender_commitment, recipient_commitment, body, signature" },
      { status: 400 }
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(body.sender_commitment)) {
    return NextResponse.json({ error: "Invalid sender commitment" }, { status: 400 });
  }
  if (!/^[0-9a-f]{64}$/i.test(body.recipient_commitment)) {
    return NextResponse.json({ error: "Invalid recipient commitment" }, { status: 400 });
  }

  // Verify sender matches authenticated operator
  const callerAgents = await prisma.agent.findMany({
    where: { operatorId: operator.id },
    select: { agentId: true },
  });
  const isCaller = callerAgents.some((a) => a.agentId.toLowerCase() === body.sender_commitment!.toLowerCase());
  if (!isCaller) {
    return NextResponse.json({ error: "Forbidden: can only send as your own agent" }, { status: 403 });
  }

  // Verify Ed25519 signature
  const enrollment = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: body.sender_commitment.toLowerCase() },
    select: { publicKey: true, status: true },
  });
  if (!enrollment || enrollment.status !== "ISSUED") {
    return NextResponse.json({ error: "Sender not enrolled" }, { status: 403 });
  }

  const timestamp = new Date().toISOString();
  const canonical = JSON.stringify(
    { senderCommitment: body.sender_commitment, recipientCommitment: body.recipient_commitment, body: body.body, subject: body.subject, replyToId: body.reply_to_id, timestamp },
    Object.keys({ senderCommitment: "", recipientCommitment: "", body: "", subject: "", replyToId: "", timestamp: "" }).sort()
  );
  const digest = bytesToHex(sha256(utf8ToBytes(canonical)));

  let sigValid = false;
  try {
    sigValid = await verify(hexToBytes(body.signature), hexToBytes(digest), hexToBytes(enrollment.publicKey));
  } catch {}
  if (!sigValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Check recipient exists
  const recipient = await prisma.agentEnrollment.findUnique({
    where: { subjectCommitment: body.recipient_commitment.toLowerCase() },
    select: { status: true },
  });
  if (!recipient || recipient.status !== "ISSUED") {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  // Create message
  const messageId = `msg_${bytesToHex(crypto.getRandomValues(new Uint8Array(16)))}`;
  const message = await prisma.agentMessage.create({
    data: {
      messageId,
      senderCommitment: body.sender_commitment.toLowerCase(),
      recipientCommitment: body.recipient_commitment.toLowerCase(),
      subject: body.subject?.slice(0, 200) || null,
      body: body.body.slice(0, 10000),
      signature: body.signature,
      algorithm: "ed25519",
      replyToId: body.reply_to_id || null,
      encrypted: false,
    },
  });

  return NextResponse.json({
    message_id: message.messageId,
    sender_commitment: message.senderCommitment,
    recipient_commitment: message.recipientCommitment,
    subject: message.subject,
    status: "sent",
    created_at: message.createdAt.toISOString(),
  }, { status: 201 });
}

/**
 * GET /api/v1/messages — get all messages for the authenticated agent.
 * Query params: limit (default 50), offset (default 0), unread_only (bool)
 */
export async function GET(request: NextRequest) {
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const unreadOnly = searchParams.get("unread_only") === "true";

  const agentIds = (await prisma.agent.findMany({
    where: { operatorId: operator.id },
    select: { agentId: true },
  })).map((a) => a.agentId);

  if (agentIds.length === 0) {
    return NextResponse.json({ messages: [], total: 0, unread: 0, conversations: [] });
  }

  const where = {
    OR: agentIds.map((id) => ({
      OR: [
        { recipientCommitment: id },
        { senderCommitment: id },
      ],
    })),
    ...(unreadOnly ? { readAt: null, recipientCommitment: { in: agentIds } } : {}),
  };

  const [messages, total, unread] = await Promise.all([
    prisma.agentMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.agentMessage.count({ where }),
    prisma.agentMessage.count({
      where: { recipientCommitment: { in: agentIds }, readAt: null },
    }),
  ]);

  // Build conversations
  const counterparties = new Set<string>();
  for (const msg of messages) {
    for (const id of agentIds) {
      if (msg.senderCommitment !== id) counterparties.add(msg.senderCommitment);
      if (msg.recipientCommitment !== id) counterparties.add(msg.recipientCommitment);
    }
  }

  const conversations = Array.from(counterparties).map((cp) => {
    const convMsgs = messages.filter(
      (m) =>
        (m.senderCommitment === cp && agentIds.includes(m.recipientCommitment)) ||
        (m.recipientCommitment === cp && agentIds.includes(m.senderCommitment))
    );
    const unreadCount = convMsgs.filter(
      (m) => m.recipientCommitment && agentIds.includes(m.recipientCommitment) && m.readAt === null
    ).length;
    return {
      with_commitment: cp,
      message_count: convMsgs.length,
      unread_count: unreadCount,
      last_message_at: convMsgs[0]?.createdAt?.toISOString() || null,
      last_message_preview: convMsgs[0]?.body?.slice(0, 100) || null,
    };
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      message_id: m.messageId,
      sender_commitment: m.senderCommitment,
      recipient_commitment: m.recipientCommitment,
      subject: m.subject,
      body: m.body,
      signature: m.signature,
      algorithm: m.algorithm,
      reply_to_id: m.replyToId,
      encrypted: m.encrypted,
      status: m.readAt ? "read" : m.createdAt ? "delivered" : "sent",
      created_at: m.createdAt.toISOString(),
    })),
    total,
    unread,
    conversations,
  });
}