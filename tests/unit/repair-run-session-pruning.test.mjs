import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SingleRunGate } from "../../dist/openai/request-guard.js";
import {
  PolicyPersistenceError,
  SQLitePolicyRepository,
} from "../../dist/persistence/sqlite.js";
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

async function createCapacityStore(testContext, label) {
  const previousCapacity = process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
  process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = "1";
  const root = await mkdtemp(join(tmpdir(), `policytwin-${label}-`));
  const databasePath = join(root, "policy.sqlite");
  const repairRunDatabasePath = join(root, "repair.sqlite");
  let repository;
  let repairRunRepository;
  testContext.after(async () => {
    if (previousCapacity === undefined) {
      delete process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
    } else {
      process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = previousCapacity;
    }
    repairRunRepository?.close();
    repository?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  repository = new SQLitePolicyRepository(databasePath);
  repairRunRepository = new SQLiteRepairRunRepository(repairRunDatabasePath);
  return {
    databasePath,
    repairRunDatabasePath,
    repository,
    repairRunRepository,
    store: {
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
    },
  };
}

test("anonymous session expiry prunes its terminal repair runs and events", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-session-prune-"));
  const databasePath = join(root, "policy.sqlite");
  const repairRunDatabasePath = join(root, "repair.sqlite");
  let repository;
  let repairRunRepository;
  t.after(async () => {
    repairRunRepository?.close();
    repository?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  repository = new SQLitePolicyRepository(databasePath);
  repairRunRepository = new SQLiteRepairRunRepository(repairRunDatabasePath);
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

test("anonymous capacity remains idempotent, retires expired IDs, and reuses only a durable slot", async (t) => {
  const previousCapacity = process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
  process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = "1";
  const root = await mkdtemp(join(tmpdir(), "policytwin-session-capacity-"));
  const databasePath = join(root, "policy.sqlite");
  const repairRunDatabasePath = join(root, "repair.sqlite");
  let repository;
  let repairRunRepository;
  t.after(async () => {
    if (previousCapacity === undefined) {
      delete process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
    } else {
      process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = previousCapacity;
    }
    repairRunRepository?.close();
    repository?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  repository = new SQLitePolicyRepository(databasePath);
  repairRunRepository = new SQLiteRepairRunRepository(repairRunDatabasePath);
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
  const firstSession = Buffer.alloc(32, 31).toString("base64url");
  const secondSession = Buffer.alloc(32, 32).toString("base64url");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
  assert.equal(
    ensureSeededSessionWorkspace(store, firstSession, new Date(startedAt.getTime() + 1)),
    firstPolicyId,
  );
  assert.throws(
    () =>
      ensureSeededSessionWorkspace(store, secondSession, new Date(startedAt.getTime() + 1)),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_CAPACITY",
  );
  assert.equal(repository.listProjects().length, 1);

  const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
  const secondPolicyId = ensureSeededSessionWorkspace(store, secondSession, atExpiry);
  assert.equal(repository.getProject(firstPolicyId), null);
  assert.ok(repository.getProject(secondPolicyId));
  assert.equal(repository.listProjects().length, 1);
  for (const replayAt of [atExpiry, new Date(atExpiry.getTime() + 1)]) {
    assert.throws(
      () => ensureSeededSessionWorkspace(store, firstSession, replayAt),
      (error) => error?.status === 403 && error?.code === "INVALID_SESSION",
    );
  }
  assert.equal(repository.getProject(firstPolicyId), null);
  assert.equal(repository.listProjects().length, 1);
});

test("retired IDs cannot be recreated and stale expiry snapshots cannot prune a live workspace", async (t) => {
  const previousCapacity = process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
  process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = "1";
  const root = await mkdtemp(join(tmpdir(), "policytwin-session-generation-"));
  const databasePath = join(root, "policy.sqlite");
  const repairRunDatabasePath = join(root, "repair.sqlite");
  const repositories = [];
  const repairRepositories = [];
  t.after(async () => {
    if (previousCapacity === undefined) {
      delete process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES;
    } else {
      process.env.POLICYTWIN_MAX_ANONYMOUS_WORKSPACES = previousCapacity;
    }
    for (const repository of repairRepositories) repository.close();
    for (const repository of repositories) repository.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const repositoryA = new SQLitePolicyRepository(databasePath);
  repositories.push(repositoryA);
  const repositoryB = new SQLitePolicyRepository(databasePath);
  repositories.push(repositoryB);
  const repairRepositoryA = new SQLiteRepairRunRepository(repairRunDatabasePath);
  repairRepositories.push(repairRepositoryA);
  const repairRepositoryB = new SQLiteRepairRunRepository(repairRunDatabasePath);
  repairRepositories.push(repairRepositoryB);
  const storeB = {
    repository: repositoryB,
    service: new PolicyWorkspaceService(repositoryB),
    mutationGate: new SingleRunGate(),
    databasePath,
    repairRunRepository: repairRepositoryB,
    repairRunCoordinator: new RepairRunCoordinator(
      repairRepositoryB,
      createUnavailableRepairRunExecutionPort(),
    ),
    repairRunDatabasePath,
  };
  const firstSession = Buffer.alloc(32, 41).toString("base64url");
  const secondSession = Buffer.alloc(32, 42).toString("base64url");
  const thirdSession = Buffer.alloc(32, 43).toString("base64url");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(storeB, firstSession, startedAt);
  const staleProject = repositoryA.getAnonymousWorkspaceProject(firstPolicyId);
  assert.ok(staleProject);
  assert.equal(
    repositoryB.deleteAnonymousWorkspaceIfGeneration(
      firstPolicyId,
      staleProject.storageGeneration,
      () => true,
    ),
    true,
  );
  let delayedAdmissionCalls = 0;
  const delayedAdmission = repositoryA.withAnonymousWorkspaceGeneration(
    firstPolicyId,
    staleProject.storageGeneration,
    () => {
      delayedAdmissionCalls += 1;
      return repairRepositoryA.createOrGetRun(
        {
          clientRequestId: "40404040-4040-4040-8040-404040404040",
          sessionSha256: repairRunSessionSha256(firstSession),
          policyId: firstPolicyId,
          policyVersion: 1,
          policyIrSha256: "a".repeat(64),
          inputSha256: "b".repeat(64),
          createdAt: startedAt.toISOString(),
        },
        { ownerId: `reo_${"4".repeat(32)}`, leaseDurationMs: 1_000 },
      );
    },
  );
  assert.deepEqual(delayedAdmission, { matched: false });
  assert.equal(delayedAdmissionCalls, 0);
  for (const replayAt of [startedAt, new Date(startedAt.getTime() + 1)]) {
    assert.throws(
      () => ensureSeededSessionWorkspace(storeB, firstSession, replayAt),
      (error) => error?.status === 403 && error?.code === "INVALID_SESSION",
    );
  }
  const replacementStartedAt = new Date(startedAt.getTime() + 1);
  const secondPolicyId = ensureSeededSessionWorkspace(
    storeB,
    secondSession,
    replacementStartedAt,
  );
  const replacement = repositoryB.getAnonymousWorkspaceProject(secondPolicyId);
  assert.ok(replacement);
  const replacementRun = createBlockedRun(
    repairRepositoryB,
    secondSession,
    secondPolicyId,
    "41414141-4141-4141-8141-414141414141",
    replacementStartedAt.toISOString(),
  );

  let pruneCalls = 0;
  const staleRepositoryView = new Proxy(repositoryA, {
    get(target, property) {
      if (property === "listAnonymousWorkspaceProjects") {
        return () => [staleProject];
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const observedRepairRepository = new Proxy(repairRepositoryA, {
    get(target, property) {
      if (property === "pruneTerminalRunsForPolicy") {
        return (...args) => {
          pruneCalls += 1;
          return target.pruneTerminalRunsForPolicy(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const staleStore = {
    ...storeB,
    repository: staleRepositoryView,
    service: new PolicyWorkspaceService(repositoryA),
    repairRunRepository: observedRepairRepository,
  };
  const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
  assert.throws(
    () => ensureSeededSessionWorkspace(staleStore, thirdSession, atExpiry),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_CAPACITY",
  );
  assert.equal(pruneCalls, 0);
  assert.equal(
    repositoryA.getAnonymousWorkspaceProject(secondPolicyId)?.storageGeneration,
    replacement.storageGeneration,
  );
  assert.ok(
    repairRepositoryA.getRunForSession(
      replacementRun.id,
      repairRunSessionSha256(secondSession),
    ),
  );
});

test("an active repair run retains its expired workspace capacity slot", async (t) => {
  const { repository, repairRunRepository, store } = await createCapacityStore(
    t,
    "session-active-run",
  );
  const firstSession = Buffer.alloc(32, 51).toString("base64url");
  const secondSession = Buffer.alloc(32, 52).toString("base64url");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
  const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
  const project = repository.getAnonymousWorkspaceProject(firstPolicyId);
  assert.ok(project);
  const admitted = repository.withAnonymousWorkspaceGeneration(
    firstPolicyId,
    project.storageGeneration,
    () =>
      repairRunRepository.createOrGetRun(
        {
          clientRequestId: "51515151-5151-4151-8151-515151515151",
          sessionSha256: repairRunSessionSha256(firstSession),
          policyId: firstPolicyId,
          policyVersion: 1,
          policyIrSha256: "a".repeat(64),
          inputSha256: "b".repeat(64),
          createdAt: atExpiry.toISOString(),
        },
        { ownerId: `reo_${"5".repeat(32)}`, leaseDurationMs: 60_000 },
      ),
  );
  assert.equal(admitted.matched, true);
  const active = admitted.value.run;
  assert.throws(
    () => ensureSeededSessionWorkspace(store, firstSession, atExpiry),
    (error) => error?.code === "INVALID_SESSION",
  );
  assert.throws(
    () => ensureSeededSessionWorkspace(store, secondSession, atExpiry),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_CAPACITY",
  );
  assert.ok(repository.getProject(firstPolicyId));
  assert.ok(
    repairRunRepository.getRunForSession(active.id, repairRunSessionSha256(firstSession)),
  );
});

test("repair pruning failure keeps the expired policy and blocks new admission", async (t) => {
  const { repository, repairRunRepository, store } = await createCapacityStore(
    t,
    "session-prune-failure",
  );
  const firstSession = Buffer.alloc(32, 61).toString("base64url");
  const secondSession = Buffer.alloc(32, 62).toString("base64url");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
  const firstRun = createBlockedRun(
    repairRunRepository,
    firstSession,
    firstPolicyId,
    "61616161-6161-4161-8161-616161616161",
    startedAt.toISOString(),
  );
  const failingRepairRepository = new Proxy(repairRunRepository, {
    get(target, property) {
      if (property === "pruneTerminalRunsForPolicy") {
        return () => {
          throw new Error("repair pruning unavailable");
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const failingStore = { ...store, repairRunRepository: failingRepairRepository };
  const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
  assert.throws(
    () => ensureSeededSessionWorkspace(failingStore, secondSession, atExpiry),
    (error) => error instanceof PolicyPersistenceError && error.code === "STORAGE_FAILURE",
  );
  assert.ok(repository.getProject(firstPolicyId));
  assert.ok(
    repairRunRepository.getRunForSession(firstRun.id, repairRunSessionSha256(firstSession)),
  );
});

test(
  "a repair-database writer lock fails expiry cleanup closed and permits a later retry",
  { timeout: 10_000 },
  async (t) => {
    const {
      repairRunDatabasePath,
      repository,
      repairRunRepository,
      store,
    } = await createCapacityStore(t, "session-prune-busy");
    let repairWriter;
    let repairWriterLocked = false;
    t.after(() => {
      if (repairWriterLocked) repairWriter?.exec("ROLLBACK");
      repairWriter?.close();
    });
    const firstSession = Buffer.alloc(32, 66).toString("base64url");
    const secondSession = Buffer.alloc(32, 67).toString("base64url");
    const startedAt = new Date("2026-07-19T00:00:00.000Z");
    const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
    const firstRun = createBlockedRun(
      repairRunRepository,
      firstSession,
      firstPolicyId,
      "66666666-6666-4666-8666-666666666666",
      startedAt.toISOString(),
    );
    repairWriter = new DatabaseSync(repairRunDatabasePath);
    repairWriter.exec("BEGIN IMMEDIATE");
    repairWriterLocked = true;
    const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
    assert.throws(
      () => ensureSeededSessionWorkspace(store, secondSession, atExpiry),
      (error) => error instanceof PolicyPersistenceError && error.code === "STORAGE_FAILURE",
    );
    assert.ok(repository.getProject(firstPolicyId));
    assert.ok(
      repairRunRepository.getRunForSession(firstRun.id, repairRunSessionSha256(firstSession)),
    );
    repairWriter.exec("COMMIT");
    repairWriterLocked = false;
    const secondPolicyId = ensureSeededSessionWorkspace(store, secondSession, atExpiry);
    assert.equal(repository.getProject(firstPolicyId), null);
    assert.ok(repository.getProject(secondPolicyId));
    assert.equal(
      repairRunRepository.getRunForSession(firstRun.id, repairRunSessionSha256(firstSession)),
      null,
    );
    repairWriter.close();
    repairWriter = null;
  },
);

test("a policy-delete failure exposes the documented two-database partial cleanup boundary", async (t) => {
  const { databasePath, repository, repairRunRepository, store } = await createCapacityStore(
    t,
    "session-policy-delete-failure",
  );
  const firstSession = Buffer.alloc(32, 71).toString("base64url");
  const secondSession = Buffer.alloc(32, 72).toString("base64url");
  const startedAt = new Date("2026-07-19T00:00:00.000Z");
  const firstPolicyId = ensureSeededSessionWorkspace(store, firstSession, startedAt);
  const firstRun = createBlockedRun(
    repairRunRepository,
    firstSession,
    firstPolicyId,
    "71717171-7171-4171-8171-717171717171",
    startedAt.toISOString(),
  );
  const raw = new DatabaseSync(databasePath);
  raw.exec(`
    CREATE TRIGGER reject_expired_policy_delete
    BEFORE DELETE ON policy_projects
    WHEN OLD.id = '${firstPolicyId}'
    BEGIN
      SELECT RAISE(ABORT, 'forced policy delete failure');
    END;
  `);
  raw.close();
  const atExpiry = new Date(startedAt.getTime() + ANONYMOUS_WORKSPACE_TTL_MS);
  assert.throws(
    () => ensureSeededSessionWorkspace(store, secondSession, atExpiry),
    (error) => error instanceof PolicyPersistenceError && error.code === "STORAGE_FAILURE",
  );
  assert.ok(repository.getProject(firstPolicyId));
  assert.equal(
    repairRunRepository.getRunForSession(firstRun.id, repairRunSessionSha256(firstSession)),
    null,
  );
});
