import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertNoSensitiveWorkerText, assertSafeRelativePath } from "../codex/safety.js";
import {
  assertConsumedExternalWorkerV2Run,
  workerRpcRequestIdForRepairRun,
  type ValidatedExternalWorkerV2Run,
} from "../codex/worker-rpc-client.js";
import {
  REPAIR_RUN_EVENT_TYPES,
  REPAIR_RUN_PHASES,
  REPAIR_RUN_STATUSES,
  type RepairRunEvent,
  type RepairRunEventDetail,
  type RepairRunEventType,
  type RepairRunFailure,
  type RepairRunPhase,
  type RepairRunRecord,
  type RepairRunResultSummary,
  type RepairRunStatus,
} from "./types.js";
import { repairRunSummaryFromValidatedExternalRun } from "./validated-result.js";

const SCHEMA_VERSION = 1;
const MAX_RUNS_PER_SESSION = 16;
const MAX_EVENTS_PER_RUN = 64;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CLIENT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID = /^rr_[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

type Row = Record<string, null | number | bigint | string | Uint8Array>;

export class RepairRunPersistenceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "IDEMPOTENCY_CONFLICT"
      | "RUN_BUSY"
      | "RUN_CAPACITY"
      | "RUN_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "CORRUPTED_STORAGE"
      | "UNSUPPORTED_SCHEMA"
      | "STORAGE_FAILURE"
      | "CLOSED",
    message: string,
  ) {
    super(message);
    this.name = "RepairRunPersistenceError";
  }
}

function rowString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", `${key} is not stored as text.`);
  }
  return value;
}

