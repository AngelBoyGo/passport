import { NextRequest } from "next/server";
import { sessionFromRequest } from "@/lib/auth/cookies";
import { isExecutiveAdmin } from "@/lib/admin/admin-auth";
import { prisma } from "@/lib/db";
import { buildCommandCenterData } from "@/lib/brain/command-center-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brain/stream — real-time Server-Sent Events (SSE) stream for the AI Command Brain.
 * Streams live state updates, next-cycle countdown, and heartbeats to the executive dashboard.
 */
export async function GET(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isExecutiveAdmin(session.operator)) {
    return new Response("Forbidden: executive admin required", { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let isClosed = false;
  let lastSeenMemoryId: string | null = null;

  async function sendEvent(event: string, payload: unknown) {
    if (isClosed) return;
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      await writer.write(encoder.encode(message));
    } catch {
      isClosed = true;
    }
  }

  // Send initial full snapshot immediately
  (async () => {
    try {
      const initialData = await buildCommandCenterData();
      const latestRow = await prisma.brainMemory.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      lastSeenMemoryId = latestRow?.id ?? null;
      await sendEvent("snapshot", initialData);
    } catch (err) {
      console.warn("[brain-stream] Initial snapshot error:", err);
    }
  })();

  const intervalId = setInterval(async () => {
    if (isClosed) {
      clearInterval(intervalId);
      return;
    }

    try {
      const now = Date.now();
      const tenMinMs = 10 * 60 * 1000;
      const nextCycleMs = Math.ceil(now / tenMinMs) * tenMinMs;
      const secondsUntilNext = Math.max(0, Math.round((nextCycleMs - now) / 1000));

      // Check if a new brain memory row was created since last check
      const latestRow = await prisma.brainMemory.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (latestRow && latestRow.id !== lastSeenMemoryId) {
        lastSeenMemoryId = latestRow.id;
        const freshData = await buildCommandCenterData();
        await sendEvent("update", freshData);
      } else {
        // Send heartbeat & countdown tick
        await sendEvent("heartbeat", {
          secondsUntilNext,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // transient read error; send basic heartbeat
      await sendEvent("heartbeat", { timestamp: new Date().toISOString() });
    }
  }, 3000);

  request.signal.addEventListener("abort", () => {
    isClosed = true;
    clearInterval(intervalId);
    writer.close().catch(() => {});
  });

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
