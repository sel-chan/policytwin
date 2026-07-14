import {
  SOURCE_MUTATION_MAX_BYTES,
  WorkspaceHttpError,
  parseSourceMutationBody,
} from "../../../../../../../dist/workspace/http.js";
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
import { seededChangeImpactContract } from "../../../../../../lib/change-impact-contract";
import { policyMeaningFingerprint } from "../../../../../../lib/policy-meaning";

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
  context: { params: Promise<{ policyId: string; version: string }> },
) {
  try {
    const { policyId, version } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) {
      return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    }
    assertWorkspaceMutationRequest(request);
    const sessionToken = requireWorkspaceSession(request);
    const body = parseSourceMutationBody(
      await readWorkspaceMutationBody(request, SOURCE_MUTATION_MAX_BYTES),
    );
    const expectedVersion = versionNumber(version);
    const impactContract = seededChangeImpactContract();
    if (
      expectedVersion !== impactContract.impact.fromVersion ||
      body.sourceText !== impactContract.changedSourceText
    ) {
      throw new WorkspaceHttpError(
        409,
        "REFERENCE_POLICY_MISMATCH",
        "Source mutation does not match the seeded change-impact contract.",
      );
    }
    const store = getSeededWorkspaceStore();
    const internalPolicyId = getSessionPolicyId(store, sessionToken);
    const release = store.mutationGate.tryAcquire();
    if (!release) {
      return workspaceJson({ error: "WORKSPACE_BUSY" }, 409);
    }
    try {
      const before = store.service.getWorkspace(internalPolicyId);
      const parent = store.repository.getVersion(internalPolicyId, expectedVersion);
      if (
        !parent?.policyIR ||
        policyMeaningFingerprint(parent.policyIR) !== impactContract.referencePolicyMeaning
      ) {
        throw new WorkspaceHttpError(
          409,
          "REFERENCE_POLICY_MISMATCH",
          "Policy meaning does not match the seeded reference proof.",
        );
      }
      const idempotent =
        before.project.currentVersion === expectedVersion + 1 &&
        before.currentVersion.parentVersion === expectedVersion &&
        before.currentVersion.policyIR === null &&
        before.currentVersion.sourceText === body.sourceText;
      const workspace = store.service.createPolicyTextVersion({
        policyId: internalPolicyId,
        expectedVersion,
        sourceText: body.sourceText,
        createdAt: new Date().toISOString(),
      });
      return workspaceJson({ schemaVersion: "1", workspace, idempotent });
    } finally {
      release();
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