function rowInteger(row: Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", `${key} is not stored as an integer.`);
  }
  return parsed;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} must be a canonical timestamp.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} must be a canonical timestamp.`);
  }
  return value;
}

function storedTimestamp(value: string, label: string): string {
  try {
    return canonicalTimestamp(value, label);
  } catch {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", `${label} is invalid.`);
  }
}

function safeMessage(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024) {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} is missing or too large.`);
  }
  try {
    return assertNoSensitiveWorkerText(value, label, 1_024);
  } catch {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} contains unsafe content.`);
  }
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} must be a SHA-256 digest.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} must be a safe identifier.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new RepairRunPersistenceError("INVALID_INPUT", `${label} must be a positive integer.`);
  }
  return value;
}

function status(value: string): RepairRunStatus {
  if (!REPAIR_RUN_STATUSES.includes(value as RepairRunStatus)) {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored repair-run status is invalid.");
  }
  return value as RepairRunStatus;
}

function phase(value: string): RepairRunPhase {
  if (!REPAIR_RUN_PHASES.includes(value as RepairRunPhase)) {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored repair-run phase is invalid.");
  }
  return value as RepairRunPhase;
}

function eventType(value: string): RepairRunEventType {
  if (!REPAIR_RUN_EVENT_TYPES.includes(value as RepairRunEventType)) {
    throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored repair-run event type is invalid.");
  }
  return value as RepairRunEventType;
}

function failure(value: unknown): RepairRunFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run failure must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "code,message" ||
    typeof record.code !== "string" ||
    !FAILURE_CODE.test(record.code)
  ) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run failure code is invalid.");
  }
  return { code: record.code, message: safeMessage(record.message, "repair-run failure message") };
}

function eventDetail(value: unknown): RepairRunEventDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run event detail must be an object.");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "message",
    "attempt",
    "changedFiles",
    "commandId",
    "exitCode",
    "passed",
    "total",
    "reviewVerdict",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run event detail has unknown fields.");
  }
  const result: RepairRunEventDetail = {
    message: safeMessage(input.message, "repair-run event message"),
  };
  if (input.attempt !== undefined) {
    if (input.attempt !== 1 && input.attempt !== 2) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run event attempt is invalid.");
    }
    result.attempt = input.attempt;
  }
  if (input.changedFiles !== undefined) {
    if (
      !Array.isArray(input.changedFiles) ||
      input.changedFiles.length > 16 ||
      input.changedFiles.some((item) => typeof item !== "string")
    ) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run changed files are invalid.");
    }
    try {
      result.changedFiles = [...new Set(input.changedFiles.map((item) => assertSafeRelativePath(item)))]
        .sort();
    } catch {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run changed files are invalid.");
    }
  }
  if (input.commandId !== undefined) {
    if (input.commandId !== "fixture-typecheck" && input.commandId !== "fixture-test") {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run command ID is invalid.");
    }
    result.commandId = input.commandId;
  }
  if (input.exitCode !== undefined) {
    if (!Number.isSafeInteger(input.exitCode) || (input.exitCode as number) < 0 || (input.exitCode as number) > 255) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run exit code is invalid.");
    }
    result.exitCode = input.exitCode as number;
  }
  for (const key of ["passed", "total"] as const) {
    const item = input[key];
    if (item !== undefined) {
      if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 10_000) {
        throw new RepairRunPersistenceError("INVALID_INPUT", `Repair-run ${key} count is invalid.`);
      }
      result[key] = item as number;
    }
  }
  if (result.passed !== undefined && result.total !== undefined && result.passed > result.total) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run passed count exceeds total.");
  }
  if (input.reviewVerdict !== undefined) {
    if (input.reviewVerdict !== "APPROVE" && input.reviewVerdict !== "BLOCK") {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run review verdict is invalid.");
    }
    result.reviewVerdict = input.reviewVerdict;
  }
  const serialized = JSON.stringify(result);
  try {
    assertNoSensitiveWorkerText(serialized, "repair-run event detail", 16_384);
  } catch {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run event detail is unsafe.");
  }
  return result;
}

function resultSummary(value: unknown): RepairRunResultSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run result summary is invalid.");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "attempts,changedFiles,commands,completedAt,executionBindingSha256,executionMode,externalRequestId,review,verification" ||
    input.executionMode !== "LIVE_CODEX_SDK" ||
    typeof input.externalRequestId !== "string" ||
    !/^[0-9a-f]{32}$/u.test(input.externalRequestId) ||
    typeof input.executionBindingSha256 !== "string" ||
    !SHA256.test(input.executionBindingSha256) ||
    (input.attempts !== 1 && input.attempts !== 2) ||
    !Array.isArray(input.changedFiles) ||
    !Array.isArray(input.commands) ||
    typeof input.verification !== "object" ||
    input.verification === null ||
    Array.isArray(input.verification)
  ) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run result summary is invalid.");
  }
  const changedFiles = eventDetail({ message: "Validated changed files.", changedFiles: input.changedFiles })
    .changedFiles ?? [];
  const commands = input.commands.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", `Repair-run command ${index} is invalid.`);
    }
    const command = value as Record<string, unknown>;
    if (
      Object.keys(command).sort().join(",") !==
        "attempt,commandId,durationMs,exitCode,timedOut" ||
      (command.commandId !== "fixture-typecheck" && command.commandId !== "fixture-test") ||
      (command.attempt !== 1 && command.attempt !== 2) ||
      !Number.isSafeInteger(command.exitCode) ||
      (command.exitCode as number) < 0 ||
      (command.exitCode as number) > 255 ||
      typeof command.timedOut !== "boolean" ||
      !Number.isSafeInteger(command.durationMs) ||
      (command.durationMs as number) < 0 ||
      (command.durationMs as number) > 15 * 60_000
    ) {
      throw new RepairRunPersistenceError("INVALID_INPUT", `Repair-run command ${index} is invalid.`);
    }
    const commandId = command.commandId as "fixture-typecheck" | "fixture-test";
    const attempt = command.attempt as 1 | 2;
    return {
      commandId,
      attempt,
      exitCode: command.exitCode as number,
      timedOut: command.timedOut,
      durationMs: command.durationMs as number,
    };
  });
  const verification = input.verification as Record<string, unknown>;
  if (
    Object.keys(verification).sort().join(",") !== "passed,status,total" ||
    (verification.status !== "PASS" && verification.status !== "FAIL") ||
    !Number.isSafeInteger(verification.passed) ||
    !Number.isSafeInteger(verification.total) ||
    (verification.passed as number) < 0 ||
    (verification.total as number) < 1 ||
    (verification.total as number) > 10_000 ||
    (verification.passed as number) > (verification.total as number)
  ) {
    throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run verification summary is invalid.");
  }
  let review: RepairRunResultSummary["review"] = null;
  if (input.review !== null) {
    if (typeof input.review !== "object" || Array.isArray(input.review)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run review summary is invalid.");
    }
    const item = input.review as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(",") !== "blockingFindingCount,summary,verdict" ||
      (item.verdict !== "APPROVE" && item.verdict !== "BLOCK") ||
      !Number.isSafeInteger(item.blockingFindingCount) ||
      (item.blockingFindingCount as number) < 0 ||
      (item.blockingFindingCount as number) > 100
    ) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run review summary is invalid.");
    }
    review = {
      verdict: item.verdict,
      summary: safeMessage(item.summary, "repair-run review summary"),
      blockingFindingCount: item.blockingFindingCount as number,
    };
  }
  return {
    executionMode: "LIVE_CODEX_SDK",
    externalRequestId: input.externalRequestId,
    executionBindingSha256: input.executionBindingSha256,
    completedAt: canonicalTimestamp(input.completedAt, "repair-run completion time"),
    attempts: input.attempts,
    changedFiles,
    commands,
    verification: {
      status: verification.status,
      passed: verification.passed as number,
      total: verification.total as number,
    },
    review,
  };
}

export interface CreateRepairRunInput {
  clientRequestId: string;
  sessionSha256: string;
  policyId: string;
  policyVersion: number;
  policyIrSha256: string;
  inputSha256: string;
  createdAt: string;
}

export class SQLiteRepairRunRepository {
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(databasePath: string) {
    if (typeof databasePath !== "string" || databasePath.length === 0) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run database path is required.");
    }
    this.#database = new DatabaseSync(databasePath);
    try {
      this.#initialize();
      this.recoverInterruptedRuns(new Date().toISOString());
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  #initialize(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    const versionRow = this.#database.prepare("PRAGMA user_version").get() as Row | undefined;
    const version = versionRow ? rowInteger(versionRow, "user_version") : 0;
    if (version !== 0 && version !== SCHEMA_VERSION) {
      throw new RepairRunPersistenceError(
        "UNSUPPORTED_SCHEMA",
        `Unsupported repair-run schema version: ${version}.`,
      );
    }
    if (version === SCHEMA_VERSION) return;
    this.#database.exec(`
      CREATE TABLE repair_runs (
        id TEXT PRIMARY KEY,
        client_request_id TEXT NOT NULL,
        session_sha256 TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
        policy_ir_sha256 TEXT NOT NULL,
        input_sha256 TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        result_json TEXT,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_sha256, client_request_id)
      );
      CREATE TABLE repair_run_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        type TEXT NOT NULL,
        phase TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        UNIQUE(run_id, sequence),
        FOREIGN KEY (run_id) REFERENCES repair_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX repair_runs_session_idx
        ON repair_runs(session_sha256, created_at DESC);
      CREATE INDEX repair_run_events_run_idx
        ON repair_run_events(run_id, sequence);
      PRAGMA user_version = 1;
    `);
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new RepairRunPersistenceError("CLOSED", "Repair-run repository is closed.");
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
      if (error instanceof RepairRunPersistenceError) throw error;
      throw new RepairRunPersistenceError("STORAGE_FAILURE", "Repair-run transaction failed.");
    }
  }

  #runFromRow(row: Row): RepairRunRecord {
    const resultJson = row.result_json;
    const failureJson = row.failure_json;
    let parsedResult: RepairRunResultSummary | null = null;
    let parsedFailure: RepairRunFailure | null = null;
    try {
      parsedResult = resultJson === null ? null : resultSummary(JSON.parse(rowString(row, "result_json")));
      parsedFailure = failureJson === null ? null : failure(JSON.parse(rowString(row, "failure_json")));
    } catch (error) {
      if (error instanceof RepairRunPersistenceError && error.code === "CORRUPTED_STORAGE") {
        throw error;
      }
      throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored repair-run JSON is invalid.");
    }
    const executionMode = rowString(row, "execution_mode");
    if (
      executionMode !== "NOT_STARTED" &&
      executionMode !== "LIVE_EXECUTION_UNVERIFIED" &&
      executionMode !== "LIVE_CODEX_SDK"
    ) {
      throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored execution mode is invalid.");
    }
    return {
      schemaVersion: "1",
      id: rowString(row, "id"),
      clientRequestId: rowString(row, "client_request_id"),
      policyId: rowString(row, "policy_id"),
      policyVersion: rowInteger(row, "policy_version"),
      policyIrSha256: rowString(row, "policy_ir_sha256"),
      inputSha256: rowString(row, "input_sha256"),
      status: status(rowString(row, "status")),
      phase: phase(rowString(row, "phase")),
      executionMode,
      result: parsedResult,
      failure: parsedFailure,
      createdAt: storedTimestamp(rowString(row, "created_at"), "repair-run created time"),
      updatedAt: storedTimestamp(rowString(row, "updated_at"), "repair-run updated time"),
    };
  }

  #eventFromRow(row: Row): RepairRunEvent {
    let detail: RepairRunEventDetail;
    try {
      detail = eventDetail(JSON.parse(rowString(row, "detail_json")));
    } catch {
      throw new RepairRunPersistenceError("CORRUPTED_STORAGE", "Stored repair-run event is invalid.");
    }
    return {
      schemaVersion: "1",
      runId: rowString(row, "run_id"),
      sequence: rowInteger(row, "sequence"),
      type: eventType(rowString(row, "type")),
      phase: phase(rowString(row, "phase")),
      occurredAt: storedTimestamp(rowString(row, "occurred_at"), "repair-run event time"),
      detail,
    };
  }

  #getRunById(runId: string): RepairRunRecord | null {
    const row = this.#database
      .prepare(
        "SELECT id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at FROM repair_runs WHERE id = ?",
      )
      .get(runId) as Row | undefined;
    return row ? this.#runFromRow(row) : null;
  }

  #appendEvent(
    runId: string,
    typeValue: RepairRunEventType,
    phaseValue: RepairRunPhase,
    detailValue: RepairRunEventDetail,
    occurredAt: string,
  ): void {
    const nextRow = this.#database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM repair_run_events WHERE run_id = ?")
      .get(runId) as Row;
    const sequence = rowInteger(nextRow, "next_sequence");
    if (sequence > MAX_EVENTS_PER_RUN) {
      throw new RepairRunPersistenceError(
        "INVALID_TRANSITION",
        "Repair run exceeded the bounded event history.",
      );
    }
    const detail = eventDetail(detailValue);
    this.#database
      .prepare(
        "INSERT INTO repair_run_events(run_id,sequence,type,phase,occurred_at,detail_json) VALUES (?,?,?,?,?,?)",
      )
      .run(runId, sequence, typeValue, phaseValue, occurredAt, JSON.stringify(detail));
  }

  createOrGetRun(value: CreateRepairRunInput): { run: RepairRunRecord; created: boolean } {
    this.#ensureOpen();
    if (!CLIENT_REQUEST_ID.test(value.clientRequestId)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run client request ID is invalid.");
    }
    const sessionSha256 = sha256(value.sessionSha256, "repair-run session binding");
    const policyId = identifier(value.policyId, "repair-run policy ID");
    const policyVersion = positiveInteger(value.policyVersion, "repair-run policy version", 1_000_000);
    const policyIrSha256 = sha256(value.policyIrSha256, "repair-run PolicyIR hash");
    const inputSha256 = sha256(value.inputSha256, "repair-run input hash");
    const createdAt = canonicalTimestamp(value.createdAt, "repair-run creation time");
    return this.#transaction(() => {
      const existingRow = this.#database
        .prepare(
          "SELECT id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at FROM repair_runs WHERE session_sha256 = ? AND client_request_id = ?",
        )
        .get(sessionSha256, value.clientRequestId) as Row | undefined;
      if (existingRow) {
        const existing = this.#runFromRow(existingRow);
        if (
          existing.policyId !== policyId ||
          existing.policyVersion !== policyVersion ||
          existing.policyIrSha256 !== policyIrSha256 ||
          existing.inputSha256 !== inputSha256
        ) {
          throw new RepairRunPersistenceError(
            "IDEMPOTENCY_CONFLICT",
            "Repair-run request ID was reused for different input.",
          );
        }
        return { run: existing, created: false };
      }
      const active = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM repair_runs WHERE status IN ('QUEUED','RUNNING','CLEANUP_PENDING','POISONED')",
        )
        .get() as Row;
      if (rowInteger(active, "count") > 0) {
        throw new RepairRunPersistenceError(
          "RUN_BUSY",
          "The guarded repair executor already has an active or fail-stop run.",
        );
      }
      const count = this.#database
        .prepare("SELECT COUNT(*) AS count FROM repair_runs WHERE session_sha256 = ?")
        .get(sessionSha256) as Row;
      if (rowInteger(count, "count") >= MAX_RUNS_PER_SESSION) {
        throw new RepairRunPersistenceError(
          "RUN_CAPACITY",
          "This session has reached the repair-run history limit.",
        );
      }
      let runId: string;
      do {
        runId = `rr_${randomBytes(16).toString("hex")}`;
      } while (this.#getRunById(runId));
      this.#database
        .prepare(
          "INSERT INTO repair_runs(id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          runId,
          value.clientRequestId,
          sessionSha256,
          policyId,
          policyVersion,
          policyIrSha256,
          inputSha256,
          "QUEUED",
          "ADMISSION",
          "NOT_STARTED",
          null,
          null,
          createdAt,
          createdAt,
        );
      this.#appendEvent(
        runId,
        "RUN_CREATED",
        "ADMISSION",
        { message: "Repair run was admitted to the guarded execution queue." },
        createdAt,
      );
      const run = this.#getRunById(runId);
      if (!run) {
        throw new RepairRunPersistenceError("STORAGE_FAILURE", "Created repair run cannot be read.");
      }
      return { run, created: true };
    });
  }

  pruneTerminalRunsForPolicy(policyIdValue: unknown): {
    deletedRuns: number;
    retainedFailStopRuns: number;
  } {
    this.#ensureOpen();
    const policyId = identifier(policyIdValue, "repair-run policy ID");
    return this.#transaction(() => {
      const deleted = this.#database
        .prepare(
          "DELETE FROM repair_runs WHERE policy_id = ? AND status IN ('BLOCKED','FAILED','SUCCEEDED')",
        )
        .run(policyId);
      const retained = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM repair_runs WHERE policy_id = ? AND status IN ('QUEUED','RUNNING','CLEANUP_PENDING','POISONED')",
        )
        .get(policyId) as Row;
      return {
        deletedRuns: Number(deleted.changes),
        retainedFailStopRuns: rowInteger(retained, "count"),
      };
    });
  }

  getRunForSession(runIdValue: unknown, sessionSha256Value: unknown): RepairRunRecord | null {
    this.#ensureOpen();
    if (typeof runIdValue !== "string" || !RUN_ID.test(runIdValue)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run ID is invalid.");
    }
    const sessionSha256 = sha256(sessionSha256Value, "repair-run session binding");
    const row = this.#database
      .prepare(
        "SELECT id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at FROM repair_runs WHERE id = ? AND session_sha256 = ?",
      )
      .get(runIdValue, sessionSha256) as Row | undefined;
    return row ? this.#runFromRow(row) : null;
  }

  getLatestRunForSession(sessionSha256Value: unknown): RepairRunRecord | null {
    this.#ensureOpen();
    const sessionSha256 = sha256(sessionSha256Value, "repair-run session binding");
    const row = this.#database
      .prepare(
        "SELECT id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at FROM repair_runs WHERE session_sha256 = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(sessionSha256) as Row | undefined;
    return row ? this.#runFromRow(row) : null;
  }

  listEventsForSession(
    runIdValue: unknown,
    sessionSha256Value: unknown,
    afterSequenceValue = 0,
    limitValue = 100,
  ): RepairRunEvent[] {
    this.#ensureOpen();
    const run = this.getRunForSession(runIdValue, sessionSha256Value);
    if (!run) {
      throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found for this session.");
    }
    if (
      !Number.isSafeInteger(afterSequenceValue) ||
      afterSequenceValue < 0 ||
      !Number.isSafeInteger(limitValue) ||
      limitValue < 1 ||
      limitValue > 200
    ) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run event cursor is invalid.");
    }
    return (this.#database
      .prepare(
        "SELECT run_id,sequence,type,phase,occurred_at,detail_json FROM repair_run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(run.id, afterSequenceValue, limitValue) as Row[]).map((row) => this.#eventFromRow(row));
  }

  markRunning(runId: string, occurredAtValue: string): RepairRunRecord {
    return this.#transition(runId, ["QUEUED"], {
      status: "RUNNING",
      phase: "ADMISSION",
      executionMode: "LIVE_EXECUTION_UNVERIFIED",
      result: null,
      failure: null,
      eventType: "RUN_STARTED",
      detail: { message: "The admitted external worker execution started." },
      occurredAt: occurredAtValue,
    });
  }

  appendProgress(
    runId: string,
    typeValue: "PHASE_STARTED" | "PHASE_COMPLETED",
    phaseValue: Exclude<RepairRunPhase, "ADMISSION" | "COMPLETE">,
    detailValue: RepairRunEventDetail,
    occurredAtValue: string,
  ): RepairRunRecord {
    this.#ensureOpen();
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair-run progress time");
    const detail = eventDetail(detailValue);
    return this.#transaction(() => {
      const run = this.#getRunById(runId);
      if (!run) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
      if (run.status !== "RUNNING") {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Only a running repair may progress.");
      }
      const lastRow = this.#database
        .prepare(
          "SELECT type,phase FROM repair_run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get(runId) as Row | undefined;
      const currentIndex = REPAIR_RUN_PHASES.indexOf(run.phase);
      const nextIndex = REPAIR_RUN_PHASES.indexOf(phaseValue);
      const lastType = lastRow ? eventType(rowString(lastRow, "type")) : null;
      const lastPhase = lastRow ? phase(rowString(lastRow, "phase")) : null;
      const startIsOrdered =
        typeValue === "PHASE_STARTED" &&
        nextIndex === currentIndex + 1 &&
        ((phaseValue === "CARTOGRAPHY" &&
          lastType === "RUN_STARTED" &&
          lastPhase === "ADMISSION") ||
          (phaseValue !== "CARTOGRAPHY" &&
            lastType === "PHASE_COMPLETED" &&
            REPAIR_RUN_PHASES.indexOf(lastPhase as RepairRunPhase) === nextIndex - 1));
      const completionIsOrdered =
        typeValue === "PHASE_COMPLETED" &&
        phaseValue === run.phase &&
        lastType === "PHASE_STARTED" &&
        lastPhase === phaseValue;
      if (!startIsOrdered && !completionIsOrdered) {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Repair-run phase order is invalid.");
      }
      this.#database
        .prepare("UPDATE repair_runs SET phase = ?, updated_at = ? WHERE id = ?")
        .run(phaseValue, occurredAt, runId);
      this.#appendEvent(runId, typeValue, phaseValue, detail, occurredAt);
      return this.#getRunById(runId) as RepairRunRecord;
    });
  }

  markBlocked(runId: string, failureValue: RepairRunFailure, occurredAtValue: string): RepairRunRecord {
    return this.#transition(runId, ["QUEUED"], {
      status: "BLOCKED",
      phase: "ADMISSION",
      executionMode: "NOT_STARTED",
      result: null,
      failure: failureValue,
      eventType: "RUN_BLOCKED",
      detail: { message: failureValue.message },
      occurredAt: occurredAtValue,
    });
  }

  markCleanupPending(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
  ): RepairRunRecord {
    return this.#transition(runId, ["RUNNING"], {
      status: "CLEANUP_PENDING",
      phase: "COMPLETE",
      executionMode: "LIVE_EXECUTION_UNVERIFIED",
      result: null,
      failure: failureValue,
      eventType: "RUN_CLEANUP_PENDING",
      detail: { message: failureValue.message },
      occurredAt: occurredAtValue,
    });
  }

  markPoisoned(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
  ): RepairRunRecord {
    const current = this.#getRunById(runId);
    if (!current) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
    return this.#transition(runId, ["RUNNING", "CLEANUP_PENDING"], {
      status: "POISONED",
      phase: "COMPLETE",
      executionMode: current.executionMode,
      result: null,
      failure: failureValue,
      eventType: "RUN_POISONED",
      detail: { message: failureValue.message },
      occurredAt: occurredAtValue,
    });
  }

  markSucceeded(
    runId: string,
    validatedRun: ValidatedExternalWorkerV2Run,
    occurredAtValue: string,
  ): RepairRunRecord {
    assertConsumedExternalWorkerV2Run(validatedRun);
    const result = resultSummary(repairRunSummaryFromValidatedExternalRun(validatedRun));
    const current = this.#getRunById(runId);
    const lastEventRow = current
      ? (this.#database
          .prepare(
            "SELECT type,phase FROM repair_run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(runId) as Row | undefined)
      : undefined;
    if (
      !current ||
      current.status !== "RUNNING" ||
      current.phase !== "REVIEW" ||
      !lastEventRow ||
      eventType(rowString(lastEventRow, "type")) !== "PHASE_COMPLETED" ||
      phase(rowString(lastEventRow, "phase")) !== "REVIEW"
    ) {
      throw new RepairRunPersistenceError(
        current ? "INVALID_TRANSITION" : "RUN_NOT_FOUND",
        "A successful repair run requires a completed review phase.",
      );
    }
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair-run success time");
    const completedAt = canonicalTimestamp(
      validatedRun.completedAt,
      "authenticated external-worker completion time",
    );
    if (
      validatedRun.requestId !== workerRpcRequestIdForRepairRun(runId) ||
      validatedRun.inputSha256 !== current.inputSha256 ||
      Date.parse(completedAt) < Date.parse(current.createdAt) ||
      Date.parse(completedAt) > Date.parse(occurredAt) + 5_000
    ) {
      throw new RepairRunPersistenceError(
        "INVALID_INPUT",
        "Authenticated external-worker result is not bound to this stored repair run.",
      );
    }
    const finalCommands = result.commands;
    if (
      result.verification.status !== "PASS" ||
      result.verification.passed !== result.verification.total ||
      result.review?.verdict !== "APPROVE" ||
      result.review.blockingFindingCount !== 0 ||
      JSON.stringify(result.changedFiles) !==
        JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"]) ||
      finalCommands.length !== 2 ||
      finalCommands[0]?.commandId !== "fixture-typecheck" ||
      finalCommands[1]?.commandId !== "fixture-test" ||
      finalCommands.some(
        (item) =>
          item.attempt !== result.attempts || item.exitCode !== 0 || item.timedOut,
      )
    ) {
      throw new RepairRunPersistenceError(
        "INVALID_INPUT",
        "A successful repair run requires complete passing verification and review.",
      );
    }
    return this.#transition(runId, ["RUNNING"], {
      status: "SUCCEEDED",
      phase: "COMPLETE",
      executionMode: "LIVE_CODEX_SDK",
      result,
      failure: null,
      eventType: "RUN_SUCCEEDED",
      detail: {
        message: "Live Codex repair, server-owned verification, and independent review passed.",
        changedFiles: result.changedFiles,
        passed: result.verification.passed,
        total: result.verification.total,
        reviewVerdict: result.review.verdict,
      },
      occurredAt,
    });
  }

  markFailed(runId: string, failureValue: RepairRunFailure, occurredAtValue: string): RepairRunRecord {
    const run = this.#getRunById(runId);
    if (!run) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
    return this.#transition(runId, ["QUEUED"], {
      status: "FAILED",
      phase: "COMPLETE",
      executionMode: run.executionMode,
      result: null,
      failure: failureValue,
      eventType: "RUN_FAILED",
      detail: { message: failureValue.message },
      occurredAt: occurredAtValue,
    });
  }

  markFailedAfterVerifiedSettlement(
    runId: string,
    validatedRun: ValidatedExternalWorkerV2Run,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
  ): RepairRunRecord {
    assertConsumedExternalWorkerV2Run(validatedRun);
    const run = this.#getRunById(runId);
    if (!run) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair-run settlement time");
    const completedAt = canonicalTimestamp(
      validatedRun.completedAt,
      "authenticated external-worker completion time",
    );
    if (
      validatedRun.requestId !== workerRpcRequestIdForRepairRun(runId) ||
      validatedRun.inputSha256 !== run.inputSha256 ||
      Date.parse(completedAt) < Date.parse(run.createdAt) ||
      Date.parse(completedAt) > Date.parse(occurredAt) + 5_000
    ) {
      throw new RepairRunPersistenceError(
        "INVALID_INPUT",
        "Authenticated external-worker settlement is not bound to this stored repair run.",
      );
    }
    return this.#transition(runId, ["RUNNING", "CLEANUP_PENDING"], {
      status: "FAILED",
      phase: "COMPLETE",
      executionMode: run.executionMode,
      result: null,
      failure: failureValue,
      eventType: "RUN_FAILED",
      detail: { message: failureValue.message },
      occurredAt,
    });
  }

  #transition(
    runIdValue: unknown,
    allowedStatuses: RepairRunStatus[],
    next: {
      status: RepairRunStatus;
      phase: RepairRunPhase;
      executionMode: "NOT_STARTED" | "LIVE_EXECUTION_UNVERIFIED" | "LIVE_CODEX_SDK";
      result: RepairRunResultSummary | null;
      failure: RepairRunFailure | null;
      eventType: RepairRunEventType;
      detail: RepairRunEventDetail;
      occurredAt: string;
    },
  ): RepairRunRecord {
    this.#ensureOpen();
    if (typeof runIdValue !== "string" || !RUN_ID.test(runIdValue)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run ID is invalid.");
    }
    const occurredAt = canonicalTimestamp(next.occurredAt, "repair-run transition time");
    const parsedFailure = next.failure === null ? null : failure(next.failure);
    const parsedResult = next.result === null ? null : resultSummary(next.result);
    const detail = eventDetail(next.detail);
    return this.#transaction(() => {
      const run = this.#getRunById(runIdValue);
      if (!run) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
      if (!allowedStatuses.includes(run.status) || occurredAt < run.updatedAt) {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Repair-run transition is stale or invalid.");
      }
      const update = this.#database
        .prepare(
          `UPDATE repair_runs SET status = ?, phase = ?, execution_mode = ?, result_json = ?, failure_json = ?, updated_at = ? WHERE id = ? AND status = ?`,
        )
        .run(
          next.status,
          next.phase,
          next.executionMode,
          parsedResult === null ? null : JSON.stringify(parsedResult),
          parsedFailure === null ? null : JSON.stringify(parsedFailure),
          occurredAt,
          runIdValue,
          run.status,
        );
      if (Number(update.changes) !== 1) {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Repair-run state changed concurrently.");
      }
      this.#appendEvent(runIdValue, next.eventType, next.phase, detail, occurredAt);
      return this.#getRunById(runIdValue) as RepairRunRecord;
    });
  }

  recoverInterruptedRuns(occurredAtValue: string): number {
    this.#ensureOpen();
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair-run recovery time");
    const queuedRows = this.#database
      .prepare("SELECT id FROM repair_runs WHERE status = 'QUEUED' ORDER BY created_at")
      .all() as Row[];
    for (const row of queuedRows) {
      this.markFailed(
        rowString(row, "id"),
        {
          code: "PROCESS_RESTARTED",
          message: "The server restarted before the guarded repair run reached a terminal state.",
        },
        occurredAt,
      );
    }
    const uncleanRows = this.#database
      .prepare("SELECT id FROM repair_runs WHERE status IN ('RUNNING','CLEANUP_PENDING') ORDER BY created_at")
      .all() as Row[];
    for (const row of uncleanRows) {
      this.markPoisoned(
        rowString(row, "id"),
        {
          code: "PROCESS_RESTARTED_WITHOUT_CLEANUP",
          message:
            "The server restarted without a verified external-worker settlement or cleanup receipt.",
        },
        occurredAt,
      );
    }
    return queuedRows.length + uncleanRows.length;
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }
}
