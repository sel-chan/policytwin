import { DatabaseSync } from "node:sqlite";
import { parsePolicyCases } from "../domain/case-validation.js";
import type { PolicyCase } from "../domain/cases.js";
import { findGoldenContradictions } from "../policy-ir/evaluate.js";
import { resolvePolicyAmbiguity, type PolicyDecisionRecord } from "../policy-ir/resolve.js";
import {
  canTransitionPolicyState,
  stateForPolicyCandidate,
  type PolicyLifecycleState,
} from "../policy-ir/state.js";
import type { PolicyIR } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";

const SCHEMA_VERSION = 1;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const LIFECYCLE_STATES = new Set<PolicyLifecycleState>([
  "DRAFT",
  "INTERPRETING",
  "NEEDS_DECISION",
  "READY_TO_COMPILE",
  "COMPILED",
  "DRIFT_DETECTED",
  "REPAIRING",
  "VERIFYING",
  "VERIFIED",
  "INTERPRETATION_FAILED",
  "COMPILATION_FAILED",
  "EXECUTION_FAILED",
  "REPAIR_FAILED",
  "VERIFICATION_FAILED",
]);

type Row = Record<string, null | number | bigint | string | Uint8Array>;

export interface StoredPolicyProject {
  id: string;
  title: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPolicyVersion {
  policyId: string;
  version: number;
  parentVersion: number | null;
  sourceText: string;
  goldenCases: PolicyCase[];
  policyIR: PolicyIR | null;
  state: PolicyLifecycleState;
  createdAt: string;
}

export interface CreatePolicyProjectInput {
  id: string;
  title: string;
  sourceText: string;
  goldenCases: PolicyCase[];
  policyIR?: PolicyIR;
  createdAt?: string;
}

export interface AppendPolicyVersionInput {
  policyId: string;
  expectedParentVersion: number;
  sourceText: string;
  goldenCases: PolicyCase[];
  policyIR?: PolicyIR;
  decisionRecord?: PolicyDecisionRecord;
  createdAt?: string;
}

export class PolicyPersistenceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "PROJECT_EXISTS"
      | "PROJECT_NOT_FOUND"
      | "VERSION_NOT_FOUND"
      | "STALE_VERSION"
      | "INVALID_TRANSITION"
      | "DECISION_MISMATCH"
      | "CORRUPTED_STORAGE"
      | "UNSUPPORTED_SCHEMA"
      | "STORAGE_FAILURE"
      | "CLOSED",
    message: string,
  ) {
    super(message);
    this.name = "PolicyPersistenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PolicyPersistenceError("INVALID_INPUT", `${path}.${key} is not allowed.`);
    }
  }
}

function stringValue(value: unknown, path: string, trim = false): string {
  if (typeof value !== "string" || (trim ? value.trim() : value).length === 0) {
    throw new PolicyPersistenceError("INVALID_INPUT", `${path} must be a non-empty string.`);
  }
  return trim ? value.trim() : value;
}

