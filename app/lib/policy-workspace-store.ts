import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { SQLitePolicyRepository } from "../../dist/persistence/sqlite.js";
import { SingleRunGate } from "../../dist/openai/request-guard.js";
import { PolicyWorkspaceService } from "../../dist/workspace/service.js";
import {
  WorkspaceHttpError,
  isWorkspaceCsrfToken,
  isWorkspaceSessionExpired,
} from "../../dist/workspace/http.js";

export const SEEDED_POLICY_ID = "policy-seeded-refund";
export const ANONYMOUS_WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ANONYMOUS_WORKSPACES = 128;

export interface SeededWorkspaceStore {
  repository: SQLitePolicyRepository;
  service: PolicyWorkspaceService;
  mutationGate: SingleRunGate;
  databasePath: string;
}

const globalStore = globalThis as typeof globalThis & {
  __policyTwinSeededWorkspace?: SeededWorkspaceStore;
};

function anonymousWorkspaceCapacity(): number {
  const configured = process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES?.trim();
  if (!configured) {
    return MAX_ANONYMOUS_WORKSPACES;
  }
  const parsed = Number(configured);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_ANONYMOUS_WORKSPACES ||
    String(parsed) !== configured
  ) {
    throw new Error(
      `POLICYTWIN_MAX_ANONYMOUS_WORKSPACES must be an integer from 1 to ${MAX_ANONYMOUS_WORKSPACES}.`,
    );
  }
  return parsed;
}

function configuredDatabasePath(): string {
  const configured = process.env.POLICYTWIN_DATABASE_PATH?.trim();
  if (configured?.includes("\0")) {
    throw new Error("POLICYTWIN_DATABASE_PATH contains an invalid character.");
  }
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error("POLICYTWIN_DATABASE_PATH must be an absolute path.");
    }
    return configured;
  }
  return resolve(process.cwd(), ".data", "policytwin.sqlite");
}

export function seededPolicyIdForSession(sessionToken: string): string {
  if (!isWorkspaceCsrfToken(sessionToken)) {
    throw new Error("Workspace session token is invalid.");
  }
  const sessionHash = createHash("sha256").update(sessionToken, "utf8").digest("hex").slice(0, 24);
  return `${SEEDED_POLICY_ID}-${sessionHash}`;
}

export function ensureSeededSessionWorkspace(
  store: SeededWorkspaceStore,
  sessionToken: string,
  now = new Date(),
): string {
  const policyId = seededPolicyIdForSession(sessionToken);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("Workspace session time is invalid.");
  }
  const sessionPrefix = `${SEEDED_POLICY_ID}-`;
  for (const project of store.repository.listProjects()) {
    if (
      project.id.startsWith(sessionPrefix) &&
      isWorkspaceSessionExpired(project.createdAt, now, ANONYMOUS_WORKSPACE_TTL_MS)
    ) {
      store.repository.deleteProject(project.id);
    }
  }
  if (store.repository.getProject(policyId)) {
    return policyId;
  }
  const activeSessionCount = store.repository
    .listProjects()
    .filter((project) => project.id.startsWith(sessionPrefix)).length;
  if (activeSessionCount >= anonymousWorkspaceCapacity()) {
    throw new WorkspaceHttpError(
      429,
      "WORKSPACE_CAPACITY",
      "Anonymous workspace capacity is temporarily exhausted.",
    );
  }
  const sourceText = readFileSync(
    resolve(process.cwd(), "fixtures", "interpreter", "seeded-refund-policy.txt"),
    "utf8",
  );
  const goldenCases = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "fixtures", "refund-demo", "cases", "golden-cases.json"),
      "utf8",
    ),
  ) as unknown;
  const policyIR = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "fixtures", "interpreter", "recorded-policy-ir.v1.json"),
      "utf8",
    ),
  ) as { id: string; policyId: string };
  policyIR.policyId = policyId;
  policyIR.id = `${policyId}-v1`;
  try {
    store.service.createProject({
      id: policyId,
      title: "Seeded SaaS refund policy",
      sourceText,
      goldenCases,
      policyIR,
      createdAt: now.toISOString(),
    });
  } catch (error) {
    if (!store.repository.getProject(policyId)) {
      throw error;
    }
  }
  return policyId;
}

export function getSessionPolicyId(
  store: SeededWorkspaceStore,
  sessionToken: string,
  now = new Date(),
): string {
  const policyId = seededPolicyIdForSession(sessionToken);
  const project = store.repository.getProject(policyId);
  if (!project) {
    throw new WorkspaceHttpError(403, "INVALID_SESSION", "Workspace session project is absent.");
  }
  if (isWorkspaceSessionExpired(project.createdAt, now, ANONYMOUS_WORKSPACE_TTL_MS)) {
    store.repository.deleteProject(policyId);
    throw new WorkspaceHttpError(403, "INVALID_SESSION", "Workspace session has expired.");
  }
  return policyId;
}

export function getSeededWorkspaceStore(): SeededWorkspaceStore {
  const databasePath = configuredDatabasePath();
  const existing = globalStore.__policyTwinSeededWorkspace;
  if (existing && existing.databasePath === databasePath) {
    return existing;
  }
  if (existing) {
    existing.repository.close();
  }
  mkdirSync(dirname(databasePath), { recursive: true });
  const repository = new SQLitePolicyRepository(databasePath);
  const store: SeededWorkspaceStore = {
    repository,
    service: new PolicyWorkspaceService(repository),
    mutationGate: new SingleRunGate(),
    databasePath,
  };
  globalStore.__policyTwinSeededWorkspace = store;
  return store;
}

export function getLatestValidatedVersion(store: SeededWorkspaceStore, policyId: string) {
  const workspace = store.service.getWorkspace(policyId);
  for (let version = workspace.project.currentVersion; version >= 1; version -= 1) {
    const candidate = store.repository.getVersion(policyId, version);
    if (candidate?.policyIR) {
      return candidate;
    }
  }
  throw new Error("Seeded workspace has no validated PolicyIR version.");
}
