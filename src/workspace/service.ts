import { resolvePolicyAmbiguity, type PolicyDecisionRecord } from "../policy-ir/resolve.js";
import type {
  StoredPolicyProject,
  StoredPolicyVersion,
} from "../persistence/sqlite.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export interface PolicyRepositoryPort {
  appendVersion(value: unknown): StoredPolicyVersion;
  createProject(value: unknown): StoredPolicyProject;
  getProject(policyId: unknown): StoredPolicyProject | null;
  getVersion(policyId: unknown, version: unknown): StoredPolicyVersion | null;
  listDecisionRecords(policyId: unknown): PolicyDecisionRecord[];
}

export interface PolicyWorkspaceSnapshot {
  project: StoredPolicyProject;
  currentVersion: StoredPolicyVersion;
  decisionRecords: PolicyDecisionRecord[];
}

export interface PolicyTextVersionInput {
  policyId: string;
  expectedVersion: number;
  sourceText: string;
  createdAt?: string;
}

export interface ResolveWorkspaceAmbiguityInput {
  policyId: string;
  expectedVersion: number;
  ambiguityId: string;
  selectedOptionId: string;
  decidedAt?: string;
}

export interface WorkspaceResolutionResult {
  workspace: PolicyWorkspaceSnapshot;
  decisionRecord: PolicyDecisionRecord | null;
  idempotent: boolean;
}

export class PolicyWorkspaceServiceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "PROJECT_NOT_FOUND"
      | "CURRENT_VERSION_MISSING"
      | "STALE_VERSION"
      | "NOT_INTERPRETED",
    message: string,
  ) {
    super(message);
    this.name = "PolicyWorkspaceServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PolicyWorkspaceServiceError("INVALID_INPUT", `$input.${key} is not allowed.`);
    }
  }
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", `${path} is not a safe identifier.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", `${path} must be a positive integer.`);
  }
  return value;
}

function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", `${path} must be non-empty text.`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", `${path} must be an ISO-compatible time.`);
  }
  return new Date(value).toISOString();
}

function timestampOrNow(value: unknown, path: string): string {
  return value === undefined ? new Date().toISOString() : timestamp(value, path);
}

function parseTextVersionInput(value: unknown): Required<PolicyTextVersionInput> {
  if (!isRecord(value)) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", "Policy version input must be an object.");
  }
  assertKeys(value, ["policyId", "expectedVersion", "sourceText", "createdAt"]);
  return {
    policyId: identifier(value.policyId, "$input.policyId"),
    expectedVersion: positiveInteger(value.expectedVersion, "$input.expectedVersion"),
    sourceText: nonEmptyText(value.sourceText, "$input.sourceText"),
    createdAt: timestampOrNow(value.createdAt, "$input.createdAt"),
  };
}

function parseResolutionInput(value: unknown): Required<ResolveWorkspaceAmbiguityInput> {
  if (!isRecord(value)) {
    throw new PolicyWorkspaceServiceError("INVALID_INPUT", "Resolution input must be an object.");
  }
  assertKeys(value, [
    "policyId",
    "expectedVersion",
    "ambiguityId",
    "selectedOptionId",
    "decidedAt",
  ]);
  return {
    policyId: identifier(value.policyId, "$input.policyId"),
    expectedVersion: positiveInteger(value.expectedVersion, "$input.expectedVersion"),
    ambiguityId: identifier(value.ambiguityId, "$input.ambiguityId"),
    selectedOptionId: identifier(value.selectedOptionId, "$input.selectedOptionId"),
    decidedAt: timestampOrNow(value.decidedAt, "$input.decidedAt"),
  };
}

export class PolicyWorkspaceService {
  constructor(private readonly repository: PolicyRepositoryPort) {}

  createProject(value: unknown): PolicyWorkspaceSnapshot {
    const project = this.repository.createProject(value);
    return this.getWorkspace(project.id);
  }

  getWorkspace(policyIdValue: unknown): PolicyWorkspaceSnapshot {
    const policyId = identifier(policyIdValue, "$policyId");
    const project = this.repository.getProject(policyId);
    if (!project) {
      throw new PolicyWorkspaceServiceError(
        "PROJECT_NOT_FOUND",
        `Policy project does not exist: ${policyId}.`,
      );
    }
    const currentVersion = this.repository.getVersion(policyId, project.currentVersion);
    if (!currentVersion) {
      throw new PolicyWorkspaceServiceError(
        "CURRENT_VERSION_MISSING",
        "Policy project points to a missing current version.",
      );
    }
    return {
      project,
      currentVersion,
      decisionRecords: this.repository.listDecisionRecords(policyId),
    };
  }

  createPolicyTextVersion(value: unknown): PolicyWorkspaceSnapshot {
    const input = parseTextVersionInput(value);
    const workspace = this.getWorkspace(input.policyId);
    this.#assertExpectedVersion(workspace, input.expectedVersion);
    this.repository.appendVersion({
      policyId: input.policyId,
      expectedParentVersion: input.expectedVersion,
      sourceText: input.sourceText,
      goldenCases: workspace.currentVersion.goldenCases,
      createdAt: input.createdAt,
    });
    return this.getWorkspace(input.policyId);
  }

  resolveAmbiguity(value: unknown): WorkspaceResolutionResult {
    const input = parseResolutionInput(value);
    const workspace = this.getWorkspace(input.policyId);
    this.#assertExpectedVersion(workspace, input.expectedVersion);
    if (!workspace.currentVersion.policyIR) {
      throw new PolicyWorkspaceServiceError(
        "NOT_INTERPRETED",
        "Current policy version has no validated PolicyIR.",
      );
    }
    const resolution = resolvePolicyAmbiguity(
      workspace.currentVersion.policyIR,
      input.ambiguityId,
      input.selectedOptionId,
      workspace.currentVersion.goldenCases,
      input.decidedAt,
    );
    if (resolution.idempotent) {
      return { workspace, decisionRecord: null, idempotent: true };
    }
    this.repository.appendVersion({
      policyId: input.policyId,
      expectedParentVersion: input.expectedVersion,
      sourceText: workspace.currentVersion.sourceText,
      goldenCases: workspace.currentVersion.goldenCases,
      policyIR: resolution.policy,
      decisionRecord: resolution.decisionRecord,
      createdAt: input.decidedAt,
    });
    return {
      workspace: this.getWorkspace(input.policyId),
      decisionRecord: resolution.decisionRecord,
      idempotent: false,
    };
  }

  #assertExpectedVersion(workspace: PolicyWorkspaceSnapshot, expectedVersion: number): void {
    if (workspace.project.currentVersion !== expectedVersion) {
      throw new PolicyWorkspaceServiceError(
        "STALE_VERSION",
        `Expected policy version ${expectedVersion}, current version is ${workspace.project.currentVersion}.`,
      );
    }
  }
}
