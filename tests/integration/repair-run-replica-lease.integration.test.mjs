import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SQLiteRepairRunRepository } from "../../dist/index.js";

const SESSION_A = "a".repeat(64);
const SESSION_B = "b".repeat(64);
const OWNER_A = `reo_${"1".repeat(32)}`;
const OWNER_B = `reo_${"2".repeat(32)}`;

function runInput({
  clientRequestId,
  sessionSha256,
  createdAt,
}) {
  return {
    clientRequestId,
    sessionSha256,
    policyId: `policy-${sessionSha256.slice(0, 8)}`,
    policyVersion: 1,
    policyIrSha256: "c".repeat(64),
    inputSha256: "d".repeat(64),
    createdAt,
  };
}

function leaseRequest(ownerId, leaseDurationMs = 100) {
  return { ownerId, leaseDurationMs };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function createV1Database(databasePath, run) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
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
  if (run) {
    database
      .prepare(
        "INSERT INTO repair_runs(id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        run.id,
        run.clientRequestId,
        run.sessionSha256,
        "policy-v1-migration",
        1,
        "c".repeat(64),
        "d".repeat(64),
        run.status,
        run.status === "RUNNING" ? "ADMISSION" : "COMPLETE",
        run.status === "RUNNING" ? "LIVE_EXECUTION_UNVERIFIED" : "NOT_STARTED",
        null,
        run.status === "BLOCKED"
          ? JSON.stringify({ code: "LEGACY_BLOCKED", message: "Legacy terminal run." })
          : null,
        run.createdAt,
        run.updatedAt,
      );
  }
  database.close();
}

test("schema v1 migration preserves terminal state and its durable high-water", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-migrate-v1-"));
  const databasePath = join(root, "runs.sqlite");
  const runId = `rr_${"e".repeat(32)}`;
  createV1Database(databasePath, {
    id: runId,
    clientRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    sessionSha256: SESSION_A,
    status: "BLOCKED",
    createdAt: "2026-07-19T00:02:00.000Z",
    updatedAt: "2026-07-19T00:02:00.010Z",
  });
  const repository = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(repository.getRunForSession(runId, SESSION_A)?.status, "BLOCKED");
  assert.throws(
    () => repository.reconcileExpiredExecutorLease("2026-07-19T00:02:00.009Z"),
    hasCode("CLOCK_ROLLBACK"),
  );
  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM repair_executor_authority").get().count,
    1,
  );
  database.close();
});

test("schema v1 migration refuses active work and rolls back without partial authority", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-migrate-active-"));
  const databasePath = join(root, "runs.sqlite");
  createV1Database(databasePath, {
    id: `rr_${"f".repeat(32)}`,
    clientRequestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    sessionSha256: SESSION_A,
    status: "RUNNING",
    createdAt: "2026-07-19T00:03:00.000Z",
    updatedAt: "2026-07-19T00:03:00.001Z",
  });
  assert.throws(
    () => new SQLiteRepairRunRepository(databasePath),
    hasCode("MIGRATION_REQUIRES_DRAIN"),
  );
  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'repair_executor_authority'",
      )
      .get().count,
    0,
  );
  database.close();
  await rm(root, { recursive: true, force: true });
});

