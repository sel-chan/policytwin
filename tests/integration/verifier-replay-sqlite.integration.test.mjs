import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  verifierCapabilitySha256,
  verifierChallengeSha256,
} from "../../dist/codex/verifier-exchange-contract.js";
import {
  assertDurableVerifierReplayStore,
  createSqliteVerifierReplayStore,
} from "../../dist/codex/verifier-replay-sqlite.js";

function challenge({
  challengeByte,
  capabilityByte,
  requestByte,
  issuedAt,
  expiresAt,
  requestExpiresAt = expiresAt,
  repairRunId,
}) {
  const capability = Buffer.alloc(32, capabilityByte).toString("base64url");
  const unsigned = {
    schemaVersion: "1",
    kind: "VERIFIER_EXCHANGE_CHALLENGE",
    profile: "policytwin.verifier.exchange.v1",
    challengeId: challengeByte.repeat(32),
    capabilitySha256: verifierCapabilitySha256(capability),
    requestId: requestByte.repeat(32),
    requestSha256: requestByte.repeat(64),
    inputSha256: "a".repeat(64),
    policySha256: "b".repeat(64),
    executionBindingSha256: "c".repeat(64),
    snapshotSha256: "d".repeat(64),
    verifierImageDigest: `sha256:${"e".repeat(64)}`,
    attempt: 1,
    repairRunId,
    acceptedCorpusSha256: "f".repeat(64),
    policyIrSha256: "1".repeat(64),
    issuedAt,
    expiresAt,
    requestExpiresAt,
  };
  return {
    capability,
    value: {
      ...unsigned,
      challengeSha256: verifierChallengeSha256(unsigned),
    },
  };
}

function consumption(challengeValue, overrides = {}) {
  return {
    challengeId: challengeValue.challengeId,
    capabilitySha256: challengeValue.capabilitySha256,
    challengeSha256: challengeValue.challengeSha256,
    requestSha256: challengeValue.requestSha256,
    snapshotSha256: challengeValue.snapshotSha256,
    verifierImageDigest: challengeValue.verifierImageDigest,
    attempt: challengeValue.attempt,
    repairRunId: challengeValue.repairRunId,
    receiptSha256: overrides.receiptSha256 ?? "2".repeat(64),
    verifierRunId: overrides.verifierRunId ?? "verifier-run-one",
  };
}

