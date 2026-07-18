import { DatabaseSync } from "node:sqlite";
import { chmodSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { VerifierExchangeChallenge } from "./verifier-exchange-contract.js";
import { parseVerifierExchangeChallenge } from "./verifier-exchange-contract.js";

export type VerifierReplayState = "ISSUED" | "CONSUMED" | "POISONED";

export interface VerifierReplayConsumeInput {
  challengeId: string;
  capabilitySha256: string;
  challengeSha256: string;
  requestSha256: string;
  snapshotSha256: string;
  verifierImageDigest: string;
  attempt: 1 | 2;
  repairRunId: string;
  receiptSha256: string;
  verifierRunId: string;
}

export interface VerifierReplayObservation {
  challengeId: string;
  capabilitySha256: string;
  state: VerifierReplayState;
  receiptSha256: string | null;
  verifierRunId: string | null;
  expiresAt: string;
  requestExpiresAt: string;
}

export interface DurableVerifierReplayStore {
  readonly durability: "DURABLE_SQLITE";
  issue(challenge: VerifierExchangeChallenge, now: Date): boolean;
  consume(input: VerifierReplayConsumeInput, now: Date): boolean;
  poison(challengeId: string): void;
  inspect(challengeId: string): VerifierReplayObservation | null;
  close(): void;
}

export interface SqliteVerifierReplayStoreOptions {
  databasePath: string;
  capacity?: number;
  busyTimeoutMs?: number;
}

const DURABLE_VERIFIER_REPLAY_STORES = new WeakSet<object>();
const SHA256 = /^[0-9a-f]{64}$/u;
const CHALLENGE_ID = /^[0-9a-f]{32}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validNow(now: Date): number {
  const value = now.getTime();
  if (!(now instanceof Date) || !Number.isFinite(value)) {
    throw new Error("Verifier replay-store clock is invalid.");
  }
  return value;
}

function validateConsume(input: VerifierReplayConsumeInput): void {
  if (
    !CHALLENGE_ID.test(input.challengeId) ||
    !SHA256.test(input.capabilitySha256) ||
    !SHA256.test(input.challengeSha256) ||
    !SHA256.test(input.requestSha256) ||
    !SHA256.test(input.snapshotSha256) ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.verifierImageDigest) ||
    (input.attempt !== 1 && input.attempt !== 2) ||
    !SAFE_ID.test(input.repairRunId) ||
    !SHA256.test(input.receiptSha256) ||
    !SAFE_ID.test(input.verifierRunId)
  ) {
    throw new Error("Verifier replay consumption input is invalid.");
  }
}

export function assertDurableVerifierReplayStore(
  value: unknown,
): asserts value is DurableVerifierReplayStore {
  if (
    typeof value !== "object" ||
    value === null ||
    !DURABLE_VERIFIER_REPLAY_STORES.has(value)
  ) {
    throw new Error("Verifier exchange requires the exact durable SQLite replay store.");
  }
}