test("v2 trigger fences an already-open idle v1 connection before execution starts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-stale-v1-"));
  const databasePath = join(root, "runs.sqlite");
  createV1Database(databasePath);
  const legacy = new DatabaseSync(databasePath);
  const legacyInsert = legacy.prepare(
    "INSERT INTO repair_runs(id,client_request_id,session_sha256,policy_id,policy_version,policy_ir_sha256,input_sha256,status,phase,execution_mode,result_json,failure_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const legacyStart = legacy.prepare(
    "UPDATE repair_runs SET status = 'RUNNING', execution_mode = 'LIVE_EXECUTION_UNVERIFIED', updated_at = ? WHERE id = ? AND status = 'QUEUED'",
  );
  const repository = new SQLiteRepairRunRepository(databasePath);
  assert.throws(() =>
    legacyInsert.run(
      `rr_${"9".repeat(32)}`,
      "13131313-1313-4313-8313-131313131313",
      SESSION_A,
      "policy-stale-v1",
      1,
      "c".repeat(64),
      "d".repeat(64),
      "QUEUED",
      "ADMISSION",
      "NOT_STARTED",
      null,
      null,
      "2026-07-19T00:04:00.000Z",
      "2026-07-19T00:04:00.000Z",
    ),
  );
  assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM repair_runs").get().count, 0);
  const admitted = repository.createOrGetRun(
    runInput({
      clientRequestId: "14141414-1414-4414-8414-141414141414",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:04:00.001Z",
    }),
    leaseRequest(OWNER_A),
  );
  assert.ok(admitted.lease);
  assert.throws(() =>
    legacyStart.run("2026-07-19T00:04:00.002Z", admitted.run.id),
  );
  assert.equal(
    repository.getRunForSession(admitted.run.id, SESSION_A)?.status,
    "QUEUED",
  );
  repository.markBlocked(
    admitted.run.id,
    { code: "NOT_READY", message: "The v2 executor is unavailable." },
    "2026-07-19T00:04:00.003Z",
    admitted.lease,
  );
  t.after(async () => {
    legacy.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
});

test("a second repository cannot poison or adopt another replica's live executor lease", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-live-"));
  const databasePath = join(root, "runs.sqlite");
  const first = new SQLiteRepairRunRepository(databasePath);
  const admitted = first.createOrGetRun(
    runInput({
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:00.000Z",
    }),
    leaseRequest(OWNER_A, 1_000),
  );
  assert.equal(admitted.created, true);
  assert.ok(admitted.lease);
  first.markRunning(admitted.run.id, "2026-07-19T00:00:00.001Z", admitted.lease);

  const second = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    second.close();
    first.close();
    await rm(root, { recursive: true, force: true });
  });

  assert.equal(
    second.getRunForSession(admitted.run.id, SESSION_A)?.status,
    "RUNNING",
  );
  assert.throws(
    () =>
      second.createOrGetRun(
        runInput({
          clientRequestId: "22222222-2222-4222-8222-222222222222",
          sessionSha256: SESSION_B,
          createdAt: "2026-07-19T00:00:00.100Z",
        }),
        leaseRequest(OWNER_B, 1_000),
      ),
    hasCode("RUN_BUSY"),
  );
  assert.throws(
    () =>
      second.appendProgress(
        admitted.run.id,
        "PHASE_STARTED",
        "CARTOGRAPHY",
        { message: "A foreign replica must not write progress." },
        "2026-07-19T00:00:00.101Z",
        admitted.lease,
      ),
    hasCode("LEASE_INVALID"),
  );
});

test("observing an unexpired lease stays read-only under another writer lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-read-fast-"));
  const databasePath = join(root, "runs.sqlite");
  const owner = new SQLiteRepairRunRepository(databasePath);
  const admitted = owner.createOrGetRun(
    runInput({
      clientRequestId: "12121212-1212-4212-8212-121212121212",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:05.000Z",
    }),
    leaseRequest(OWNER_A, 1_000),
  );
  assert.ok(admitted.lease);
  owner.markRunning(admitted.run.id, "2026-07-19T00:00:05.001Z", admitted.lease);
  const observer = new SQLiteRepairRunRepository(databasePath);
  const writer = new DatabaseSync(databasePath);
  writer.exec("BEGIN IMMEDIATE");
  try {
    assert.equal(
      observer.reconcileExpiredExecutorLease("2026-07-19T00:00:05.100Z"),
      0,
    );
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
  t.after(async () => {
    observer.close();
    owner.close();
    await rm(root, { recursive: true, force: true });
  });
});

