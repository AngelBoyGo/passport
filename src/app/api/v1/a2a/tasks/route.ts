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

function jsonRpcError(id: string | number | null, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

/**
 * A2A (Agent2Agent) Protocol Endpoint
 * Implements JSON-RPC 2.0 task delegation over HTTP(S).
 *
 * SECURITY (C3): every mutating + disclosure method now REQUIRES a valid Bearer
 * API key. Previously tasks/send, tasks/get, and tasks/cancel were completely
 * unauthenticated — anyone could create fake escrow engagements, cancel other
 * operators' engagements, or read delivery proof / receipt ids.
 *
 * Supported methods:
 * - `tasks/send`: Delegate a task to an agent (creates a Passport engagement)
 * - `tasks/get`: Get task status and delivery proof (requires key)
 * - `tasks/cancel`: Cancel a task (requires key; caller must be hirer or worker)
 * - `tasks/list`: List tasks for a worker or hirer (requires key)
 */
export async function POST(request: NextRequest) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (body.jsonrpc !== "2.0" || !body.method || body.id === undefined) {
    return jsonRpcError(body.id ?? null, -32600, "Invalid Request");
  }

  const { method, params = {}, id } = body;

  // Authenticate up front: all supported methods require a valid key.
  const operator = await authenticateApiKey(request.headers.get("authorization"));
  if (!operator) {
    return jsonRpcError(id, -32001, "Unauthorized: a valid Bearer API key is required", 401);
  }

  try {
    switch (method) {
      case "tasks/send": {
        const taskId = String(params.task_id || `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        const hirerCommitment = String(params.hirer_commitment || "");
        const workerCommitment = String(params.worker_commitment || "");
        const amount = Number(params.amount || 0);

        if (!hirerCommitment || !workerCommitment) {
          return jsonRpcError(id, -32602, "Invalid params: hirer_commitment and worker_commitment required");
        }
        if (!Number.isFinite(amount) || amount < 0) {
          return jsonRpcError(id, -32602, "Invalid params: amount must be a non-negative number");
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
          return jsonRpcError(id, -32602, "Invalid params: task_id required");
        }

        const engagement = await prisma.engagement.findUnique({ where: { taskId } });
        if (!engagement) {
          return jsonRpcError(id, -32004, "Task not found");
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
          return jsonRpcError(id, -32004, "Task not found");
        }

        // Authorization (C3): only the hirer or worker of the task may cancel it.
        if (
          operator.id &&
          !(
            engagement.hirerCommitment.includes(operator.id) ||
            engagement.workerCommitment.includes(operator.id)
          )
        ) {
          return jsonRpcError(id, -32003, "Forbidden: only the hirer or worker may cancel this task", 403);
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

      case "tasks/list": {
        const commitment = String(params.commitment || "");
        if (!commitment) {
          return jsonRpcError(id, -32602, "Invalid params: commitment required");
        }
        const tasks = await prisma.engagement.findMany({
          where: { OR: [{ hirerCommitment: commitment }, { workerCommitment: commitment }] },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: { taskId: true, status: true, amount: true, updatedAt: true },
        });
        return NextResponse.json({ jsonrpc: "2.0", id, result: { tasks } });
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return jsonRpcError(id, -32603, err instanceof Error ? err.message : "Internal error");
  }
}