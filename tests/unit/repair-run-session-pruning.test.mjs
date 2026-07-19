import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SingleRunGate } from "../../dist/openai/request-guard.js";
import { SQLitePolicyRepository } from "../../dist/persistence/sqlite.js";
import { PolicyWorkspaceService } from "../../dist/workspace/service.js";
import {
  RepairRunCoordinator,
  SQLiteRepairRunRepository,
  createUnavailableRepairRunExecutionPort,
  repairRunSessionSha256,
} from "../../dist/index.js";
import {
  ANONYMOUS_WORKSPACE_TTL_MS,
  ensureSeededSessionWorkspace,
  getSessionPolicyId,
} from "../../app/lib/policy-workspace-store.ts";

function createBlockedRun(repository, sessionToken, policyId, clientRequestId, createdAt) {
  const created = repository.createOrGetRun({
    clientRequestId,
    sessionSha256: repairRunSessionSha256(sessionToken),
    policyId,
    policyVersion: 1,
    policyIrSha256: "a".repeat(64),
    inputSha256: "b".repeat(64),
    createdAt,
  }, {
    ownerId: `reo_${"4".repeat(32)}`,
    leaseDurationMs: 1_000,
  });
  assert.ok(created.lease);
  return repository.markBlocked(
    created.run.id,
    {
      code: "LIVE_EXECUTOR_NOT_ADMITTED",
      message: "The unavailable executor did not start external work.",
    },
    new Date(Date.parse(createdAt) + 1).toISOString(),
    created.lease,
  );
}

test("anonymous session expiry prunes its terminal repair runs and events", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-session-prune-"));
  const databasePath = join(root, "policy.sqlite");
  const repairRunDatabasePath = join(root, "repair.sqlite");
  const repository = new SQLitePolicyRepository(databasePath);
  const repairRunRepository = new SQLiteRepairRunRepository(repairRunDatabasePath);
  t.after(async () => {
    repairRunRepository.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = {
    repository,
    service: new PolicyWorkspaceService(repository),
    mutationGate: new SingleRunGate(),
    databasePath,
    repairRunRepository,
    repairRunCoordinator: new RepairRunCoordinator(
      repairRunRepository,
      createUnavailableRepairRunExecutionPort(),
    ),
    repairRunDatabasePath,
  };
  const firstSession = Buffer.alloc(32, 21).toString("base64url");
  const secondSession = Buffer.alloc(32, 22).toString("base64url");
  const startedAt = new Date("2026-07-18T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
  const firstRun = createBlockedRun(
    repairRunRepository,
    firstSession,
    firstPolicyId,
    "21212121-2121-4121-8121-212121212121",
    startedAt.toISOString(),
  );
  assert.equal(
    repairRunRepository.listEventsForSession(
      firstRun.id,
      repairRunSessionSha256(firstSession),
    ).length,
    2,
  );

  const afterFirstExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS + 1);
  const secondPolicyId = ensureSeededSessionWorkspace(store, secondSession, afterFirstExpiry);
  assert.equal(repository.getProject(firstPolicyId), null);
  assert.equal(
    repairRunRepository.getRunForSession(firstRun.id, repairRunSessionSha256(firstSession)),
    null,
  );

  const secondRun = createBlockedRun(
    repairRunRepository,
    secondSession,
    secondPolicyId,
    "22222222-2222-4222-8222-222222222222",
    afterFirstExpiry.toISOString(),
  );
  const afterSecondExpiry = new Date(
    afterFirstExpiry.getTime() + ANONYMOUS_WORKSPACE_TTL_MS + 1,
  );
  assert.throws(
    () => getSessionPolicyId(store, secondSession, afterSecondExpiry),
    /session has expired/u,
  );
  assert.equal(repository.getProject(secondPolicyId), null);
  assert.equal(
    repairRunRepository.getRunForSession(secondRun.id, repairRunSessionSha256(secondSession)),
    null,
  );
});