test("heartbeat extends one fence and expiry poisons before any later admission", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-expiry-"));
  const databasePath = join(root, "runs.sqlite");
  const first = new SQLiteRepairRunRepository(databasePath);
  const admitted = first.createOrGetRun(
    runInput({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:10.000Z",
    }),
    leaseRequest(OWNER_A),
  );
  assert.ok(admitted.lease);
  first.markRunning(admitted.run.id, "2026-07-19T00:00:10.001Z", admitted.lease);
  first.heartbeatExecutorLease(
    admitted.lease,
    "2026-07-19T00:00:10.050Z",
    100,
  );

  const second = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    second.close();
    first.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.throws(
    () =>
      second.createOrGetRun(
        runInput({
          clientRequestId: "44444444-4444-4444-8444-444444444444",
          sessionSha256: SESSION_B,
          createdAt: "2026-07-19T00:00:10.120Z",
        }),
        leaseRequest(OWNER_B),
      ),
    hasCode("RUN_BUSY"),
  );
  const replay = second.createOrGetRun(
    runInput({
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:10.151Z",
    }),
    leaseRequest(OWNER_B),
  );
  assert.equal(replay.created, false);
  assert.equal(replay.lease, null);
  assert.equal(replay.run.status, "POISONED");
  const poisoned = second.getRunForSession(admitted.run.id, SESSION_A);
  assert.equal(poisoned?.status, "POISONED");
  assert.equal(poisoned?.failure?.code, "EXECUTOR_LEASE_EXPIRED_WITHOUT_CLEANUP");
  assert.throws(
    () =>
      first.appendProgress(
        admitted.run.id,
        "PHASE_STARTED",
        "CARTOGRAPHY",
        { message: "An expired owner must be fenced." },
        "2026-07-19T00:00:10.152Z",
        admitted.lease,
      ),
    hasCode("LEASE_INVALID"),
  );
  assert.throws(
    () =>
      second.createOrGetRun(
        runInput({
          clientRequestId: "55555555-5555-4555-8555-555555555555",
          sessionSha256: SESSION_B,
          createdAt: "2026-07-19T00:00:10.153Z",
        }),
        leaseRequest(OWNER_B),
      ),
    hasCode("RUN_BUSY"),
  );
});

test("expired queued work fails safely while expired cleanup stays globally poisoned", async (t) => {
  const queuedRoot = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-queued-"));
  const queuedPath = join(queuedRoot, "runs.sqlite");
  const queuedOwner = new SQLiteRepairRunRepository(queuedPath);
  const queued = queuedOwner.createOrGetRun(
    runInput({
      clientRequestId: "99999999-9999-4999-8999-999999999999",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:30.000Z",
    }),
    leaseRequest(OWNER_A),
  );
  assert.ok(queued.lease);
  queuedOwner.close();
  const queuedObserver = new SQLiteRepairRunRepository(queuedPath);
  queuedObserver.reconcileExpiredExecutorLease("2026-07-19T00:00:30.101Z");
  assert.equal(
    queuedObserver.getRunForSession(queued.run.id, SESSION_A)?.failure?.code,
    "EXECUTOR_LEASE_EXPIRED_BEFORE_START",
  );
  const replacement = queuedObserver.createOrGetRun(
    runInput({
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionSha256: SESSION_B,
      createdAt: "2026-07-19T00:00:30.102Z",
    }),
    leaseRequest(OWNER_B),
  );
  assert.equal(replacement.created, true);
  assert.ok(replacement.lease);
  queuedObserver.markBlocked(
    replacement.run.id,
    { code: "NOT_READY", message: "The replacement executor is unavailable." },
    "2026-07-19T00:00:30.103Z",
    replacement.lease,
  );

  const cleanupRoot = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-cleanup-"));
  const cleanupPath = join(cleanupRoot, "runs.sqlite");
  const cleanupOwner = new SQLiteRepairRunRepository(cleanupPath);
  const cleanup = cleanupOwner.createOrGetRun(
    runInput({
      clientRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:40.000Z",
    }),
    leaseRequest(OWNER_A),
  );
  assert.ok(cleanup.lease);
  cleanupOwner.markRunning(cleanup.run.id, "2026-07-19T00:00:40.001Z", cleanup.lease);
  cleanupOwner.markCleanupPending(
    cleanup.run.id,
    { code: "CLEANUP_PENDING", message: "Cleanup proof is still pending." },
    "2026-07-19T00:00:40.002Z",
    cleanup.lease,
  );
  cleanupOwner.close();
  const cleanupObserver = new SQLiteRepairRunRepository(cleanupPath);
  cleanupObserver.reconcileExpiredExecutorLease("2026-07-19T00:00:40.101Z");
  assert.equal(cleanupObserver.getRunForSession(cleanup.run.id, SESSION_A)?.status, "POISONED");
  assert.throws(
    () =>
      cleanupObserver.createOrGetRun(
        runInput({
          clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          sessionSha256: SESSION_B,
          createdAt: "2026-07-19T00:00:40.102Z",
        }),
        leaseRequest(OWNER_B),
      ),
    hasCode("RUN_BUSY"),
  );

  t.after(async () => {
    cleanupObserver.close();
    queuedObserver.close();
    await rm(cleanupRoot, { recursive: true, force: true });
    await rm(queuedRoot, { recursive: true, force: true });
  });
});

