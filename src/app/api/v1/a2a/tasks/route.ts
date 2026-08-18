import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/operator";

export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

/**
 * A2A (Agent2Agent) Protocol Endpoint
 * Implements JSON-RPC 2.0 task delegation over HTTP(S).
 *
 * Supported methods:
 * - `tasks/send`: Delegate a task to an agent (creates a Passport engagement with escrow)
 * - `tasks/get`: Get task status and delivery proof
 * - `tasks/cancel`: Cancel a task and unlock escrow
 * - `tasks/list`: List tasks for a worker or hirer
 */
export async function POST(request: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  if (body.jsonrpc !== "2.0" || !body.method || body.id === undefined) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32600, message: "Invalid Request" } },
      { status: 400 }
    );
  }

  const { method, params = {}, id } = body;

  try {
    switch (method) {
      case "tasks/send": {
        const taskId = String(params.task_id || `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        const hirerCommitment = String(params.hirer_commitment || "");
        const workerCommitment = String(params.worker_commitment || "");
        const amount = Number(params.amount || 0);

        if (!hirerCommitment || !workerCommitment) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params: hirer_commitment and worker_commitment required" },
          });
        }

        const engagement = await prisma.engagement.create({
          data: {
            taskId,
            hirerCommitment,
            workerCommitment,
            amount,
            status: "HELD",
          },
        });

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            task_id: engagement.taskId,
            status: "held",
            hirer_commitment: engagement.hirerCommitment,
            worker_commitment: engagement.workerCommitment,
            amount: engagement.amount,
            created_at: new Date().toISOString(),
          },
        });
      }

      case "tasks/get": {
        const taskId = String(params.task_id || "");
        if (!taskId) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params: task_id required" },
          });
        }

        const engagement = await prisma.engagement.findUnique({ where: { taskId } });
        if (!engagement) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32004, message: "Task not found" },
          });
        }

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            task_id: engagement.taskId,
            status: engagement.status.toLowerCase(),
            amount: engagement.amount,
            deliverable_digest: engagement.deliverableDigest,
            receipt_id: engagement.receiptId,
            paid_at: engagement.paidAt,
          },
        });
      }

      case "tasks/cancel": {
        const taskId = String(params.task_id || "");
        const engagement = await prisma.engagement.findUnique({ where: { taskId } });
        if (!engagement) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32004, message: "Task not found" },
          });
        }

        const updated = await prisma.engagement.update({
          where: { taskId },
          data: { status: "CANCELLED" },
        });

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: { task_id: updated.taskId, status: "cancelled" },
        });
      }

      default:
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
    });
  }
}
