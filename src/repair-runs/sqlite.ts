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

const SCHEMA_VERSION = 2;
const MAX_RUNS_PER_SESSION = 16;
const MAX_EVENTS_PER_RUN = 64;
const MIN_LEASE_DURATION_MS = 100;
const MAX_LEASE_DURATION_MS = 60_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CLIENT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID = /^rr_[0-9a-f]{32}$/u;
const EXECUTOR_OWNER_ID = /^reo_[0-9a-f]{32}$/u;
const FENCE_TOKEN = /^[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

type Row = Record<string, null | number | bigint | string | Uint8Array>;

export interface RepairExecutorLease {
  readonly kind: "REPAIR_EXECUTOR_LEASE";
  readonly runId: string;
}

interface RepairExecutorLeaseBinding {
  repository: SQLiteRepairRunRepository;
  ownerId: string;
  fenceToken: string;
  fenceGeneration: number;
  runId: string;
}

const REPAIR_EXECUTOR_LEASE_BINDINGS = new WeakMap<object, RepairExecutorLeaseBinding>();

export class RepairRunPersistenceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "IDEMPOTENCY_CONFLICT"
      | "RUN_BUSY"
      | "RUN_CAPACITY"
      | "RUN_NOT_FOUND"
      | "LEASE_INVALID"
      | "CLOCK_ROLLBACK"
      | "INVALID_TRANSITION"
      | "CORRUPTED_STORAGE"
      | "UNSUPPORTED_SCHEMA"
      | "MIGRATION_REQUIRES_DRAIN"
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

function executorOwnerId(value: unknown): string {
  if (typeof value !== "string" || !EXECUTOR_OWNER_ID.test(value)) {
    throw new RepairRunPersistenceError(
      "INVALID_INPUT",
      "Repair executor owner identity is invalid.",
    );
  }
  return value;
}

function leaseDuration(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MIN_LEASE_DURATION_MS ||
    value > MAX_LEASE_DURATION_MS
  ) {
    throw new RepairRunPersistenceError(
      "INVALID_INPUT",
      `Repair executor lease duration must be an integer from ${MIN_LEASE_DURATION_MS}ms to ${MAX_LEASE_DURATION_MS}ms.`,
    );
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

export interface RepairExecutorLeaseRequest {
  ownerId: string;
  leaseDurationMs: number;
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
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error;
    }
  }

  #initialize(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#migrateSchema();
    const quickCheck = this.#database.prepare("PRAGMA quick_check").get() as Row | undefined;
    if (!quickCheck || rowString(quickCheck, "quick_check") !== "ok") {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair-run storage integrity check failed.",
      );
    }
    const foreignKeyFailures = this.#database.prepare("PRAGMA foreign_key_check").all() as Row[];
    if (foreignKeyFailures.length !== 0) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair-run storage foreign-key check failed.",
      );
    }
    const authorityRows = this.#database
      .prepare(
        "SELECT singleton,owner_id,fence_token,run_id,heartbeat_at_ms,expires_at_ms,fence_generation,high_water_at_ms FROM repair_executor_authority",
      )
      .all() as Row[];
    if (authorityRows.length !== 1 || rowInteger(authorityRows[0] as Row, "singleton") !== 1) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor authority singleton is invalid.",
      );
    }
    const authorityHighWater = rowInteger(authorityRows[0] as Row, "high_water_at_ms");
    const maximumStoredRunTime = (this.#database
      .prepare("SELECT updated_at FROM repair_runs")
      .all() as Row[]).reduce((maximum, row) => {
      const milliseconds = Date.parse(
        storedTimestamp(rowString(row, "updated_at"), "repair-run updated time"),
      );
      return Math.max(maximum, milliseconds);
    }, 0);
    if (authorityHighWater < maximumStoredRunTime) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor high-water mark is behind stored run state.",
      );
    }
  }

  #schemaVersion(): number {
    const row = this.#database.prepare("PRAGMA user_version").get() as Row | undefined;
    return row ? rowInteger(row, "user_version") : 0;
  }

  #migrateSchema(): void {
    const initialVersion = this.#schemaVersion();
    if (initialVersion < 0 || initialVersion > SCHEMA_VERSION) {
      throw new RepairRunPersistenceError(
        "UNSUPPORTED_SCHEMA",
        `Unsupported repair-run schema version: ${initialVersion}.`,
      );
    }
    if (initialVersion === SCHEMA_VERSION) return;
    try {
      this.#database.exec("BEGIN IMMEDIATE");
    } catch {
      throw new RepairRunPersistenceError(
        "STORAGE_FAILURE",
        "Repair-run schema migration could not acquire exclusive write authority.",
      );
    }
    try {
      const version = this.#schemaVersion();
      if (version < 0 || version > SCHEMA_VERSION) {
        throw new RepairRunPersistenceError(
          "UNSUPPORTED_SCHEMA",
          `Unsupported repair-run schema version: ${version}.`,
        );
      }
      if (version === 0) {
        const existingObjects = this.#database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as Row[];
        if (existingObjects.length !== 0) {
          throw new RepairRunPersistenceError(
            "CORRUPTED_STORAGE",
            "Unversioned repair-run storage contains unexpected schema objects.",
          );
        }
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
            write_generation INTEGER NOT NULL DEFAULT 0 CHECK (write_generation >= 0),
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
        `);
      }
      if (version <= 1) {
        if (version === 1) {
          const active = this.#database
            .prepare(
              "SELECT COUNT(*) AS count FROM repair_runs WHERE status IN ('QUEUED','RUNNING','CLEANUP_PENDING')",
            )
            .get() as Row;
          if (rowInteger(active, "count") !== 0) {
            throw new RepairRunPersistenceError(
              "MIGRATION_REQUIRES_DRAIN",
              "Repair-run schema v1 has active work and must be drained before migration.",
            );
          }
          this.#database.exec(
            "ALTER TABLE repair_runs ADD COLUMN write_generation INTEGER NOT NULL DEFAULT 0 CHECK (write_generation >= 0)",
          );
        }
        this.#database.exec(`
          CREATE TABLE repair_executor_authority (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            owner_id TEXT,
            fence_token TEXT UNIQUE,
            run_id TEXT,
            heartbeat_at_ms INTEGER,
            expires_at_ms INTEGER,
            fence_generation INTEGER NOT NULL CHECK (fence_generation >= 0),
            high_water_at_ms INTEGER NOT NULL CHECK (high_water_at_ms >= 0),
            CHECK (
              (
                owner_id IS NULL AND
                fence_token IS NULL AND
                run_id IS NULL AND
                heartbeat_at_ms IS NULL AND
                expires_at_ms IS NULL
              ) OR
              (
                owner_id IS NOT NULL AND
                fence_token IS NOT NULL AND
                run_id IS NOT NULL AND
                heartbeat_at_ms IS NOT NULL AND
                expires_at_ms IS NOT NULL AND
                heartbeat_at_ms >= 0 AND
                expires_at_ms > heartbeat_at_ms
              )
            ),
            FOREIGN KEY (run_id) REFERENCES repair_runs(id) ON DELETE RESTRICT
          ) STRICT;
          CREATE TRIGGER repair_runs_active_write_guard
          BEFORE UPDATE ON repair_runs
          WHEN OLD.status IN ('QUEUED','RUNNING','CLEANUP_PENDING')
            AND NEW.write_generation <> OLD.write_generation + 1
          BEGIN
            SELECT RAISE(ABORT, 'repair_executor_lease_required');
          END;
          CREATE TRIGGER repair_runs_insert_guard
          BEFORE INSERT ON repair_runs
          WHEN NEW.status <> 'QUEUED' OR NEW.write_generation <> 1
          BEGIN
            SELECT RAISE(ABORT, 'repair_executor_v2_admission_required');
          END;
        `);
        const maximumStoredRunTime = (this.#database
          .prepare("SELECT updated_at FROM repair_runs")
          .all() as Row[]).reduce((maximum, row) => {
          const milliseconds = Date.parse(
            storedTimestamp(rowString(row, "updated_at"), "repair-run updated time"),
          );
          return Math.max(maximum, milliseconds);
        }, 0);
        this.#database
          .prepare(
            "INSERT INTO repair_executor_authority(singleton,owner_id,fence_token,run_id,heartbeat_at_ms,expires_at_ms,fence_generation,high_water_at_ms) VALUES (1,NULL,NULL,NULL,NULL,NULL,0,?)",
          )
          .run(maximumStoredRunTime);
        this.#database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        throw new RepairRunPersistenceError(
          "STORAGE_FAILURE",
          "Repair-run schema migration failed and rollback could not be confirmed.",
        );
      }
      if (error instanceof RepairRunPersistenceError) throw error;
      throw new RepairRunPersistenceError(
        "STORAGE_FAILURE",
        "Repair-run schema migration failed.",
      );
    }
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

  #authorityRow(): Row {
    const row = this.#database
      .prepare(
        "SELECT singleton,owner_id,fence_token,run_id,heartbeat_at_ms,expires_at_ms,fence_generation,high_water_at_ms FROM repair_executor_authority WHERE singleton = 1",
      )
      .get() as Row | undefined;
    if (!row || rowInteger(row, "singleton") !== 1) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor authority singleton is missing.",
      );
    }
    const fenceGeneration = rowInteger(row, "fence_generation");
    const highWater = rowInteger(row, "high_water_at_ms");
    if (fenceGeneration < 0 || highWater < 0) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor authority counters are invalid.",
      );
    }
    const leaseValues = [
      row.owner_id,
      row.fence_token,
      row.run_id,
      row.heartbeat_at_ms,
      row.expires_at_ms,
    ];
    if (leaseValues.every((value) => value === null)) return row;
    if (
      typeof row.owner_id !== "string" ||
      !EXECUTOR_OWNER_ID.test(row.owner_id) ||
      typeof row.fence_token !== "string" ||
      !FENCE_TOKEN.test(row.fence_token) ||
      typeof row.run_id !== "string" ||
      !RUN_ID.test(row.run_id)
    ) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor authority binding is invalid.",
      );
    }
    const heartbeatAt = rowInteger(row, "heartbeat_at_ms");
    const expiresAt = rowInteger(row, "expires_at_ms");
    if (heartbeatAt < 0 || expiresAt <= heartbeatAt) {
      throw new RepairRunPersistenceError(
        "CORRUPTED_STORAGE",
        "Repair executor lease time is invalid.",
      );
    }
    return row;
  }

  #observeTime(currentMs: number): void {
    if (!Number.isSafeInteger(currentMs) || currentMs < 0) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair executor time is invalid.");
    }
    const authority = this.#authorityRow();
    const highWater = rowInteger(authority, "high_water_at_ms");
    if (currentMs < highWater) {
      throw new RepairRunPersistenceError(
        "CLOCK_ROLLBACK",
        "Repair executor clock moved behind its durable high-water mark.",
      );
    }
    if (currentMs > highWater) {
      const update = this.#database
        .prepare(
          "UPDATE repair_executor_authority SET high_water_at_ms = ? WHERE singleton = 1 AND high_water_at_ms = ?",
        )
        .run(currentMs, highWater);
      if (Number(update.changes) !== 1) {
        throw new RepairRunPersistenceError(
          "INVALID_TRANSITION",
          "Repair executor clock changed concurrently.",
        );
      }
    }
  }

  #leaseBinding(value: unknown): RepairExecutorLeaseBinding {
    if (typeof value !== "object" || value === null) {
      throw new RepairRunPersistenceError("LEASE_INVALID", "Repair executor lease is invalid.");
    }
    const binding = REPAIR_EXECUTOR_LEASE_BINDINGS.get(value);
    if (!binding || binding.repository !== this) {
      throw new RepairRunPersistenceError(
        "LEASE_INVALID",
        "Repair executor lease is foreign, copied, or stale.",
      );
    }
    return binding;
  }

  #leaseBindingForRun(value: unknown, runId: string): RepairExecutorLeaseBinding {
    const binding = this.#leaseBinding(value);
    if (binding.runId !== runId) {
      throw new RepairRunPersistenceError(
        "LEASE_INVALID",
        "Repair executor lease is not bound to this run.",
      );
    }
    return binding;
  }

  #assertLeaseCurrent(binding: RepairExecutorLeaseBinding, currentMs: number): Row {
    const authority = this.#authorityRow();
    if (
      authority.owner_id !== binding.ownerId ||
      authority.fence_token !== binding.fenceToken ||
      authority.run_id !== binding.runId ||
      rowInteger(authority, "fence_generation") !== binding.fenceGeneration ||
      rowInteger(authority, "expires_at_ms") <= currentMs
    ) {
      throw new RepairRunPersistenceError(
        "LEASE_INVALID",
        "Repair executor lease is foreign, expired, or fenced.",
      );
    }
    return authority;
  }

  #leaseFor(binding: Omit<RepairExecutorLeaseBinding, "repository">): RepairExecutorLease {
    const lease = Object.freeze({
      kind: "REPAIR_EXECUTOR_LEASE" as const,
      runId: binding.runId,
    });
    REPAIR_EXECUTOR_LEASE_BINDINGS.set(lease, { repository: this, ...binding });
    return lease;
  }

  #clearLease(binding: RepairExecutorLeaseBinding): void {
    const update = this.#database
      .prepare(
        "UPDATE repair_executor_authority SET owner_id = NULL, fence_token = NULL, run_id = NULL, heartbeat_at_ms = NULL, expires_at_ms = NULL WHERE singleton = 1 AND owner_id = ? AND fence_token = ? AND fence_generation = ? AND run_id = ?",
      )
      .run(binding.ownerId, binding.fenceToken, binding.fenceGeneration, binding.runId);
    if (Number(update.changes) !== 1) {
      throw new RepairRunPersistenceError(
        "LEASE_INVALID",
        "Repair executor lease changed before release.",
      );
    }
  }

  #recoverRunWithoutLease(
    run: RepairRunRecord,
    currentMs: number,
    leaseExpired: boolean,
    failureOverride?: RepairRunFailure,
  ): void {
    const occurredAt = new Date(currentMs).toISOString();
    if (currentMs < Date.parse(run.updatedAt)) {
      throw new RepairRunPersistenceError(
        "CLOCK_ROLLBACK",
        "Repair-run recovery time is behind the stored run state.",
      );
    }
    const queued = run.status === "QUEUED";
    if (!queued && run.status !== "RUNNING" && run.status !== "CLEANUP_PENDING") return;
    const nextStatus: RepairRunStatus = queued ? "FAILED" : "POISONED";
    const code = queued
      ? leaseExpired
        ? "EXECUTOR_LEASE_EXPIRED_BEFORE_START"
        : "EXECUTOR_AUTHORITY_MISSING_BEFORE_START"
      : leaseExpired
        ? "EXECUTOR_LEASE_EXPIRED_WITHOUT_CLEANUP"
        : "EXECUTOR_AUTHORITY_MISSING_WITHOUT_CLEANUP";
    const message = queued
      ? leaseExpired
        ? "The repair executor authority expired before external work started."
        : "The repair run had no executor authority before external work started."
      : leaseExpired
        ? "The repair executor authority expired without authenticated settlement or cleanup proof."
        : "The repair run had no executor authority and no authenticated settlement or cleanup proof.";
    const parsedFailure = failure(failureOverride ?? { code, message });
    const update = this.#database
      .prepare(
        "UPDATE repair_runs SET status = ?, phase = 'COMPLETE', result_json = NULL, failure_json = ?, updated_at = ?, write_generation = write_generation + 1 WHERE id = ? AND status = ?",
      )
      .run(nextStatus, JSON.stringify(parsedFailure), occurredAt, run.id, run.status);
    if (Number(update.changes) !== 1) {
      throw new RepairRunPersistenceError(
        "INVALID_TRANSITION",
        "Repair-run recovery state changed concurrently.",
      );
    }
    this.#appendEvent(
      run.id,
      queued ? "RUN_FAILED" : "RUN_POISONED",
      "COMPLETE",
      { message: parsedFailure.message },
      occurredAt,
    );
  }

  #reconcileExpiredExecutorLease(currentMs: number): number {
    const authority = this.#authorityRow();
    const boundRunId = authority.run_id;
    if (typeof boundRunId === "string") {
      if (rowInteger(authority, "expires_at_ms") > currentMs) return 0;
      const run = this.#getRunById(boundRunId);
      if (!run) {
        throw new RepairRunPersistenceError(
          "CORRUPTED_STORAGE",
          "Repair executor lease references a missing run.",
        );
      }
      this.#recoverRunWithoutLease(run, currentMs, true);
      this.#clearLease({
        repository: this,
        ownerId: rowString(authority, "owner_id"),
        fenceToken: rowString(authority, "fence_token"),
        fenceGeneration: rowInteger(authority, "fence_generation"),
        runId: boundRunId,
      });
      return 1;
    }
    const unownedRows = this.#database
      .prepare(
        "SELECT id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at FROM repair_runs WHERE status IN ('QUEUED','RUNNING','CLEANUP_PENDING') ORDER BY created_at,id",
      )
      .all() as Row[];
    for (const row of unownedRows) {
      this.#recoverRunWithoutLease(this.#runFromRow(row), currentMs, false);
    }
    return unownedRows.length;
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

  createOrGetRun(
    value: CreateRepairRunInput,
    leaseValue: RepairExecutorLeaseRequest,
  ): { run: RepairRunRecord; created: boolean; lease: RepairExecutorLease | null } {
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
    const currentMs = Date.parse(createdAt);
    const ownerId = executorOwnerId(leaseValue?.ownerId);
    const leaseDurationMs = leaseDuration(leaseValue?.leaseDurationMs);
    const expiresAtMs = currentMs + leaseDurationMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair executor lease expiry is invalid.");
    }
    this.reconcileExpiredExecutorLease(createdAt);
    return this.#transaction(() => {
      this.#observeTime(currentMs);
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
        return { run: existing, created: false, lease: null };
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
          "INSERT INTO repair_runs(id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at,write_generation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          1,
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
      const authority = this.#authorityRow();
      if (authority.run_id !== null) {
        throw new RepairRunPersistenceError(
          "RUN_BUSY",
          "The guarded repair executor already has an active authority lease.",
        );
      }
      const previousGeneration = rowInteger(authority, "fence_generation");
      const fenceGeneration = previousGeneration + 1;
      if (!Number.isSafeInteger(fenceGeneration)) {
        throw new RepairRunPersistenceError(
          "STORAGE_FAILURE",
          "Repair executor fence generation is exhausted.",
        );
      }
      const fenceToken = randomBytes(32).toString("hex");
      const issued = this.#database
        .prepare(
          "UPDATE repair_executor_authority SET owner_id = ?, fence_token = ?, run_id = ?, heartbeat_at_ms = ?, expires_at_ms = ?, fence_generation = ? WHERE singleton = 1 AND owner_id IS NULL AND fence_token IS NULL AND run_id IS NULL AND heartbeat_at_ms IS NULL AND expires_at_ms IS NULL AND fence_generation = ?",
        )
        .run(
          ownerId,
          fenceToken,
          run.id,
          currentMs,
          expiresAtMs,
          fenceGeneration,
          previousGeneration,
        );
      if (Number(issued.changes) !== 1) {
        throw new RepairRunPersistenceError(
          "RUN_BUSY",
          "Repair executor authority changed before lease issuance.",
        );
      }
      return {
        run,
        created: true,
        lease: this.#leaseFor({
          ownerId,
          fenceToken,
          fenceGeneration,
          runId: run.id,
        }),
      };
    });
  }

  reconcileExpiredExecutorLease(occurredAtValue: string): number {
    this.#ensureOpen();
    const occurredAt = canonicalTimestamp(
      occurredAtValue,
      "repair executor reconciliation time",
    );
    const currentMs = Date.parse(occurredAt);
    const observedAuthority = this.#authorityRow();
    const highWater = rowInteger(observedAuthority, "high_water_at_ms");
    if (currentMs < highWater) {
      throw new RepairRunPersistenceError(
        "CLOCK_ROLLBACK",
        "Repair executor clock moved behind its durable high-water mark.",
      );
    }
    if (
      typeof observedAuthority.run_id === "string" &&
      rowInteger(observedAuthority, "expires_at_ms") > currentMs
    ) {
      return 0;
    }
    if (observedAuthority.run_id === null) {
      const unownedActive = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM repair_runs WHERE status IN ('QUEUED','RUNNING','CLEANUP_PENDING')",
        )
        .get() as Row;
      if (rowInteger(unownedActive, "count") === 0) return 0;
    }
    return this.#transaction(() => {
      this.#observeTime(currentMs);
      return this.#reconcileExpiredExecutorLease(currentMs);
    });
  }

  heartbeatExecutorLease(
    leaseValue: RepairExecutorLease,
    occurredAtValue: string,
    leaseDurationValue: number,
  ): void {
    this.#ensureOpen();
    const binding = this.#leaseBinding(leaseValue);
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair executor heartbeat time");
    const currentMs = Date.parse(occurredAt);
    const leaseDurationMs = leaseDuration(leaseDurationValue);
    const expiresAtMs = currentMs + leaseDurationMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair executor lease expiry is invalid.");
    }
    this.#transaction(() => {
      this.#observeTime(currentMs);
      this.#assertLeaseCurrent(binding, currentMs);
      const update = this.#database
        .prepare(
          "UPDATE repair_executor_authority SET heartbeat_at_ms = ?, expires_at_ms = ? WHERE singleton = 1 AND owner_id = ? AND fence_token = ? AND fence_generation = ? AND run_id = ? AND expires_at_ms > ?",
        )
        .run(
          currentMs,
          expiresAtMs,
          binding.ownerId,
          binding.fenceToken,
          binding.fenceGeneration,
          binding.runId,
          currentMs,
        );
      if (Number(update.changes) !== 1) {
        throw new RepairRunPersistenceError(
          "LEASE_INVALID",
          "Repair executor lease changed before heartbeat.",
        );
      }
    });
  }

  failStopAfterExecutorHeartbeatFailure(
    leaseValue: RepairExecutorLease,
    occurredAtValue: string,
    cause: "LEASE_INVALID" | "CLOCK_ROLLBACK",
  ): RepairRunRecord {
    this.#ensureOpen();
    const binding = this.#leaseBinding(leaseValue);
    const occurredAt = canonicalTimestamp(
      occurredAtValue,
      "repair executor heartbeat failure time",
    );
    if (cause !== "LEASE_INVALID" && cause !== "CLOCK_ROLLBACK") {
      throw new RepairRunPersistenceError(
        "INVALID_INPUT",
        "Repair executor heartbeat failure cause is invalid.",
      );
    }
    return this.#transaction(() => {
      const authority = this.#authorityRow();
      const highWater = rowInteger(authority, "high_water_at_ms");
      const providedMs = Date.parse(occurredAt);
      const logicalMs = Math.max(providedMs, highWater);
      if (providedMs > highWater) this.#observeTime(providedMs);
      const run = this.#getRunById(binding.runId);
      if (!run) {
        throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
      }
      if (
        run.status === "BLOCKED" ||
        run.status === "FAILED" ||
        run.status === "SUCCEEDED" ||
        run.status === "POISONED"
      ) {
        return run;
      }
      const authorityMatches =
        authority.owner_id === binding.ownerId &&
        authority.fence_token === binding.fenceToken &&
        authority.run_id === binding.runId &&
        rowInteger(authority, "fence_generation") === binding.fenceGeneration;
      if (!authorityMatches && authority.run_id !== null) {
        throw new RepairRunPersistenceError(
          "LEASE_INVALID",
          "A different repair executor authority owns the active run.",
        );
      }
      const failureValue =
        cause === "CLOCK_ROLLBACK"
          ? {
              code: "EXECUTOR_CLOCK_ROLLBACK_WITHOUT_CLEANUP",
              message:
                "The repair executor clock moved behind its durable high-water mark; execution was aborted without authenticated cleanup proof.",
            }
          : {
              code: "EXECUTOR_LEASE_LOST_WITHOUT_CLEANUP",
              message:
                "The repair executor lost its exact heartbeat lease; execution was aborted without authenticated cleanup proof.",
            };
      this.#recoverRunWithoutLease(run, logicalMs, false, failureValue);
      if (authorityMatches) this.#clearLease(binding);
      return this.#getRunById(binding.runId) as RepairRunRecord;
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

  markRunning(
    runId: string,
    occurredAtValue: string,
    lease: RepairExecutorLease,
  ): RepairRunRecord {
    return this.#transition(runId, ["QUEUED"], {
      status: "RUNNING",
      phase: "ADMISSION",
      executionMode: "LIVE_EXECUTION_UNVERIFIED",
      result: null,
      failure: null,
      eventType: "RUN_STARTED",
      detail: { message: "The admitted external worker execution started." },
      occurredAt: occurredAtValue,
    }, lease);
  }

  appendProgress(
    runId: string,
    typeValue: "PHASE_STARTED" | "PHASE_COMPLETED",
    phaseValue: Exclude<RepairRunPhase, "ADMISSION" | "COMPLETE">,
    detailValue: RepairRunEventDetail,
    occurredAtValue: string,
    leaseValue: RepairExecutorLease,
  ): RepairRunRecord {
    this.#ensureOpen();
    const binding = this.#leaseBindingForRun(leaseValue, runId);
    const occurredAt = canonicalTimestamp(occurredAtValue, "repair-run progress time");
    const currentMs = Date.parse(occurredAt);
    const detail = eventDetail(detailValue);
    return this.#transaction(() => {
      this.#observeTime(currentMs);
      this.#assertLeaseCurrent(binding, currentMs);
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
      const update = this.#database
        .prepare(
          "UPDATE repair_runs SET phase = ?, updated_at = ?, write_generation = write_generation + 1 WHERE id = ? AND status = 'RUNNING' AND EXISTS (SELECT 1 FROM repair_executor_authority WHERE singleton = 1 AND owner_id = ? AND fence_token = ? AND fence_generation = ? AND run_id = ? AND expires_at_ms > ?)",
        )
        .run(
          phaseValue,
          occurredAt,
          runId,
          binding.ownerId,
          binding.fenceToken,
          binding.fenceGeneration,
          runId,
          currentMs,
        );
      if (Number(update.changes) !== 1) {
        throw new RepairRunPersistenceError(
          "LEASE_INVALID",
          "Repair executor lease changed before progress was stored.",
        );
      }
      this.#appendEvent(runId, typeValue, phaseValue, detail, occurredAt);
      return this.#getRunById(runId) as RepairRunRecord;
    });
  }

  markBlocked(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
    lease: RepairExecutorLease,
  ): RepairRunRecord {
    return this.#transition(runId, ["QUEUED"], {
      status: "BLOCKED",
      phase: "ADMISSION",
      executionMode: "NOT_STARTED",
      result: null,
      failure: failureValue,
      eventType: "RUN_BLOCKED",
      detail: { message: failureValue.message },
      occurredAt: occurredAtValue,
    }, lease);
  }

  markCleanupPending(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
    lease: RepairExecutorLease,
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
    }, lease);
  }

  markPoisoned(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
    lease: RepairExecutorLease,
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
    }, lease);
  }

  markSucceeded(
    runId: string,
    validatedRun: ValidatedExternalWorkerV2Run,
    occurredAtValue: string,
    lease: RepairExecutorLease,
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
    }, lease);
  }

  markFailed(
    runId: string,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
    lease: RepairExecutorLease,
  ): RepairRunRecord {
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
    }, lease);
  }

  markFailedAfterVerifiedSettlement(
    runId: string,
    validatedRun: ValidatedExternalWorkerV2Run,
    failureValue: RepairRunFailure,
    occurredAtValue: string,
    lease: RepairExecutorLease,
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
    }, lease);
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
    leaseValue: RepairExecutorLease,
  ): RepairRunRecord {
    this.#ensureOpen();
    if (typeof runIdValue !== "string" || !RUN_ID.test(runIdValue)) {
      throw new RepairRunPersistenceError("INVALID_INPUT", "Repair-run ID is invalid.");
    }
    const binding = this.#leaseBindingForRun(leaseValue, runIdValue);
    const occurredAt = canonicalTimestamp(next.occurredAt, "repair-run transition time");
    const currentMs = Date.parse(occurredAt);
    const parsedFailure = next.failure === null ? null : failure(next.failure);
    const parsedResult = next.result === null ? null : resultSummary(next.result);
    const detail = eventDetail(next.detail);
    return this.#transaction(() => {
      this.#observeTime(currentMs);
      this.#assertLeaseCurrent(binding, currentMs);
      const run = this.#getRunById(runIdValue);
      if (!run) throw new RepairRunPersistenceError("RUN_NOT_FOUND", "Repair run was not found.");
      if (!allowedStatuses.includes(run.status) || occurredAt < run.updatedAt) {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Repair-run transition is stale or invalid.");
      }
      const update = this.#database
        .prepare(
          `UPDATE repair_runs SET status = ?, phase = ?, execution_mode = ?, result_json = ?, failure_json = ?, updated_at = ?, write_generation = write_generation + 1 WHERE id = ? AND status = ? AND EXISTS (SELECT 1 FROM repair_executor_authority WHERE singleton = 1 AND owner_id = ? AND fence_token = ? AND fence_generation = ? AND run_id = ? AND expires_at_ms > ?)`,
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
          binding.ownerId,
          binding.fenceToken,
          binding.fenceGeneration,
          runIdValue,
          currentMs,
        );
      if (Number(update.changes) !== 1) {
        throw new RepairRunPersistenceError("INVALID_TRANSITION", "Repair-run state changed concurrently.");
      }
      this.#appendEvent(runIdValue, next.eventType, next.phase, detail, occurredAt);
      if (
        next.status === "BLOCKED" ||
        next.status === "FAILED" ||
        next.status === "SUCCEEDED" ||
        next.status === "POISONED"
      ) {
        this.#clearLease(binding);
      }
      return this.#getRunById(runIdValue) as RepairRunRecord;
    });
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }
}
