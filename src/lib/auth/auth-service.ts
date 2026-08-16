import { prisma } from "@/lib/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password: string): string {
  const iterations = 100_000;
  let hash = password;
  for (let i = 0; i < iterations; i++) {
    hash = bytesToHex(sha256(utf8ToBytes(hash + "passport_salt_" + i)));
  }
  return hash;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  return hashPassword(password) === storedHash;
}

export function hashEmail(email: string): string {
  return bytesToHex(sha256(utf8ToBytes(email.toLowerCase().trim())));
}

function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = bytesToHex(sha256(bytes));
  const secret = process.env.SESSION_SECRET || "dev-session-secret";
  const signature = bytesToHex(sha256(utf8ToBytes(raw + secret)));
  return "sess_" + raw + signature;
}

function verifySessionTokenSignature(token: string): boolean {
  if (!token.startsWith("sess_")) return false;
  const raw = token.slice(5, 69);
  const sig = token.slice(69);
  const secret = process.env.SESSION_SECRET || "dev-session-secret";
  const expected = bytesToHex(sha256(utf8ToBytes(raw + secret)));
  return sig === expected;
}

export async function createSession(operatorId: string) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { operatorId, token, expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionFromToken(token: string) {
  if (!verifySessionTokenSignature(token)) {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { token },
    include: { operator: true },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } });
    }
    return null;
  }
  return session;
}

/**
 * Resolves a session from every session_token cookie the browser sent.
 *
 * Browsers can hold multiple cookies with the same name (host-only vs
 * Domain-scoped, differing paths from older deployments). The first cookie
 * in the header can be a stale token that shadows a freshly-issued one,
 * producing a login loop. Trying every candidate makes login resilient to
 * stale-cookie shadowing.
 */
export async function resolveSessionFromTokens(tokens: string[]) {
  for (const token of tokens) {
    const session = await getSessionFromToken(token);
    if (session) {
      return session;
    }
  }
  return null;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { token } });
}

export async function signup(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.operator.findFirst({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return { error: "Email already registered" };
  }

  const stripeCustomerId = `cus_${hashEmail(normalizedEmail).slice(0, 24)}`;
  const passwordHash = hashPassword(password);

  const operator = await prisma.operator.create({
    data: {
      stripeCustomerId,
      email: normalizedEmail,
      passwordHash,
    },
  });

  return { operator };
}

export async function login(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const operator = await prisma.operator.findFirst({
    where: { email: normalizedEmail },
  });

  if (!operator || !operator.passwordHash) {
    return { error: "Invalid email or password" };
  }

  if (!verifyPassword(password, operator.passwordHash)) {
    return { error: "Invalid email or password" };
  }

  return { operator };
}