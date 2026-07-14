import type { StoredPolicyVersion } from "../../dist/persistence/sqlite.js";
import type {
  PolicyWorkspaceSnapshot,
  WorkspaceResolutionResult,
} from "../../dist/workspace/service.js";

export const SEEDED_WORKSPACE_API = "/api/policies/policy-seeded-refund";

export interface WorkspaceGetResponse {
  schemaVersion: "1";
  workspace: PolicyWorkspaceSnapshot;
  latestValidatedVersion: StoredPolicyVersion;
  csrfToken: string;
  persistence: "SQLITE_LOCAL";
}

export interface WorkspaceDecisionResponse extends WorkspaceResolutionResult {
  schemaVersion: "1";
}

export interface WorkspaceSourceResponse {
  schemaVersion: "1";
  workspace: PolicyWorkspaceSnapshot;
  idempotent: boolean;
}

export class WorkspaceClientError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WorkspaceClientError";
  }
}

export function isWorkspaceClientError(error: unknown): error is WorkspaceClientError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "status" in error &&
    typeof error.status === "number"
  );
}

export function workspaceErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return null;
}

export async function workspaceResponse<T>(response: Response): Promise<T> {
  const value = (await response.json()) as { error?: unknown };
  if (!response.ok) {
    throw new WorkspaceClientError(
      typeof value.error === "string" ? value.error : "INTERNAL_ERROR",
      response.status,
    );
  }
  return value as T;
}

export function workspaceErrorMessage(error: unknown): string {
  const code = workspaceErrorCode(error);
  if (code === null) {
    return "The persisted workspace could not be reached. Try again.";
  }
  const messages: Record<string, string> = {
    STALE_VERSION: "This policy changed in another request. The latest version has been loaded.",
    GOLDEN_CONTRADICTION:
      "That choice contradicts an authoritative golden case, so no version was created.",
    DECISION_NOT_FOUND: "That decision option no longer exists in the current policy version.",
    WORKSPACE_BUSY: "Another workspace write is in progress. Try again in a moment.",
    INVALID_CSRF_TOKEN: "The workspace session expired. Reload the page before writing again.",
    FORBIDDEN_ORIGIN: "The workspace rejected a request from an untrusted origin.",
    PAYLOAD_TOO_LARGE: "The policy text is larger than the 128 KB demo limit.",
    REQUEST_TIMEOUT: "The workspace request body did not arrive within 10 seconds.",
    INVALID_SESSION: "This anonymous workspace session expired. Reload to start a new isolated demo.",
    WORKSPACE_CAPACITY:
      "The anonymous demo is at temporary capacity. Try again after an earlier session expires.",
    REFERENCE_POLICY_MISMATCH:
      "This draft requires the exact seeded reference decisions and 30-day source edit.",
  };
  return messages[code] ?? "The workspace rejected this change without modifying policy state.";
}