test("terminal transition releases the exact lease and clock rollback fails closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-repair-lease-terminal-"));
  const databasePath = join(root, "runs.sqlite");
  const repository = new SQLiteRepairRunRepository(databasePath);
  t.after(async () => {
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
  const admitted = repository.createOrGetRun(
    runInput({
      clientRequestId: "66666666-6666-4666-8666-666666666666",
      sessionSha256: SESSION_A,
      createdAt: "2026-07-19T00:00:20.000Z",
    }),
    leaseRequest(OWNER_A),
  );
  assert.ok(admitted.lease);
  const copiedLease = { ...admitted.lease };
  assert.throws(
    () =>
      repository.markBlocked(
        admitted.run.id,
        { code: "NOT_READY", message: "The executor is unavailable." },
        "2026-07-19T00:00:20.001Z",
        copiedLease,
      ),
    hasCode("LEASE_INVALID"),
  );
  repository.markBlocked(
    admitted.run.id,
    { code: "NOT_READY", message: "The executor is unavailable." },
    "2026-07-19T00:00:20.001Z",
    admitted.lease,
  );
  assert.throws(
    () => repository.heartbeatExecutorLease(admitted.lease, "2026-07-19T00:00:20.002Z", 100),
    hasCode("LEASE_INVALID"),
  );
  assert.throws(
    () =>
      repository.createOrGetRun(
        runInput({
          clientRequestId: "77777777-7777-4777-8777-777777777777",
          sessionSha256: SESSION_B,
          createdAt: "2026-07-19T00:00:19.999Z",
        }),
        leaseRequest(OWNER_B),
      ),
    hasCode("CLOCK_ROLLBACK"),
  );
  const next = repository.createOrGetRun(
    runInput({
      clientRequestId: "88888888-8888-4888-8888-888888888888",
      sessionSha256: SESSION_B,
      createdAt: "2026-07-19T00:00:20.003Z",
    }),
    leaseRequest(OWNER_B),
  );
  assert.equal(next.created, true);
  assert.ok(next.lease);
  assert.throws(
    () => repository.heartbeatExecutorLease(next.lease, "2026-07-19T00:00:20.002Z", 100),
    hasCode("CLOCK_ROLLBACK"),
  );
  assert.throws(
    () =>
      repository.markBlocked(
        next.run.id,
        { code: "NOT_READY", message: "A rolled-back transition is invalid." },
        "2026-07-19T00:00:20.002Z",
        next.lease,
      ),
    hasCode("CLOCK_ROLLBACK"),
  );
  repository.markBlocked(
    next.run.id,
    { code: "NOT_READY", message: "The next executor is unavailable." },
    "2026-07-19T00:00:20.004Z",
    next.lease,
  );
});
