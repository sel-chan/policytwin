import { WorkspaceHttpError } from "../../../../../../../../../dist/workspace/http.js";
import { RepairRunPersistenceError } from "../../../../../../../../../dist/repair-runs/sqlite.js";
import { repairRunSessionSha256 } from "../../../../../../../../../dist/repair-runs/coordinator.js";
import {
  SEEDED_POLICY_ID,
  getSeededWorkspaceStore,
  getSessionPolicyId,
} from "../../../../../../../../lib/policy-workspace-store";
import {
  requireWorkspaceSession,
  workspaceErrorResponse,
  workspaceJson,
} from "../../../../../../../../lib/workspace-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["BLOCKED", "SUCCEEDED", "FAILED", "POISONED"]);

function versionNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Policy version is invalid.");
  }
  return parsed;
}

function eventCursor(value: string | null): number {
  if (value === null || value === "") return 0;
  if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(value)) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Repair-run event cursor is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Repair-run event cursor is invalid.");
  }
  return parsed;
}

function mappedError(error: unknown): Response {
  if (error instanceof RepairRunPersistenceError) {
    if (error.code === "RUN_NOT_FOUND") {
      return workspaceJson({ error: "REPAIR_RUN_NOT_FOUND" }, 404);
    }
    if (error.code === "INVALID_INPUT") {
      return workspaceJson({ error: "INVALID_REQUEST" }, 400);
    }
  }
  return workspaceErrorResponse(error);
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ policyId: string; version: string; runId: string }>;
  },
) {
  try {
    const { policyId, version, runId } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    const expectedVersion = versionNumber(version);
    const cursor = eventCursor(request.headers.get("last-event-id"));
    const sessionToken = requireWorkspaceSession(request);
    const sessionSha256 = repairRunSessionSha256(sessionToken);
    const store = getSeededWorkspaceStore();
    const internalPolicyId = getSessionPolicyId(store, sessionToken);
    const initialRun = store.repairRunRepository.getRunForSession(runId, sessionSha256);
    if (
      !initialRun ||
      initialRun.policyId !== internalPolicyId ||
      initialRun.policyVersion !== expectedVersion
    ) {
      return workspaceJson({ error: "REPAIR_RUN_NOT_FOUND" }, 404);
    }

    const encoder = new TextEncoder();
    let closed = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatAt = Date.now();
    let nextCursor = cursor;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          if (pollTimer !== undefined) clearTimeout(pollTimer);
          try {
            controller.close();
          } catch {
            // The browser may have already cancelled the stream.
          }
        };
        const onAbort = () => close();
        request.signal.addEventListener("abort", onAbort, { once: true });
        controller.enqueue(encoder.encode("retry: 1000\n\n"));
        const poll = () => {
          if (closed || request.signal.aborted) {
            close();
            return;
          }
          try {
            const events = store.repairRunRepository.listEventsForSession(
              runId,
              sessionSha256,
              nextCursor,
              100,
            );
            for (const event of events) {
              nextCursor = event.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${event.sequence}\nevent: repair-run\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            }
            const run = store.repairRunRepository.getRunForSession(runId, sessionSha256);
            if (!run || (TERMINAL_STATUSES.has(run.status) && events.length < 100)) {
              close();
              return;
            }
            if (Date.now() - heartbeatAt >= 15_000) {
              controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
              heartbeatAt = Date.now();
            }
            pollTimer = setTimeout(poll, 250);
          } catch {
            close();
          }
        };
        poll();
      },
      cancel() {
        closed = true;
        if (pollTimer !== undefined) clearTimeout(pollTimer);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
      },
    });
  } catch (error) {
    return mappedError(error);
  }
}
