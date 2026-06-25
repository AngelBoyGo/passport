/**
 * Closed-loop traction harness: MCP anchor -> fault capture -> DB assert -> gate query.
 * Run: npx tsx scripts/traction-harness.ts
 *
 * Requires PASSPORT_BASE_URL, PASSPORT_API_KEY, PASSPORT_OPERATOR_ID, DATABASE_URL.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassportClient } from "../sdk/dist/index.mjs";
import { withFaultCapture } from "../mcp/dist/faultWrapper.js";
import { generateAgentId } from "../mcp/dist/mappings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const mcpRequire = createRequire(path.join(ROOT, "mcp", "package.json"));

const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = mcpRequire(
  "@modelcontextprotocol/sdk/client/stdio.js"
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const SEED_AGENT_ID = "traction-seed-agent";
const SEED_RECEIPT_COUNT = 8;

/**
 * Seeds clean domain history so gate allows anchor (blank-sheet penalty)
 * and one subsequent fault pushes failure rate above the 10% threshold.
 */
async function seedGateHistory(
  operatorDbId: string,
  databaseUrl: string,
  domain: "CODE_GENERATION"
) {
  const { ErrorTranche, OperationalDomain, PrismaClient } = await import(
    "@prisma/client"
  );
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const agent = await prisma.agent.upsert({
      where: {
        operatorId_agentId: { operatorId: operatorDbId, agentId: SEED_AGENT_ID },
      },
      create: {
        operatorId: operatorDbId,
        agentId: SEED_AGENT_ID,
        domain: "traction-seed",
      },
      update: {},
    });

    await prisma.receipt.deleteMany({
      where: { operatorId: operatorDbId, domain: OperationalDomain[domain] },
    });

    for (let i = 0; i < SEED_RECEIPT_COUNT; i++) {
      const suffix = `seed_${i}`;
      const now = new Date(Date.now() - i * 1000);
      await prisma.receipt.create({
        data: {
          receiptId: `rcpt_traction_${suffix}`,
          operatorId: operatorDbId,
          agentId: SEED_AGENT_ID,
          agentRecordId: agent.id,
          receiptType: "competence",
          status: "success",
          inputDigest: `digest_${suffix}`,
          authorityScope: "traction.seed",
          expiry: new Date(now.getTime() + 86_400_000),
          contentHash: `hash_${suffix}`,
          finalizedAt: now,
          issuedAt: now,
          domain: OperationalDomain[domain],
          errorTranche: ErrorTranche.NONE,
        },
      });
    }

    console.log(
      `[traction] Seeded ${SEED_RECEIPT_COUNT} clean ${domain} receipts for gate bootstrap`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const baseUrl = requireEnv("PASSPORT_BASE_URL");
  const apiKey = requireEnv("PASSPORT_API_KEY");
  const operatorId = requireEnv("PASSPORT_OPERATOR_ID");
  const operatorDbId = requireEnv("PASSPORT_OPERATOR_DB_ID");
  const databaseUrl = requireEnv("DATABASE_URL");

  const expectedAgentId = generateAgentId();
  const domain = "CODE_GENERATION" as const;

  await seedGateHistory(operatorDbId, databaseUrl, domain);

  const mcpServerPath = path.join(ROOT, "mcp", "dist", "server.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpServerPath],
    env: {
      ...process.env,
      PASSPORT_BASE_URL: baseUrl,
      PASSPORT_API_KEY: apiKey,
    },
    cwd: ROOT,
  });

  const mcpClient = new Client({
    name: "traction-harness",
    version: "0.1.0",
  });

  await mcpClient.connect(transport);

  console.log("[traction] Calling passport_anchor_task via MCP...");
  const anchorResponse = await mcpClient.callTool({
    name: "passport_anchor_task",
    arguments: {
      domain,
      inputDigest: "traction-harness-input",
      scope: "traction.harness",
    },
  });

  if (anchorResponse.isError) {
    const errText =
      anchorResponse.content?.[0]?.type === "text"
        ? anchorResponse.content[0].text
        : "unknown MCP error";
    throw new Error(`passport_anchor_task failed: ${errText}`);
  }

  const anchorText = anchorResponse.content?.[0];
  if (!anchorText || anchorText.type !== "text") {
    throw new Error("Unexpected anchor tool response");
  }

  const anchored = JSON.parse(anchorText.text) as { receipt_id: string };
  const receiptId = anchored.receipt_id;
  console.log("[traction] Anchored receipt:", receiptId);

  const passportClient = new PassportClient({ apiKey, baseUrl });

  console.log("[traction] Running fault capture (intentional TypeError)...");
  try {
    await withFaultCapture(passportClient, receiptId, async () => {
      throw new TypeError("traction harness intentional failure");
    });
  } catch {
    // expected rethrow
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const row = await prisma.receipt.findUnique({
      where: { receiptId },
    });

    if (!row) {
      throw new Error(`Receipt ${receiptId} not found in database`);
    }

    console.log("[traction] Persisted row:", {
      receiptType: row.receiptType,
      errorTranche: row.errorTranche,
      agentId: row.agentId,
      domain: row.domain,
    });

    if (row.receiptType !== "competence") {
      throw new Error(`Expected receiptType competence, got ${row.receiptType}`);
    }

    if (row.errorTranche !== "LOGIC_DETECTION") {
      throw new Error(
        `Expected errorTranche LOGIC_DETECTION, got ${row.errorTranche}`
      );
    }

    if (row.agentId !== expectedAgentId) {
      throw new Error(
        `Expected agentId ${expectedAgentId}, got ${row.agentId}`
      );
    }

    const expiryMs = row.expiry.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const delta = expiryMs - row.issuedAt.getTime();
    if (Math.abs(delta - thirtyDaysMs) > 60_000) {
      throw new Error(
        `Expected expiry ~30d from issuedAt, deltaMs=${delta}`
      );
    }

    console.log("[traction] DB assertions passed");
  } finally {
    await prisma.$disconnect();
  }

  console.log("[traction] Calling passport_query_gate via MCP...");
  const gateResponse = await mcpClient.callTool({
    name: "passport_query_gate",
    arguments: {
      operatorId,
      domain,
    },
  });

  const gateText = gateResponse.content?.[0];
  if (!gateText || gateText.type !== "text") {
    throw new Error("Unexpected gate tool response");
  }

  const gate = JSON.parse(gateText.text) as {
    allow_invocation: boolean;
    reason?: string;
  };

  console.log("[traction] Gate result:", gate);

  if (gate.allow_invocation !== false) {
    throw new Error(
      `Expected gate deny after fault, got allow_invocation=${gate.allow_invocation}`
    );
  }

  await mcpClient.close();
  console.log("[traction] All checks passed");
}

main().catch((err) => {
  console.error("[traction] FAILED:", err);
  process.exit(1);
});
