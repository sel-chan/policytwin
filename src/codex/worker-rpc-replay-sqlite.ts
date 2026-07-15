import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import type {
  WorkerRpcReplayCapability,
  WorkerRpcReplayStore,
} from "./worker-rpc-mtls.js";

export interface SqliteWorkerRpcReplayStoreOptions {
  databasePath: string;
  capacity?: number;
  busyTimeoutMs?: number;
}

export interface SqliteWorkerRpcReplayStore extends WorkerRpcReplayStore {
  close(): void;
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateCapability(capability: WorkerRpcReplayCapability): number {
  if (!/^[0-9a-f]{32}$/u.test(capability.requestId)) {
    throw new Error("Worker replay request ID is invalid.");
  }
  if (
    !/^[A-Za-z0-9_-]{43}$/u.test(capability.runNonce) ||
    Buffer.from(capability.runNonce, "base64url").byteLength !== 32 ||
    Buffer.from(capability.runNonce, "base64url").toString("base64url") !==
      capability.runNonce
  ) {
    throw new Error("Worker replay nonce is invalid.");
  }
  const expiry = Date.parse(capability.expiresAt);
  if (
    !Number.isFinite(expiry) ||
    new Date(expiry).toISOString() !== capability.expiresAt
  ) {
    throw new Error("Worker replay expiry is invalid.");
  }
  return expiry;
}

export function createSqliteWorkerRpcReplayStore(
  options: SqliteWorkerRpcReplayStoreOptions,
): SqliteWorkerRpcReplayStore {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.trim().length === 0 ||
    options.databasePath.includes("\0") ||
    !isAbsolute(options.databasePath) ||
    options.databasePath === ":memory:" ||
    /[?&]mode=memory(?:&|$)/iu.test(options.databasePath)
  ) {
    throw new Error("Durable worker replay storage requires a non-memory SQLite path.");
  }
  const capacity = integer(
    options.capacity ?? 100_000,
    "Worker replay-store capacity",
    1,
    1_000_000,
  );
  const busyTimeoutMs = integer(
    options.busyTimeoutMs ?? 5_000,
    "Worker replay-store busy timeout",
    250,
    60_000,
  );
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(options.databasePath);
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS worker_rpc_replay_capabilities (
        request_id TEXT PRIMARY KEY NOT NULL,
        run_nonce TEXT NOT NULL UNIQUE,
        expires_at_ms INTEGER NOT NULL
      ) STRICT
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS worker_rpc_replay_expiry_idx
      ON worker_rpc_replay_capabilities (expires_at_ms)
    `);
  } catch {
    try {
      database!.close();
    } catch {
      // Initialization remains fail-closed without exposing the configured path.
    }
    throw new Error("Worker replay-store initialization failed.");
  }
  const prune = database.prepare(
    "DELETE FROM worker_rpc_replay_capabilities WHERE expires_at_ms <= ?",
  );
  const existing = database.prepare(`
    SELECT 1 AS found
    FROM worker_rpc_replay_capabilities
    WHERE request_id = ? OR run_nonce = ?
    LIMIT 1
  `);
  const count = database.prepare(
    "SELECT COUNT(*) AS total FROM worker_rpc_replay_capabilities",
  );
  const insert = database.prepare(`
    INSERT INTO worker_rpc_replay_capabilities (request_id, run_nonce, expires_at_ms)
    VALUES (?, ?, ?)
  `);
  let closed = false;

  return {
    async consume(capability, now): Promise<boolean> {
      if (closed) throw new Error("Worker replay store is closed.");
      const current = now.getTime();
      const expiry = validateCapability(capability);
      if (!Number.isFinite(current)) {
        throw new Error("Worker replay-store clock is invalid.");
      }
      if (expiry <= current) return false;
      database.exec("BEGIN IMMEDIATE");
      try {
        prune.run(current);
        if (existing.get(capability.requestId, capability.runNonce) !== undefined) {
          database.exec("COMMIT");
          return false;
        }
        const row = count.get();
        const total = Number(row?.total ?? Number.NaN);
        if (!Number.isSafeInteger(total) || total < 0) {
          throw new Error("Worker replay-store count is invalid.");
        }
        if (total >= capacity) {
          database.exec("COMMIT");
          return false;
        }
        insert.run(capability.requestId, capability.runNonce, expiry);
        database.exec("COMMIT");
        return true;
      } catch {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Preserve the original fail-closed storage error.
        }
        throw new Error("Worker replay-store transaction failed.");
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      database.close();
    },
  };
}