function identifier(value: unknown, path: string): string {
  const parsed = stringValue(value, path, true);
  if (!IDENTIFIER.test(parsed)) {
    throw new PolicyPersistenceError("INVALID_INPUT", `${path} is not a safe identifier.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new PolicyPersistenceError("INVALID_INPUT", `${path} must be a positive integer.`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new PolicyPersistenceError("INVALID_INPUT", `${path} must be an ISO-compatible time.`);
  }
  return new Date(value).toISOString();
}

function storedTimestamp(value: string, path: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new PolicyPersistenceError("CORRUPTED_STORAGE", `${path} is not a canonical timestamp.`);
  }
  return value;
}

function nowOrTimestamp(value: unknown, path: string): string {
  return value === undefined ? new Date().toISOString() : timestamp(value, path);
}

function parseGoldenCases(value: unknown, path: string): PolicyCase[] {
  try {
    const cases = parsePolicyCases(value, path);
    if (cases.some((item) => item.source !== "USER_GOLDEN")) {
      throw new PolicyPersistenceError(
        "INVALID_INPUT",
        `${path} may contain only USER_GOLDEN cases.`,
      );
    }
    return cases;
  } catch (error) {
    if (error instanceof PolicyPersistenceError) {
      throw error;
    }
    throw new PolicyPersistenceError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : `${path} is invalid.`,
    );
  }
}

function parseIR(value: unknown, policyId: string, version: number, sourceText: string): PolicyIR {
  let policy: PolicyIR;
  try {
    policy = parsePolicyIR(value);
  } catch (error) {
    throw new PolicyPersistenceError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "PolicyIR is invalid.",
    );
  }
  if (policy.policyId !== policyId || policy.version !== version) {
    throw new PolicyPersistenceError(
      "INVALID_INPUT",
      `PolicyIR identity must match ${policyId} version ${version}.`,
    );
  }
  for (const clause of policy.clauses) {
    if (sourceText.slice(clause.startOffset, clause.endOffset) !== clause.text) {
      throw new PolicyPersistenceError(
        "INVALID_INPUT",
        `PolicyIR clause ${clause.id} does not match the stored source text.`,
      );
    }
  }
  return policy;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function rowString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new PolicyPersistenceError("CORRUPTED_STORAGE", `${key} is not stored as text.`);
  }
  return value;
}

function rowInteger(row: Row, key: string): number {
  const value = row[key];
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isSafeInteger(numberValue)) {
    throw new PolicyPersistenceError("CORRUPTED_STORAGE", `${key} is not stored as an integer.`);
  }
  return numberValue;
}

function nullableRowInteger(row: Row, key: string): number | null {
  return row[key] === null ? null : rowInteger(row, key);
}

function storedJson(value: string, path: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new PolicyPersistenceError("CORRUPTED_STORAGE", `${path} contains invalid JSON.`);
  }
}

function lifecycleState(value: string): PolicyLifecycleState {
  if (!LIFECYCLE_STATES.has(value as PolicyLifecycleState)) {
    throw new PolicyPersistenceError("CORRUPTED_STORAGE", "Stored lifecycle state is invalid.");
  }
  return value as PolicyLifecycleState;
}

function createInput(value: unknown): {
  id: string;
  title: string;
  sourceText: string;
  goldenCases: PolicyCase[];
  policyIR: PolicyIR | null;
  createdAt: string;
} {
  if (!isRecord(value)) {
    throw new PolicyPersistenceError("INVALID_INPUT", "Project input must be an object.");
  }
  assertKeys(
    value,
    ["id", "title", "sourceText", "goldenCases", "policyIR", "createdAt"],
    "$project",
  );
  const id = identifier(value.id, "$project.id");
  const sourceText = stringValue(value.sourceText, "$project.sourceText");
  const goldenCases = parseGoldenCases(value.goldenCases, "$project.goldenCases");
  const policyIR =
    value.policyIR === undefined ? null : parseIR(value.policyIR, id, 1, sourceText);
  if (policyIR && findGoldenContradictions(policyIR, goldenCases).length > 0) {
    throw new PolicyPersistenceError(
      "INVALID_INPUT",
      "Initial PolicyIR contradicts authoritative golden cases.",
    );
  }
  return {
    id,
    title: stringValue(value.title, "$project.title", true),
    sourceText,
    goldenCases,
    policyIR,
    createdAt: nowOrTimestamp(value.createdAt, "$project.createdAt"),
  };
}

function appendInput(value: unknown): {
  policyId: string;
  expectedParentVersion: number;
  sourceText: string;
  goldenCases: PolicyCase[];
  policyIRValue: unknown;
  decisionRecordValue: unknown;
  createdAt: string;
} {
  if (!isRecord(value)) {
    throw new PolicyPersistenceError("INVALID_INPUT", "Version input must be an object.");
  }
  assertKeys(
    value,
    [
      "policyId",
      "expectedParentVersion",
      "sourceText",
      "goldenCases",
      "policyIR",
      "decisionRecord",
      "createdAt",
    ],
    "$version",
  );
  return {
    policyId: identifier(value.policyId, "$version.policyId"),
    expectedParentVersion: positiveInteger(
      value.expectedParentVersion,
      "$version.expectedParentVersion",
    ),
    sourceText: stringValue(value.sourceText, "$version.sourceText"),
    goldenCases: parseGoldenCases(value.goldenCases, "$version.goldenCases"),
    policyIRValue: value.policyIR,
    decisionRecordValue: value.decisionRecord,
    createdAt: nowOrTimestamp(value.createdAt, "$version.createdAt"),
  };
}

function validateDecisionRecord(
  value: unknown,
  parent: StoredPolicyVersion,
  nextPolicy: PolicyIR,
  goldenCases: readonly PolicyCase[],
  expectedCreatedAt: string,
): PolicyDecisionRecord {
  if (!isRecord(value)) {
    throw new PolicyPersistenceError("DECISION_MISMATCH", "Decision record must be an object.");
  }
  assertKeys(
    value,
    [
      "id",
      "policyId",
      "fromVersion",
      "toVersion",
      "ambiguityId",
      "selectedOptionId",
      "policyPatch",
      "decidedAt",
    ],
    "$decisionRecord",
  );
  if (!parent.policyIR) {
    throw new PolicyPersistenceError(
      "DECISION_MISMATCH",
      "A decision version requires a persisted parent PolicyIR.",
    );
  }
  const record: PolicyDecisionRecord = {
    id: identifier(value.id, "$decisionRecord.id"),
    policyId: identifier(value.policyId, "$decisionRecord.policyId"),
    fromVersion: positiveInteger(value.fromVersion, "$decisionRecord.fromVersion"),
    toVersion: positiveInteger(value.toVersion, "$decisionRecord.toVersion"),
    ambiguityId: identifier(value.ambiguityId, "$decisionRecord.ambiguityId"),
    selectedOptionId: identifier(value.selectedOptionId, "$decisionRecord.selectedOptionId"),
    policyPatch: value.policyPatch as PolicyDecisionRecord["policyPatch"],
    decidedAt: timestamp(value.decidedAt, "$decisionRecord.decidedAt"),
  };
  if (
    record.policyId !== parent.policyId ||
    record.fromVersion !== parent.version ||
    record.toVersion !== nextPolicy.version ||
    record.decidedAt < parent.createdAt ||
    record.decidedAt > expectedCreatedAt
  ) {
    throw new PolicyPersistenceError(
      "DECISION_MISMATCH",
      "Decision record identity, version, or time does not match the appended version.",
    );
  }
  const ambiguity = parent.policyIR.ambiguities.find((item) => item.id === record.ambiguityId);
  const option = ambiguity?.options.find((item) => item.id === record.selectedOptionId);
  const nextAmbiguity = nextPolicy.ambiguities.find((item) => item.id === record.ambiguityId);
  if (
    !ambiguity ||
    !option ||
    !nextAmbiguity ||
    nextAmbiguity.status !== "RESOLVED" ||
    nextAmbiguity.selectedOptionId !== record.selectedOptionId ||
    canonicalJson(option.policyPatch) !== canonicalJson(record.policyPatch)
  ) {
    throw new PolicyPersistenceError(
      "DECISION_MISMATCH",
      "Decision record does not match the parent option or resolved PolicyIR.",
    );
  }
  let expectedPolicy: PolicyIR;
  let expectedRecord: PolicyDecisionRecord | null;
  try {
    const expected = resolvePolicyAmbiguity(
      parent.policyIR,
      record.ambiguityId,
      record.selectedOptionId,
      goldenCases,
      record.decidedAt,
    );
    expectedPolicy = expected.policy;
    expectedRecord = expected.decisionRecord;
  } catch {
    throw new PolicyPersistenceError(
      "DECISION_MISMATCH",
      "Decision record cannot be reproduced from the persisted parent version.",
    );
  }
  if (
    !expectedRecord ||
    canonicalJson(expectedPolicy) !== canonicalJson(nextPolicy) ||
    canonicalJson(expectedRecord) !== canonicalJson(record)
  ) {
    throw new PolicyPersistenceError(
      "DECISION_MISMATCH",
      "Appended PolicyIR contains changes outside the selected ambiguity option.",
    );
  }
  return record;
}

function changedAmbiguitySelections(parent: PolicyIR, next: PolicyIR): string[] {
  const nextById = new Map(next.ambiguities.map((item) => [item.id, item]));
  const changed = parent.ambiguities
    .filter((item) => {
      const nextItem = nextById.get(item.id);
      return (
        !nextItem ||
        item.status !== nextItem.status ||
        item.selectedOptionId !== nextItem.selectedOptionId
      );
    })
    .map((item) => item.id);
  for (const item of next.ambiguities) {
    if (!parent.ambiguities.some((candidate) => candidate.id === item.id)) {
      changed.push(item.id);
    }
  }
  return [...new Set(changed)].sort();
}

export class SQLitePolicyRepository {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    if (typeof databasePath !== "string" || databasePath.length === 0) {
      throw new PolicyPersistenceError("INVALID_INPUT", "Database path is required.");
    }
    this.#database = new DatabaseSync(databasePath);
    try {
      this.#initialize();
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  #initialize(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    const versionRow = this.#database.prepare("PRAGMA user_version").get();
    const currentVersion = versionRow ? rowInteger(versionRow, "user_version") : 0;
    if (currentVersion !== 0 && currentVersion !== SCHEMA_VERSION) {
      throw new PolicyPersistenceError(
        "UNSUPPORTED_SCHEMA",
        `Unsupported persistence schema version: ${currentVersion}.`,
      );
    }
    if (currentVersion === SCHEMA_VERSION) {
      return;
    }
    this.#database.exec(`
      CREATE TABLE policy_projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        current_version INTEGER NOT NULL CHECK (current_version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE policy_versions (
        policy_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        parent_version INTEGER,
        source_text TEXT NOT NULL,
        golden_cases_json TEXT NOT NULL,
        policy_ir_json TEXT,
        lifecycle_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (policy_id, version),
        FOREIGN KEY (policy_id) REFERENCES policy_projects(id) ON DELETE RESTRICT,
        FOREIGN KEY (policy_id, parent_version)
          REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT
      );
      CREATE TABLE policy_decisions (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL,
        ambiguity_id TEXT NOT NULL,
        selected_option_id TEXT NOT NULL,
        policy_patch_json TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        UNIQUE (policy_id, to_version),
        FOREIGN KEY (policy_id, from_version)
          REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT,
        FOREIGN KEY (policy_id, to_version)
          REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT
      );
      CREATE INDEX policy_versions_created_idx
        ON policy_versions(policy_id, created_at);
      CREATE INDEX policy_decisions_policy_idx
        ON policy_decisions(policy_id, to_version);
      PRAGMA user_version = 1;
    `);
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new PolicyPersistenceError("CLOSED", "Policy repository is closed.");
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      if (error instanceof PolicyPersistenceError) {
        throw error;
      }
      throw new PolicyPersistenceError("STORAGE_FAILURE", "SQLite transaction failed.");
    }
  }

  #projectFromRow(row: Row): StoredPolicyProject {
    return {
      id: rowString(row, "id"),
      title: rowString(row, "title"),
      currentVersion: rowInteger(row, "current_version"),
      createdAt: storedTimestamp(rowString(row, "created_at"), "created_at"),
      updatedAt: storedTimestamp(rowString(row, "updated_at"), "updated_at"),
    };
  }

  #versionFromRow(row: Row): StoredPolicyVersion {
    const policyId = rowString(row, "policy_id");
    const version = rowInteger(row, "version");
    const sourceText = rowString(row, "source_text");
    try {
      const goldenCases = parsePolicyCases(
        storedJson(rowString(row, "golden_cases_json"), "golden_cases_json"),
        "$stored.goldenCases",
      );
      const irJson = row.policy_ir_json;
      const policyIR =
        irJson === null
          ? null
          : parseIR(storedJson(rowString(row, "policy_ir_json"), "policy_ir_json"), policyId, version, sourceText);
      return {
        policyId,
        version,
        parentVersion: nullableRowInteger(row, "parent_version"),
        sourceText,
        goldenCases,
        policyIR,
        state: lifecycleState(rowString(row, "lifecycle_state")),
        createdAt: storedTimestamp(rowString(row, "created_at"), "created_at"),
      };
    } catch (error) {
      if (error instanceof PolicyPersistenceError && error.code === "CORRUPTED_STORAGE") {
        throw error;
      }
      throw new PolicyPersistenceError(
        "CORRUPTED_STORAGE",
        error instanceof Error ? error.message : "Stored policy version is invalid.",
      );
    }
  }

  createProject(value: unknown): StoredPolicyProject {
    this.#ensureOpen();
    const input = createInput(value);
    if (this.getProject(input.id) !== null) {
      throw new PolicyPersistenceError("PROJECT_EXISTS", `Project already exists: ${input.id}.`);
    }
    const state = input.policyIR ? stateForPolicyCandidate(input.policyIR) : "DRAFT";
    return this.#transaction(() => {
      this.#database
        .prepare(
          "INSERT INTO policy_projects(id,title,current_version,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .run(input.id, input.title, 1, input.createdAt, input.createdAt);
      this.#database
        .prepare(
          "INSERT INTO policy_versions(policy_id,version,parent_version,source_text,golden_cases_json,policy_ir_json,lifecycle_state,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          input.id,
          1,
          null,
          input.sourceText,
          JSON.stringify(input.goldenCases),
          input.policyIR ? JSON.stringify(input.policyIR) : null,
          state,
          input.createdAt,
        );
      const project = this.getProject(input.id);
      if (!project) {
        throw new PolicyPersistenceError("STORAGE_FAILURE", "Created project cannot be read.");
      }
      return project;
    });
  }

  getProject(policyIdValue: unknown): StoredPolicyProject | null {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "$policyId");
    const row = this.#database
      .prepare(
        "SELECT id,title,current_version,created_at,updated_at FROM policy_projects WHERE id = ?",
      )
      .get(policyId);
    return row ? this.#projectFromRow(row) : null;
  }

  getVersion(policyIdValue: unknown, versionValue: unknown): StoredPolicyVersion | null {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "$policyId");
    const version = positiveInteger(versionValue, "$version");
    const row = this.#database
      .prepare(
        "SELECT policy_id,version,parent_version,source_text,golden_cases_json,policy_ir_json,lifecycle_state,created_at FROM policy_versions WHERE policy_id = ? AND version = ?",
      )
      .get(policyId, version);
    return row ? this.#versionFromRow(row) : null;
  }

  listVersions(policyIdValue: unknown): StoredPolicyVersion[] {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "$policyId");
    return this.#database
      .prepare(
        "SELECT policy_id,version,parent_version,source_text,golden_cases_json,policy_ir_json,lifecycle_state,created_at FROM policy_versions WHERE policy_id = ? ORDER BY version",
      )
      .all(policyId)
      .map((row) => this.#versionFromRow(row));
  }

  appendVersion(value: unknown): StoredPolicyVersion {
    this.#ensureOpen();
    const input = appendInput(value);
    const project = this.getProject(input.policyId);
    if (!project) {
      throw new PolicyPersistenceError(
        "PROJECT_NOT_FOUND",
        `Project does not exist: ${input.policyId}.`,
      );
    }
    if (project.currentVersion !== input.expectedParentVersion) {
      throw new PolicyPersistenceError(
        "STALE_VERSION",
        `Expected version ${input.expectedParentVersion}, current version is ${project.currentVersion}.`,
      );
    }
    const parent = this.getVersion(input.policyId, input.expectedParentVersion);
    if (!parent) {
      throw new PolicyPersistenceError("CORRUPTED_STORAGE", "Current project version is missing.");
    }
    if (input.createdAt < parent.createdAt) {
      throw new PolicyPersistenceError(
        "INVALID_INPUT",
        "Appended version time cannot precede its parent version.",
      );
    }
    const version = input.expectedParentVersion + 1;
    const policyIR =
      input.policyIRValue === undefined
        ? null
        : parseIR(input.policyIRValue, input.policyId, version, input.sourceText);
    if (policyIR && findGoldenContradictions(policyIR, input.goldenCases).length > 0) {
      throw new PolicyPersistenceError(
        "INVALID_INPUT",
        "Appended PolicyIR contradicts authoritative golden cases.",
      );
    }
    if (input.decisionRecordValue !== undefined && !policyIR) {
      throw new PolicyPersistenceError(
        "DECISION_MISMATCH",
        "A decision record requires an appended PolicyIR.",
      );
    }
    if (input.decisionRecordValue !== undefined && input.sourceText !== parent.sourceText) {
      throw new PolicyPersistenceError(
        "DECISION_MISMATCH",
        "An ambiguity decision cannot also change policy source text.",
      );
    }
    if (
      input.decisionRecordValue === undefined &&
      input.sourceText === parent.sourceText &&
      parent.policyIR &&
      policyIR &&
      changedAmbiguitySelections(parent.policyIR, policyIR).length > 0
    ) {
      throw new PolicyPersistenceError(
        "DECISION_MISMATCH",
        "Ambiguity selections changed without a versioned decision record.",
      );
    }
    const decisionRecord =
      input.decisionRecordValue === undefined
        ? null
        : validateDecisionRecord(
            input.decisionRecordValue,
            parent,
            policyIR as PolicyIR,
            input.goldenCases,
            input.createdAt,
          );
    const state = policyIR ? stateForPolicyCandidate(policyIR) : "DRAFT";

    return this.#transaction(() => {
      this.#database
        .prepare(
          "INSERT INTO policy_versions(policy_id,version,parent_version,source_text,golden_cases_json,policy_ir_json,lifecycle_state,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          input.policyId,
          version,
          input.expectedParentVersion,
          input.sourceText,
          JSON.stringify(input.goldenCases),
          policyIR ? JSON.stringify(policyIR) : null,
          state,
          input.createdAt,
        );
      if (decisionRecord) {
        this.#database
          .prepare(
            "INSERT INTO policy_decisions(id,policy_id,from_version,to_version,ambiguity_id,selected_option_id,policy_patch_json,decided_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            decisionRecord.id,
            decisionRecord.policyId,
            decisionRecord.fromVersion,
            decisionRecord.toVersion,
            decisionRecord.ambiguityId,
            decisionRecord.selectedOptionId,
            JSON.stringify(decisionRecord.policyPatch),
            decisionRecord.decidedAt,
          );
      }
      const update = this.#database
        .prepare(
          "UPDATE policy_projects SET current_version = ?, updated_at = ? WHERE id = ? AND current_version = ?",
        )
        .run(version, input.createdAt, input.policyId, input.expectedParentVersion);
      if (Number(update.changes) !== 1) {
        throw new PolicyPersistenceError("STALE_VERSION", "Project version changed concurrently.");
      }
      const stored = this.getVersion(input.policyId, version);
      if (!stored) {
        throw new PolicyPersistenceError("STORAGE_FAILURE", "Appended version cannot be read.");
      }
      return stored;
    });
  }

  transitionState(
    policyIdValue: unknown,
    versionValue: unknown,
    expectedStateValue: unknown,
    nextStateValue: unknown,
    updatedAtValue?: unknown,
  ): StoredPolicyVersion {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "$policyId");
    const version = positiveInteger(versionValue, "$version");
    if (
      typeof expectedStateValue !== "string" ||
      !LIFECYCLE_STATES.has(expectedStateValue as PolicyLifecycleState) ||
      typeof nextStateValue !== "string" ||
      !LIFECYCLE_STATES.has(nextStateValue as PolicyLifecycleState)
    ) {
      throw new PolicyPersistenceError("INVALID_INPUT", "Lifecycle states are invalid.");
    }
    const expectedState = expectedStateValue as PolicyLifecycleState;
    const nextState = nextStateValue as PolicyLifecycleState;
    if (!canTransitionPolicyState(expectedState, nextState)) {
      throw new PolicyPersistenceError(
        "INVALID_TRANSITION",
        `Invalid policy state transition: ${expectedState} -> ${nextState}.`,
      );
    }
    const project = this.getProject(policyId);
    if (!project) {
      throw new PolicyPersistenceError("PROJECT_NOT_FOUND", `Project does not exist: ${policyId}.`);
    }
    if (project.currentVersion !== version) {
      throw new PolicyPersistenceError(
        "STALE_VERSION",
        "Only the current policy version may transition state.",
      );
    }
    const updatedAt = nowOrTimestamp(updatedAtValue, "$updatedAt");
    if (updatedAt < project.updatedAt) {
      throw new PolicyPersistenceError(
        "INVALID_INPUT",
        "Lifecycle update time cannot precede the project update time.",
      );
    }
    return this.#transaction(() => {
      const update = this.#database
        .prepare(
          "UPDATE policy_versions SET lifecycle_state = ? WHERE policy_id = ? AND version = ? AND lifecycle_state = ?",
        )
        .run(nextState, policyId, version, expectedState);
      if (Number(update.changes) !== 1) {
        throw new PolicyPersistenceError(
          "STALE_VERSION",
          "Policy lifecycle state changed concurrently.",
        );
      }
      this.#database
        .prepare("UPDATE policy_projects SET updated_at = ? WHERE id = ?")
        .run(updatedAt, policyId);
      const stored = this.getVersion(policyId, version);
      if (!stored) {
        throw new PolicyPersistenceError("STORAGE_FAILURE", "Transitioned version cannot be read.");
      }
      return stored;
    });
  }

  listDecisionRecords(policyIdValue: unknown): PolicyDecisionRecord[] {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "$policyId");
    const rows = this.#database
      .prepare(
        "SELECT id,policy_id,from_version,to_version,ambiguity_id,selected_option_id,policy_patch_json,decided_at FROM policy_decisions WHERE policy_id = ? ORDER BY to_version",
      )
      .all(policyId);
    return rows.map((row) => {
      const record = {
        id: rowString(row, "id"),
        policyId: rowString(row, "policy_id"),
        fromVersion: rowInteger(row, "from_version"),
        toVersion: rowInteger(row, "to_version"),
        ambiguityId: rowString(row, "ambiguity_id"),
        selectedOptionId: rowString(row, "selected_option_id"),
        policyPatch: storedJson(
          rowString(row, "policy_patch_json"),
          "policy_patch_json",
        ) as PolicyDecisionRecord["policyPatch"],
        decidedAt: rowString(row, "decided_at"),
      } satisfies PolicyDecisionRecord;
      const parent = this.getVersion(policyId, record.fromVersion);
      const next = this.getVersion(policyId, record.toVersion);
      if (!parent || !next?.policyIR) {
        throw new PolicyPersistenceError(
          "CORRUPTED_STORAGE",
          `Decision ${record.id} references a missing policy version.`,
        );
      }
      try {
        return validateDecisionRecord(
          record,
          parent,
          next.policyIR,
          next.goldenCases,
          next.createdAt,
        );
      } catch {
        throw new PolicyPersistenceError(
          "CORRUPTED_STORAGE",
          `Decision ${record.id} does not match persisted versions.`,
        );
      }
    });
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }
}
