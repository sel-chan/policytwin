import {
  SEEDED_POLICY_ID,
  ensureSeededSessionWorkspace,
  getLatestValidatedVersion,
  getSeededWorkspaceStore,
} from "../../../../lib/policy-workspace-store";
import {
  attachWorkspaceCookies,
  issueWorkspaceCsrf,
  issueWorkspaceSession,
  workspaceErrorResponse,
  workspaceJson,
} from "../../../../lib/workspace-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ policyId: string }> },
) {
  try {
    const { policyId } = await context.params;
    if (policyId !== SEEDED_POLICY_ID) {
      return workspaceJson({ error: "PROJECT_NOT_FOUND" }, 404);
    }
    const session = issueWorkspaceSession(request);
    const store = getSeededWorkspaceStore();
    const internalPolicyId = ensureSeededSessionWorkspace(store, session.token);
    const csrf = issueWorkspaceCsrf(request);
    const response = workspaceJson({
      schemaVersion: "1",
      workspace: store.service.getWorkspace(internalPolicyId),
      latestValidatedVersion: getLatestValidatedVersion(store, internalPolicyId),
      csrfToken: csrf.token,
      persistence: "SQLITE_LOCAL",
    });
    return attachWorkspaceCookies(response, request, { csrf, session });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
