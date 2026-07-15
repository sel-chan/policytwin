import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteWorkerRpcReplayStore } from "../../dist/index.js";

function capability(requestByte, nonceByte, expiresAt) {
  return {
    requestId: requestByte.repeat(32),
    runNonce: Buffer.alloc(32, Number.parseInt(nonceByte, 16)).toString("base64url"),
    expiresAt,
  };
}

test("durable replay storage rejects request-ID or nonce reuse across supervisor restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-replay-store-"));
  const path = join(root, "replay.sqlite");
  const now = new Date("2026-07-15T02:00:00.000Z");
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const original = capability("1", "2", expiresAt);
  try {
    const first = createSqliteWorkerRpcReplayStore({ databasePath: path, capacity: 4 });
    assert.equal(await first.consume(original, now), true);
    first.close();

    const reopened = createSqliteWorkerRpcReplayStore({ databasePath: path, capacity: 4 });
    assert.equal(await reopened.consume(original, now), false);
    assert.equal(
      await reopened.consume(capability("1", "3", expiresAt), now),
      false,
    );
    assert.equal(
      await reopened.consume(capability("4", "2", expiresAt), now),
      false,
    );
    reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("durable replay storage rejects relative and in-memory database paths", () => {
  assert.throws(
    () => createSqliteWorkerRpcReplayStore({ databasePath: "relative.sqlite" }),
    /non-memory SQLite path/u,
  );
  assert.throws(
    () => createSqliteWorkerRpcReplayStore({ databasePath: ":memory:" }),
    /non-memory SQLite path/u,
  );
});

test("durable replay storage enforces capacity and prunes expired capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-replay-capacity-"));
  const path = join(root, "replay.sqlite");
  const now = new Date("2026-07-15T02:00:00.000Z");
  const store = createSqliteWorkerRpcReplayStore({ databasePath: path, capacity: 1 });
  try {
    assert.equal(
      await store.consume(
        capability("5", "6", new Date(now.getTime() + 1_000).toISOString()),
        now,
      ),
      true,
    );
    assert.equal(
      await store.consume(
        capability("7", "8", new Date(now.getTime() + 60_000).toISOString()),
        now,
      ),
      false,
    );
    const later = new Date(now.getTime() + 2_000);
    assert.equal(
      await store.consume(
        capability("9", "a", new Date(later.getTime() + 60_000).toISOString()),
        later,
      ),
      true,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