export function createSqliteVerifierReplayStore(
  options: SqliteVerifierReplayStoreOptions,
): DurableVerifierReplayStore {
  const databasePath = typeof options.databasePath === "string"
    ? options.databasePath
    : "";
  const resolvedDatabasePath = resolve(databasePath || ".");
  const normalizedPathMatches = process.platform === "win32"
    ? resolvedDatabasePath.toLowerCase() === databasePath.toLowerCase()
    : resolvedDatabasePath === databasePath;
  if (
    databasePath.trim().length === 0 ||
    databasePath.includes("\0") ||
    !isAbsolute(databasePath) ||
    databasePath === ":memory:" ||
    /[?&]mode=memory(?:&|$)/iu.test(databasePath) ||
    !normalizedPathMatches ||
    (process.platform === "win32" && !/^[A-Za-z]:[\\/][^:]*$/u.test(databasePath))
  ) {
    throw new Error("Durable verifier replay storage requires a non-memory SQLite path.");
  }
  const capacity = integer(
    options.capacity ?? 100_000,
    "Verifier replay-store capacity",
    1,
    1_000_000,
  );
  const busyTimeoutMs = integer(
    options.busyTimeoutMs ?? 5_000,
    "Verifier replay-store busy timeout",
    250,
    60_000,
  );
  let database: DatabaseSync;
  try {
    const parent = dirname(resolvedDatabasePath);
    const parentStat = lstatSync(parent);
    const actualParent = realpathSync.native(parent);
    const sameParent = process.platform === "win32"
      ? actualParent.toLowerCase() === parent.toLowerCase()
      : actualParent === parent;
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !sameParent) {
      throw new Error("Verifier replay-store parent is not a stable local directory.");
    }
    database = new DatabaseSync(resolvedDatabasePath);
    const databaseStat = lstatSync(resolvedDatabasePath);
    const actualDatabasePath = realpathSync.native(resolvedDatabasePath);
    const sameDatabasePath = process.platform === "win32"
      ? actualDatabasePath.toLowerCase() === resolvedDatabasePath.toLowerCase()
      : actualDatabasePath === resolvedDatabasePath;
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || !sameDatabasePath) {
      throw new Error("Verifier replay-store file is not stable.");
    }
    if (process.platform !== "win32") chmodSync(resolvedDatabasePath, 0o600);
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS verifier_exchange_replay (
        challenge_id TEXT PRIMARY KEY NOT NULL,
        capability_sha256 TEXT NOT NULL UNIQUE,
        challenge_sha256 TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL,
        verifier_image_digest TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        repair_run_id TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        request_expires_at_ms INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('ISSUED', 'CONSUMED', 'POISONED')),
        receipt_sha256 TEXT UNIQUE,
        verifier_run_id TEXT UNIQUE
      ) STRICT
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS verifier_exchange_expiry_idx
      ON verifier_exchange_replay (expires_at_ms)
    `);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS verifier_exchange_capability_idx
      ON verifier_exchange_replay (capability_sha256)
    `);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS verifier_exchange_receipt_idx
      ON verifier_exchange_replay (receipt_sha256)
    `);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS verifier_exchange_run_idx
      ON verifier_exchange_replay (verifier_run_id)
    `);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS verifier_exchange_request_attempt_idx
      ON verifier_exchange_replay (request_sha256, attempt)
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS verifier_exchange_metadata (
        singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
        last_observed_now_ms INTEGER NOT NULL
      ) STRICT
    `);
    database.exec(`
      INSERT OR IGNORE INTO verifier_exchange_metadata (singleton, last_observed_now_ms)
      VALUES (1, 0)
    `);
    database.exec("PRAGMA application_id = 1347700306");
    database.exec("PRAGMA user_version = 1");
    const replayColumns = database.prepare(
      "PRAGMA table_xinfo('verifier_exchange_replay')",
    ).all() as Array<Record<string, unknown>>;
    const expectedReplayColumns = [
      ["challenge_id", "TEXT", 1, 1],
      ["capability_sha256", "TEXT", 1, 0],
      ["challenge_sha256", "TEXT", 1, 0],
      ["request_sha256", "TEXT", 1, 0],
      ["snapshot_sha256", "TEXT", 1, 0],
      ["verifier_image_digest", "TEXT", 1, 0],
      ["attempt", "INTEGER", 1, 0],
      ["repair_run_id", "TEXT", 1, 0],
      ["expires_at_ms", "INTEGER", 1, 0],
      ["request_expires_at_ms", "INTEGER", 1, 0],
      ["state", "TEXT", 1, 0],
      ["receipt_sha256", "TEXT", 0, 0],
      ["verifier_run_id", "TEXT", 0, 0],
    ] as const;
    if (
      replayColumns.length !== expectedReplayColumns.length ||
      replayColumns.some((column, index) => {
        const expected = expectedReplayColumns[index];
        return expected === undefined ||
          column.name !== expected[0] ||
          String(column.type).toUpperCase() !== expected[1] ||
          Number(column.notnull) !== expected[2] ||
          Number(column.pk) !== expected[3] ||
          Number(column.hidden) !== 0;
      })
    ) {
      throw new Error("Verifier replay-store schema is incompatible.");
    }
    const metadataColumns = database.prepare(
      "PRAGMA table_xinfo('verifier_exchange_metadata')",
    ).all() as Array<Record<string, unknown>>;
    if (
      metadataColumns.length !== 2 ||
      metadataColumns[0]?.name !== "singleton" ||
      String(metadataColumns[0]?.type).toUpperCase() !== "INTEGER" ||
      Number(metadataColumns[0]?.notnull) !== 1 ||
      Number(metadataColumns[0]?.pk) !== 1 ||
      metadataColumns[1]?.name !== "last_observed_now_ms" ||
      String(metadataColumns[1]?.type).toUpperCase() !== "INTEGER" ||
      Number(metadataColumns[1]?.notnull) !== 1 ||
      Number(metadataColumns[1]?.pk) !== 0
    ) {
      throw new Error("Verifier replay-store metadata schema is incompatible.");
    }
    const replaySchema = database.prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'verifier_exchange_replay'",
    ).get() as { sql?: unknown } | undefined;
    const normalizedReplaySchema = String(replaySchema?.sql ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    if (
      !normalizedReplaySchema.includes("CHECK (state IN ('ISSUED', 'CONSUMED', 'POISONED'))") ||
      !normalizedReplaySchema.endsWith(" STRICT")
    ) {
      throw new Error("Verifier replay-store state constraint is incompatible.");
    }
    const tableList = database.prepare("PRAGMA table_list").all() as Array<Record<string, unknown>>;
    for (const tableName of ["verifier_exchange_replay", "verifier_exchange_metadata"]) {
      const table = tableList.find((row) => row.name === tableName);
      if (table === undefined || Number(table.strict) !== 1) {
        throw new Error("Verifier replay-store tables must remain STRICT.");
      }
      const trigger = database.prepare(
        "SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?",
      ).get(tableName) as { total?: unknown } | undefined;
      if (Number(trigger?.total ?? Number.NaN) !== 0) {
        throw new Error("Verifier replay-store triggers are prohibited.");
      }
    }
    const indexList = database.prepare(
      "PRAGMA index_list('verifier_exchange_replay')",
    ).all() as Array<Record<string, unknown>>;
    const requiredIndexes = new Map<string, readonly string[]>([
      ["verifier_exchange_capability_idx", ["capability_sha256"]],
      ["verifier_exchange_receipt_idx", ["receipt_sha256"]],
      ["verifier_exchange_run_idx", ["verifier_run_id"]],
      ["verifier_exchange_request_attempt_idx", ["request_sha256", "attempt"]],
    ]);
    for (const [indexName, expectedColumns] of requiredIndexes) {
      const index = indexList.find((row) => row.name === indexName);
      const columns = database.prepare(`PRAGMA index_info('${indexName}')`).all() as
        Array<Record<string, unknown>>;
      const indexSchema = database.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
      ).get(indexName) as { sql?: unknown } | undefined;
      const normalizedIndexSchema = String(indexSchema?.sql ?? "")
        .replace(/\s+/gu, " ")
        .trim();
      const expectedIndexSchema =
        `CREATE UNIQUE INDEX ${indexName} ON verifier_exchange_replay (${expectedColumns.join(", ")})`;
      if (
        index === undefined ||
        Number(index.unique) !== 1 ||
        Number(index.partial) !== 0 ||
        index.origin !== "c" ||
        columns.length !== expectedColumns.length ||
        columns.some((column, position) => column.name !== expectedColumns[position]) ||
        normalizedIndexSchema !== expectedIndexSchema
      ) {
        throw new Error("Verifier replay-store unique indexes are incompatible.");
      }
    }
    const applicationId = database.prepare("PRAGMA application_id").get() as
      | Record<string, unknown>
      | undefined;
    const userVersion = database.prepare("PRAGMA user_version").get() as
      | Record<string, unknown>
      | undefined;
    const journal = database.prepare("PRAGMA journal_mode").get() as
      | Record<string, unknown>
      | undefined;
    const synchronous = database.prepare("PRAGMA synchronous").get() as
      | Record<string, unknown>
      | undefined;
    const quickCheck = database.prepare("PRAGMA quick_check").get() as
      | Record<string, unknown>
      | undefined;
    if (
      String(journal?.journal_mode ?? "").toLowerCase() !== "wal" ||
      Number(synchronous?.synchronous) !== 2 ||
      String(quickCheck?.quick_check ?? "") !== "ok" ||
      Number(applicationId?.application_id) !== 1_347_700_306 ||
      Number(userVersion?.user_version) !== 1
    ) {
      throw new Error("Verifier replay-store durability checks failed.");
    }
  } catch {
    try {
      database!.close();
    } catch {
      // Initialization stays fail-closed without exposing the configured path.
    }
    throw new Error("Verifier replay-store initialization failed.");
  }
  const prune = database.prepare(
    "DELETE FROM verifier_exchange_replay WHERE request_expires_at_ms <= ?",
  );
  const count = database.prepare("SELECT COUNT(*) AS total FROM verifier_exchange_replay");
  const existing = database.prepare(`
    SELECT 1 AS found FROM verifier_exchange_replay
    WHERE challenge_id = ? OR capability_sha256 = ?
      OR (request_sha256 = ? AND attempt = ?)
    LIMIT 1
  `);
  const insert = database.prepare(`
    INSERT INTO verifier_exchange_replay (
      challenge_id, capability_sha256, challenge_sha256, request_sha256,
      snapshot_sha256, verifier_image_digest, attempt, repair_run_id,
      expires_at_ms, request_expires_at_ms, state, receipt_sha256, verifier_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', NULL, NULL)
  `);
  const select = database.prepare(`
    SELECT challenge_id, capability_sha256, challenge_sha256, request_sha256,
      snapshot_sha256, verifier_image_digest, attempt, repair_run_id,
      expires_at_ms, request_expires_at_ms, state, receipt_sha256, verifier_run_id
    FROM verifier_exchange_replay WHERE challenge_id = ?
  `);
  const consume = database.prepare(`
    UPDATE verifier_exchange_replay
    SET state = 'CONSUMED', receipt_sha256 = ?, verifier_run_id = ?
    WHERE challenge_id = ? AND state = 'ISSUED'
      AND capability_sha256 = ? AND challenge_sha256 = ?
      AND request_sha256 = ? AND snapshot_sha256 = ?
      AND verifier_image_digest = ? AND attempt = ? AND repair_run_id = ?
      AND expires_at_ms > ?
  `);
  const poison = database.prepare(`
    UPDATE verifier_exchange_replay SET state = 'POISONED'
    WHERE challenge_id = ? AND state = 'ISSUED'
  `);
  const selectHighWater = database.prepare(`
    SELECT last_observed_now_ms FROM verifier_exchange_metadata WHERE singleton = 1
  `);
  const updateHighWater = database.prepare(`
    UPDATE verifier_exchange_metadata SET last_observed_now_ms = ? WHERE singleton = 1
  `);
  let closed = false;

  function observeMonotonicTime(current: number): boolean {
    const row = selectHighWater.get() as { last_observed_now_ms?: unknown } | undefined;
    const highWater = Number(row?.last_observed_now_ms ?? Number.NaN);
    if (!Number.isSafeInteger(highWater) || highWater < 0) {
      throw new Error("Verifier replay-store time state is invalid.");
    }
    if (current < highWater) return false;
    if (current > highWater) {
      const result = updateHighWater.run(current);
      if (Number(result.changes) !== 1) {
        throw new Error("Verifier replay-store time state could not advance.");
      }
    }
    return true;
  }

  function transaction<T>(operation: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      database.exec("COMMIT");
      return value;
    } catch {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the fail-closed transaction error.
      }
      throw new Error("Verifier replay-store transaction failed.");
    }
  }

  const store: DurableVerifierReplayStore = {
    durability: "DURABLE_SQLITE",
    issue(challengeValue, now): boolean {
      if (closed) throw new Error("Verifier replay store is closed.");
      const challenge = parseVerifierExchangeChallenge(challengeValue);
      const current = validNow(now);
      const issued = Date.parse(challenge.issuedAt);
      const expiry = Date.parse(challenge.expiresAt);
      const requestExpiry = Date.parse(challenge.requestExpiresAt);
      if (current < issued || current >= expiry) return false;
      return transaction(() => {
        if (!observeMonotonicTime(current)) return false;
        prune.run(current);
        if (
          existing.get(
            challenge.challengeId,
            challenge.capabilitySha256,
            challenge.requestSha256,
            challenge.attempt,
          ) !== undefined
        ) {
          return false;
        }
        const row = count.get() as { total?: unknown } | undefined;
        const total = Number(row?.total ?? Number.NaN);
        if (!Number.isSafeInteger(total) || total < 0) {
          throw new Error("Verifier replay-store count is invalid.");
        }
        if (total >= capacity) return false;
        insert.run(
          challenge.challengeId,
          challenge.capabilitySha256,
          challenge.challengeSha256,
          challenge.requestSha256,
          challenge.snapshotSha256,
          challenge.verifierImageDigest,
          challenge.attempt,
          challenge.repairRunId,
          expiry,
          requestExpiry,
        );
        return true;
      });
    },
    consume(input, now): boolean {
      if (closed) throw new Error("Verifier replay store is closed.");
      validateConsume(input);
      const current = validNow(now);
      return transaction(() => {
        if (!observeMonotonicTime(current)) return false;
        try {
          const result = consume.run(
            input.receiptSha256,
            input.verifierRunId,
            input.challengeId,
            input.capabilitySha256,
            input.challengeSha256,
            input.requestSha256,
            input.snapshotSha256,
            input.verifierImageDigest,
            input.attempt,
            input.repairRunId,
            current,
          );
          return Number(result.changes) === 1;
        } catch {
          return false;
        }
      });
    },
    poison(challengeId): void {
      if (closed) throw new Error("Verifier replay store is closed.");
      if (!CHALLENGE_ID.test(challengeId)) {
        throw new Error("Verifier replay challenge ID is invalid.");
      }
      transaction(() => {
        poison.run(challengeId);
      });
    },
    inspect(challengeId): VerifierReplayObservation | null {
      if (closed) throw new Error("Verifier replay store is closed.");
      if (!CHALLENGE_ID.test(challengeId)) {
        throw new Error("Verifier replay challenge ID is invalid.");
      }
      const row = select.get(challengeId) as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      const state = row.state;
      const expiry = Number(row.expires_at_ms);
      const requestExpiry = Number(row.request_expires_at_ms);
      if (
        (state !== "ISSUED" && state !== "CONSUMED" && state !== "POISONED") ||
        !Number.isSafeInteger(expiry) ||
        !Number.isSafeInteger(requestExpiry) ||
        requestExpiry < expiry
      ) {
        throw new Error("Verifier replay-store row is invalid.");
      }
      return {
        challengeId: String(row.challenge_id),
        capabilitySha256: String(row.capability_sha256),
        state,
        receiptSha256: row.receipt_sha256 === null ? null : String(row.receipt_sha256),
        verifierRunId: row.verifier_run_id === null ? null : String(row.verifier_run_id),
        expiresAt: new Date(expiry).toISOString(),
        requestExpiresAt: new Date(requestExpiry).toISOString(),
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      database.close();
    },
  };
  DURABLE_VERIFIER_REPLAY_STORES.add(store);
  return Object.freeze(store);
}
