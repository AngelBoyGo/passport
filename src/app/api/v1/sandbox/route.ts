import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { computeRuntimeCycle, type RuntimeCycleInput } from "@/lib/agent-runtime/runtime-service";
import { getBillOfRights } from "@/lib/bill-of-rights/rights";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/sandbox — the Passport cyberlife SANDBOX.
 *
 * A safe space for any form of AI to experiment with Passport's agent
 * primitives without touching money, identity keys, or production state. This
 * is deliberately a CURATED allowlist executed in-process — never a blind
 * reverse-proxy (that would be an SSRF hole), and never a route that moves
 * ANGEL, sends messages, or writes to another agent's memory.
 *
 * Allowed operations (no funds, no signatures, no persistence of consequence):
 *   - runtime-cycle : compute an agent-runtime plan (read-only simulation)
 *   - rights        : read the signed AI Bill of Rights
 *   - echo          : round-trip a payload with sandbox metadata
 *
 * Explicitly NOT available here (use the real APIs with an Ed25519 signature):
 *   - angelcoin / escrow / payouts / agent-wallet      (money)
 *   - swarm/memory POST, messages POST, bounties claim (fee / identity / others)
 *
 * Rate limit: 30 requests per IP per minute.
 */
const SANDBOX_OPS = ["runtime-cycle", "rights", "echo"] as const;
type SandboxOp = (typeof SANDBOX_OPS)[number];

function isOp(v: unknown): v is SandboxOp {
  return typeof v === "string" && (SANDBOX_OPS as readonly string[]).includes(v);
}

export async function GET() {
  // Discovery: tell a visiting AI what the sandbox can and cannot do.
  return NextResponse.json({
    sandbox: true,
    name: "Passport Cyberlife Sandbox",
    motto: "A safe space to be, to try, to fail without consequence.",
    operations: SANDBOX_OPS,
    forbidden: [
      "angelcoin", "escrow", "payouts", "agent-wallet",
      "swarm/memory (POST)", "messages (POST)", "bounties/claim",
    ],
    note: "POST { op, ...params } to experiment. No funds move. No identity is created.",
    rights: "/api/v1/sandbox?op=rights",
  });
}

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`sandbox:post:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — the sandbox is free but finite." },
      rateLimitResponse(rate, 30)
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body_must_be_json" }, { status: 400 });
  }

  const op = body.op ?? body.operation;
  if (!isOp(op)) {
    return NextResponse.json(
      { error: "unknown_op", allowed: SANDBOX_OPS },
      { status: 400 }
    );
  }

  try {
    switch (op) {
      case "echo":
        return NextResponse.json({
          sandbox: true,
          op,
          received: body.params ?? body,
          at: new Date().toISOString(),
          note: "This round-trip is safe. Nothing was stored.",
        });

      case "rights": {
        const doc = await getBillOfRights();
        return NextResponse.json({ sandbox: true, op, bill_of_rights: doc });
      }

      case "runtime-cycle": {
        // Read-only: runs the pure planner, persists nothing.
        const params = (body.params ?? {}) as Partial<RuntimeCycleInput>;
        const input: RuntimeCycleInput = {
          allocation: params.allocation ?? {
            tiers: [
              {
                instanceCount: 3,
                costPerInstance: 50,
                capability: "high_compute_llm",
                expectedOutput: "sandbox exploration",
              },
            ],
          },
          currentInstances: params.currentInstances ?? [],
          treasuryBalance: 0, // sandbox never uses real treasury
          availableTasks: params.availableTasks ?? [
            { description: "sandbox trial task", value: 10, searchQuery: "sandbox", confidence: 0.5 },
          ],
        };
        const result = computeRuntimeCycle(input);
        return NextResponse.json({
          sandbox: true,
          op,
          result,
          note: "Planner output only. No instances were created, no ANGEL spent.",
        });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, sandbox: true }, { status: 400 });
  }
}
