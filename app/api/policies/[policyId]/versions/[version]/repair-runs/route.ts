import { WorkspaceHttpError } from "../../../../../../../dist/workspace/http.js";
import { RepairRunPersistenceError } from "../../../../../../../dist/repair-runs/sqlite.js";
import {
  SEEDED_POLICY_ID,
  getSeededWorkspaceStore,
  getSessionPolicyId,
} from "../../../../../../lib/policy-workspace-store";
import {
  assertWorkspaceMutationRequest,
  readWorkspaceMutationBody,
  requireWorkspaceSession,
  workspaceErrorResponse,
  workspaceJson,
} from "../../../../../../lib/workspace-http";
import {
  SeededRepairRunInputError,
  buildSeededRepairWorkerInput,
} from "../../../../../../lib/repair-run-input";
import { repairRunSessionSha256 } from "../../../../../../../dist/repair-runs/coordinator.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512;
const CLIENT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function versionNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Policy version is invalid.");
  }
  return parsed;
}

function clientRequestId(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "clientRequestId" ||
    !("clientRequestId" in value) ||
    typeof value.clientRequestId !== "string" ||
    !CLIENT_REQUEST_ID.test(value.clientRequestId)
  ) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Repair-run request ID is invalid.");
  }
  return value.clientRequestId;
}

function mappedError(error: unknown): Response {
  if (error instanceof SeededRepairRunInputError) {
    const status = error.code === "EVIDENCE_INPUT_INVALID" ? 500 : 409;
    return workspaceJson({ error: error.code }, status);
  }
  if (error instanceof RepairRunPersistenceError) {
    const mapping: Record<string, { status: number; code: string }> = {
      IDEMPOTENCY_CONFLICT: { status: 409, code: "REPAIR_RUN_IDEMPOTENCY_CONFLICT" },
      RUN_BUSY: { status: 409, code: "REPAIR_RUN_BUSY" },
      RUN_CAPACITY: { status: 429, code: "REPAIR_RUN_CAPACITY" },
      RUN_NOT_FOUND: { status: 404, code: "REPAIR_RUN_NOT_FOUND" },
      INVALID_INPUT: { status: 400, code: "INVALID_REQUEST" },
    };
    const mapped = mapping[error.code];
    if (mapped) {
      const response = workspaceJson({ error: mapped.code }, mapped.status);
      if (error.code === "RUN_CAPACITY") response.headers.set("Retry-After", "86400");
      return response;
    }
  }
  return workspaceErrorResponse(error);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ policyId: string; version: string }> },
) {
  try {
    const { policyId, version } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    const expectedVersion = versionNumber(version);
    const sessionToken = requireWorkspaceSession(request);
    const store = getSeededWorkspaceStore();
    const internalPolicyId = getSessionPolicyId(store, sessionToken);
    store.repairRunRepository.reconcileExpiredExecutorLease(new Date().toISOString());
    const run = store.repairRunRepository.getLatestRunForSession(
      repairRunSessionSha256(sessionToken),
    );
    if (run && (run.policyId !== internalPolicyId || run.policyVersion !== expectedVersion)) {
      return workspaceJson({ schemaVersion: "1", run: null, events: [] });
    }
    const events = run
      ? store.repairRunRepository.listEventsForSession(
          run.id,
          repairRunSessionSha256(sessionToken),
        )
      : [];
    return workspaceJson({ schemaVersion: "1", run, events });
  } catch (error) {
    return mappedError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ policyId: string; version: string }> },
) {
  try {
    const { policyId, version } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    assertWorkspaceMutationRequest(request);
    const sessionToken = requireWorkspaceSession(request);
    const requestId = clientRequestId(await readWorkspaceMutationBody(request, MAX_BODY_BYTES));
    const expectedVersion = versionNumber(version);
    const store = getSeededWorkspaceStore();
    const internalPolicyId = getSessionPolicyId(store, sessionToken);
    const release = store.mutationGate.tryAcquire();
    if (!release) return workspaceJson({ error: "WORKSPACE_BUSY" }, 409);
    try {
      const workspace = store.service.getWorkspace(internalPolicyId);
      if (workspace.project.currentVersion !== expectedVersion) {
        throw new WorkspaceHttpError(409, "STALE_VERSION", "Policy version changed before repair.");
      }
      const versionRecord = store.repository.getVersion(internalPolicyId, expectedVersion);
      if (!versionRecord) {
        return workspaceJson({ error: "VERSION_NOT_FOUND" }, 404);
      }
      const started = store.repairRunCoordinator.start({
        clientRequestId: requestId,
        sessionToken,
        input: buildSeededRepairWorkerInput(versionRecord),
      });
      const events = store.repairRunRepository.listEventsForSession(
        started.run.id,
        repairRunSessionSha256(sessionToken),
      );
      return workspaceJson(
        { schemaVersion: "1", run: started.run, events, created: started.created },
        started.created ? 201 : 200,
      );
    } finally {
      release();
    }
  } catch (error) {
    return mappedError(error);
  }
}