test("verifier replay state survives restart and rejects exact replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-restart-"));
  const databasePath = join(root, "replay.sqlite");
  const now = new Date("2026-07-18T10:00:00.000Z");
  const issued = challenge({
    challengeByte: "1",
    capabilityByte: 2,
    requestByte: "3",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-restart",
  });
  try {
    const first = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
    assert.equal(Object.isFrozen(first), true);
    assert.equal(first.issue(issued.value, now), true);
    first.close();

    const reopened = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
    assert.equal(reopened.consume(consumption(issued.value), now), true);
    reopened.close();

    const final = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
    assert.equal(final.inspect(issued.value.challengeId)?.state, "CONSUMED");
    assert.equal(final.consume(consumption(issued.value), now), false);
    final.close();

    const databaseFiles = (await readdir(root)).filter((name) => name.startsWith("replay.sqlite"));
    for (const name of databaseFiles) {
      const bytes = await readFile(join(root, name));
      assert.equal(bytes.indexOf(Buffer.from(issued.capability, "utf8")), -1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two store instances share issuance, poison, receipt, and verifier-run uniqueness", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-shared-"));
  const databasePath = join(root, "replay.sqlite");
  const now = new Date("2026-07-18T10:00:00.000Z");
  const firstChallenge = challenge({
    challengeByte: "4",
    capabilityByte: 5,
    requestByte: "6",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-shared-one",
  });
  const secondChallenge = challenge({
    challengeByte: "7",
    capabilityByte: 8,
    requestByte: "9",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-shared-two",
  });
  const duplicateRequestAttempt = challenge({
    challengeByte: "e",
    capabilityByte: 15,
    requestByte: "9",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-shared-duplicate",
  });
  const first = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
  const second = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
  try {
    assert.equal(first.issue(firstChallenge.value, now), true);
    assert.equal(second.issue(firstChallenge.value, now), false);
    assert.equal(first.consume(consumption(firstChallenge.value), now), true);
    assert.equal(second.issue(secondChallenge.value, now), true);
    assert.equal(first.issue(duplicateRequestAttempt.value, now), false);
    assert.equal(second.consume(consumption(secondChallenge.value, {
      verifierRunId: "verifier-run-two",
    }), now), false);
    assert.equal(second.consume(consumption(secondChallenge.value, {
      receiptSha256: "3".repeat(64),
    }), now), false);
    second.poison(secondChallenge.value.challengeId);
    assert.equal(first.inspect(secondChallenge.value.challengeId)?.state, "POISONED");
  } finally {
    first.close();
    second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted high-water time rejects clock rollback after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-clock-"));
  const databasePath = join(root, "replay.sqlite");
  const now = new Date("2026-07-18T10:00:00.000Z");
  const later = new Date(now.getTime() + 10_000);
  const rollback = new Date(now.getTime() + 1_000);
  const firstChallenge = challenge({
    challengeByte: "2",
    capabilityByte: 12,
    requestByte: "4",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-clock-one",
  });
  const secondChallenge = challenge({
    challengeByte: "5",
    capabilityByte: 13,
    requestByte: "6",
    issuedAt: later.toISOString(),
    expiresAt: new Date(later.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-clock-two",
  });
  const rollbackChallenge = challenge({
    challengeByte: "7",
    capabilityByte: 14,
    requestByte: "8",
    issuedAt: rollback.toISOString(),
    expiresAt: new Date(rollback.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-clock-rollback",
  });
  try {
    const first = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
    assert.equal(first.issue(firstChallenge.value, now), true);
    assert.equal(first.issue(secondChallenge.value, later), true);
    first.close();

    const reopened = createSqliteVerifierReplayStore({ databasePath, capacity: 8 });
    assert.equal(reopened.consume(consumption(firstChallenge.value), rollback), false);
    assert.equal(reopened.issue(rollbackChallenge.value, rollback), false);
    assert.equal(reopened.inspect(firstChallenge.value.challengeId)?.state, "ISSUED");
    reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired unconsumed challenges release bounded active capacity", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-capacity-"));
  const databasePath = join(root, "replay.sqlite");
  const now = new Date("2026-07-18T10:00:00.000Z");
  const firstChallenge = challenge({
    challengeByte: "a",
    capabilityByte: 10,
    requestByte: "b",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 1_000).toISOString(),
    repairRunId: "repair-run-expired",
  });
  const later = new Date(now.getTime() + 2_000);
  const secondChallenge = challenge({
    challengeByte: "c",
    capabilityByte: 11,
    requestByte: "d",
    issuedAt: later.toISOString(),
    expiresAt: new Date(later.getTime() + 60_000).toISOString(),
    repairRunId: "repair-run-current",
  });
  const store = createSqliteVerifierReplayStore({ databasePath, capacity: 1 });
  try {
    assert.equal(store.issue(firstChallenge.value, now), true);
    assert.equal(store.issue(secondChallenge.value, later), true);
    assert.equal(store.inspect(firstChallenge.value.challengeId), null);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("challenge expiry keeps a request-attempt tombstone until request expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-tombstone-"));
  const databasePath = join(root, "replay.sqlite");
  const now = new Date("2026-07-18T10:00:00.000Z");
  const later = new Date(now.getTime() + 2_000);
  const requestExpiresAt = new Date(now.getTime() + 60_000).toISOString();
  const firstChallenge = challenge({
    challengeByte: "1",
    capabilityByte: 16,
    requestByte: "2",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 1_000).toISOString(),
    requestExpiresAt,
    repairRunId: "repair-run-tombstone-one",
  });
  const repeatedAttempt = challenge({
    challengeByte: "3",
    capabilityByte: 17,
    requestByte: "2",
    issuedAt: later.toISOString(),
    expiresAt: new Date(later.getTime() + 1_000).toISOString(),
    requestExpiresAt,
    repairRunId: "repair-run-tombstone-two",
  });
  const store = createSqliteVerifierReplayStore({ databasePath, capacity: 4 });
  try {
    assert.equal(store.issue(firstChallenge.value, now), true);
    assert.equal(store.issue(repeatedAttempt.value, later), false);
    assert.equal(store.inspect(firstChallenge.value.challengeId)?.state, "ISSUED");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("replay storage rejects copied authority and non-durable paths", () => {
  assert.throws(
    () => createSqliteVerifierReplayStore({ databasePath: "relative.sqlite" }),
    /non-memory SQLite path/u,
  );
  assert.throws(
    () => createSqliteVerifierReplayStore({ databasePath: ":memory:" }),
    /non-memory SQLite path/u,
  );
  assert.throws(() => assertDurableVerifierReplayStore({ durability: "DURABLE_SQLITE" }));
});

test("pre-existing weakened SQLite schema is rejected instead of adopted", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-schema-"));
  const databasePath = join(root, "replay.sqlite");
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE verifier_exchange_replay (
        challenge_id TEXT PRIMARY KEY NOT NULL,
        capability_sha256 TEXT NOT NULL,
        challenge_sha256 TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL,
        verifier_image_digest TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        repair_run_id TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        state TEXT NOT NULL,
        receipt_sha256 TEXT,
        verifier_run_id TEXT
      )
    `);
    database.close();
    assert.throws(
      () => createSqliteVerifierReplayStore({ databasePath }),
      /initialization failed/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial uniqueness indexes cannot impersonate the sealed replay schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-verifier-replay-partial-index-"));
  const databasePath = join(root, "replay.sqlite");
  try {
    const store = createSqliteVerifierReplayStore({ databasePath });
    store.close();
    const database = new DatabaseSync(databasePath);
    database.exec("DROP INDEX verifier_exchange_request_attempt_idx");
    database.exec(`
      CREATE UNIQUE INDEX verifier_exchange_request_attempt_idx
      ON verifier_exchange_replay (request_sha256, attempt) WHERE 0
    `);
    database.close();
    assert.throws(
      () => createSqliteVerifierReplayStore({ databasePath }),
      /initialization failed/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
