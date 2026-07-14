import {
  DECISION_MUTATION_MAX_BYTES,
  WorkspaceHttpError,
  parseDecisionMutationBody,
} from "../../../../../../../../../dist/workspace/http.js";
import {
  SEEDED_POLICY_ID,
  getSeededWorkspaceStore,
  getSessionPolicyId,
} from "../../../../../../../../lib/policy-workspace-store";
import {
  assertWorkspaceMutationRequest,
  readWorkspaceMutationBody,
  requireWorkspaceSession,
  workspaceErrorResponse,
  workspaceJson,
} from "../../../../../../../../lib/workspace-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function versionNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new WorkspaceHttpError(400, "INVALID_REQUEST", "Policy version is invalid.");
  }
  return parsed;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ policyId: string; version: string; ambiguityId: string }> },
) {
  try {
    const { policyId, version, ambiguityId } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) {
      return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    }
    assertWorkspaceMutationRequest(request);
    const sessionToken = requireWorkspaceSession(request);
    const body = parseDecisionMutationBody(
      await readWorkspaceMutationBody(request, DECISION_MUTATION_MAX_BYTES),
    );
    const store = getSeededWorkspaceStore();
    const internalPolicyId = getSessionPolicyId(store, sessionToken);
    const release = store.mutationGate.tryAcquire();
    if (!release) {
      return workspaceJson({ error: "WORKSPACE_BUSY" }, 409);
    }
    try {
      const result = store.service.resolveAmbiguity({
        policyId: internalPolicyId,
        expectedVersion: versionNumber(version),
        ambiguityId,
        selectedOptionId: body.selectedOptionId,
        decidedAt: new Date().toISOString(),
      });
      return workspaceJson({ schemaVersion: "1", ...result });
    } finally {
      release();
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
