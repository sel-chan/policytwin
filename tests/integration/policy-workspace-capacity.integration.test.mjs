import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
  PolicyPersistenceError,
  SQLitePolicyRepository,
} from "../../dist/persistence/sqlite.js";
import { SQLiteRepairRunRepository } from "../../dist/repair-runs/sqlite.js";

const PROCESS_PATH = fileURLToPath(
  new URL("../helpers/policy-capacity-process.mjs", import.meta.url),
);
const REPAIR_ADMISSION_PROCESS_PATH = fileURLToPath(
  new URL("../helpers/policy-repair-admission-process.mjs", import.meta.url),
);
const SCOPE = { idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX, maximumProjects: 1 };

function project(id, createdAt = "2026-07-19T00:00:00.000Z") {
  return {
    id,
    title: `Workspace ${id}`,
    sourceText: "Draft refund policy.",
    goldenCases: [],
    createdAt,
  };
}

function observeProcess(child) {
  let readySettled = false;
  let enteredSettled = false;
  let resultSettled = false;
  let resolveReady;
  let rejectReady;
  let resolveEntered;
  let rejectEntered;
  let resolveResult;
  let rejectResult;
  let resolveExit;
  let rejectExit;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const entered = new Promise((resolve, reject) => {
    resolveEntered = resolve;
    rejectEntered = reject;
  });
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const exit = new Promise((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  child.on("message", (message) => {
    if (message?.type === "READY" && !readySettled) {
      readySettled = true;
      resolveReady();
    }
    if (message?.type === "ENTERING") {
      if (!enteredSettled) {
        enteredSettled = true;
        resolveEntered();
      }
    }
    if (message?.type === "RESULT" && !resultSettled) {
      resultSettled = true;
      resolveResult(message);
    }
  });
  child.on("error", (error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(error);
    }
    if (!enteredSettled) {
      enteredSettled = true;
      rejectEntered(error);
    }
    rejectExit(error);
  });
  child.on("exit", (code) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error(`Capacity process exited before ready with code ${code}.`));
    }
    if (!enteredSettled) {
      enteredSettled = true;
      rejectEntered(new Error(`Capacity process exited before entry with code ${code}.`));
    }
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(new Error(`Capacity process exited before a result with code ${code}.`));
    }
    if (code === 0) {
      resolveExit();
    } else {
      rejectExit(new Error(`Capacity process exited with code ${code}.`));
    }
  });
  return { ready, entered, result, exit };
}

async function raceProjects(testContext, projectIds, preinitialize = false) {
  const root = await mkdtemp(join(tmpdir(), "policytwin-policy-capacity-race-"));
  const databasePath = join(root, "policy.sqlite");
  let repository;
  let initializer;
  let writerLock;
  let writerLocked = false;
  const children = [];
  testContext.after(async () => {
    repository?.close();
    initializer?.close();
    if (writerLocked) writerLock?.exec("ROLLBACK");
    writerLock?.close();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.allSettled(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once("exit", resolve);
          }),
      ),
    );
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  if (preinitialize) {
    initializer = new SQLitePolicyRepository(databasePath);
    initializer.close();
    initializer = null;
  }
  writerLock = new DatabaseSync(databasePath);
  writerLock.exec("PRAGMA journal_mode = WAL");
  writerLock.exec("BEGIN IMMEDIATE");
  writerLocked = true;
  for (const projectId of projectIds) {
    children.push(
      fork(
        PROCESS_PATH,
        [databasePath, JSON.stringify(project(projectId)), JSON.stringify(SCOPE)],
        { stdio: ["ignore", "ignore", "ignore", "ipc"] },
      ),
    );
  }
  const observations = children.map(observeProcess);
  await Promise.all(observations.map((observation) => observation.ready));
  const resultsPromise = Promise.all(observations.map((observation) => observation.result));
  for (const child of children) child.send({ type: "START" });
  await Promise.all(observations.map((observation) => observation.entered));
  await new Promise((resolve) => setTimeout(resolve, 100));
  writerLock.exec("COMMIT");
  writerLocked = false;
  writerLock.close();
  writerLock = null;
  const results = await resultsPromise;
  await Promise.all(observations.map((observation) => observation.exit));
  repository = new SQLitePolicyRepository(databasePath);
  return { repository, results };
}

test(
  "two policy repositories cannot over-admit one shared anonymous capacity slot",
  { timeout: 15_000 },
  async (t) => {
    const projectIds = [
      `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}a`,
      `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}b`,
    ];
    const { repository, results } = await raceProjects(t, projectIds, true);

    assert.equal(results.filter((result) => result.outcome === "CREATED").length, 1);
    assert.deepEqual(
      results
        .filter((result) => result.outcome === "ERROR")
        .map((result) => result.code),
      ["PROJECT_CAPACITY"],
    );

    const stored = repository
      .listProjects()
      .filter((candidate) => candidate.id.startsWith(SCOPE.idPrefix));
    assert.equal(stored.length, 1);
    assert.ok(repository.getVersion(stored[0].id, 1));
    const rejectedId = projectIds.find((id) => id !== stored[0].id);
    assert.equal(repository.getProject(rejectedId), null);
    assert.equal(repository.getVersion(rejectedId, 1), null);
  },
);

test(
  "concurrent exact duplicate admission creates one v1 and returns PROJECT_EXISTS",
  { timeout: 15_000 },
  async (t) => {
    const projectId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}same`;
    const { repository, results } = await raceProjects(t, [projectId, projectId]);
    assert.equal(results.filter((result) => result.outcome === "CREATED").length, 1);
    assert.deepEqual(
      results
        .filter((result) => result.outcome === "ERROR")
        .map((result) => result.code),
      ["PROJECT_EXISTS"],
    );
    assert.equal(repository.listAnonymousWorkspaceProjects().length, 1);
    assert.ok(repository.getVersion(projectId, 1));
  },
);

test(
  "write-lock exhaustion fails closed without a partial project and can be retried",
  { timeout: 10_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "policytwin-policy-capacity-busy-"));
    const databasePath = join(root, "policy.sqlite");
    let repository;
    let writerLock;
    let writerLocked = false;
    t.after(async () => {
      repository?.close();
      if (writerLocked) writerLock?.exec("ROLLBACK");
      writerLock?.close();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    repository = new SQLitePolicyRepository(databasePath);
    writerLock = new DatabaseSync(databasePath);
    writerLock.exec("PRAGMA journal_mode = WAL");
    writerLock.exec("BEGIN IMMEDIATE");
    writerLocked = true;
    const projectId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}busy`;
    assert.throws(
      () => repository.createProjectWithinCapacity(project(projectId), SCOPE),
      (error) => error instanceof PolicyPersistenceError && error.code === "STORAGE_FAILURE",
    );
    assert.equal(
      writerLock
        .prepare("SELECT COUNT(*) AS count FROM policy_projects WHERE id = ?")
        .get(projectId).count,
      0,
    );
    writerLock.exec("COMMIT");
    writerLocked = false;
    assert.equal(repository.createProjectWithinCapacity(project(projectId), SCOPE).id, projectId);
    assert.ok(repository.getVersion(projectId, 1));
  },
);

test(
  "expiry deletion wins before a delayed cross-process repair admission",
  { timeout: 15_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "policytwin-policy-repair-admission-race-"));
    const policyDatabasePath = join(root, "policy.sqlite");
    const repairDatabasePath = join(root, "repair.sqlite");
    let policyRepository;
    let repairRepository;
    let writerLock;
    let writerLocked = false;
    let child;
    t.after(async () => {
      policyRepository?.close();
      repairRepository?.close();
      if (writerLocked) writerLock?.exec("ROLLBACK");
      writerLock?.close();
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => child.once("exit", resolve));
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    policyRepository = new SQLitePolicyRepository(policyDatabasePath);
    repairRepository = new SQLiteRepairRunRepository(repairDatabasePath);
    const policyId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}repair-race`;
    policyRepository.createProjectWithinCapacity(project(policyId), SCOPE);
    const observed = policyRepository.getAnonymousWorkspaceProject(policyId);
    assert.ok(observed);
    const sessionSha256 = "8".repeat(64);

    writerLock = new DatabaseSync(policyDatabasePath);
    writerLock.exec("PRAGMA foreign_keys = ON");
    writerLock.exec("PRAGMA journal_mode = WAL");
    writerLock.exec("BEGIN IMMEDIATE");
    writerLocked = true;
    child = fork(
      REPAIR_ADMISSION_PROCESS_PATH,
      [
        policyDatabasePath,
        repairDatabasePath,
        policyId,
        observed.storageGeneration,
        sessionSha256,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const observation = observeProcess(child);
    await observation.ready;
    child.send({ type: "START" });
    await observation.entered;
    await new Promise((resolve) => setTimeout(resolve, 100));
    writerLock
      .prepare(
        "INSERT INTO anonymous_workspace_tombstones(policy_id,storage_generation) VALUES (?,?)",
      )
      .run(policyId, observed.storageGeneration);
    writerLock
      .prepare(
        "INSERT INTO policy_project_delete_authority(policy_id,storage_generation) VALUES (?,?)",
      )
      .run(policyId, observed.storageGeneration);
    writerLock.prepare("DELETE FROM policy_versions WHERE policy_id = ?").run(policyId);
    writerLock.prepare("DELETE FROM policy_projects WHERE id = ?").run(policyId);
    writerLock.exec("COMMIT");
    writerLocked = false;
    const result = await observation.result;
    await observation.exit;

    assert.equal(result.outcome, "NOT_MATCHED");
    assert.equal(policyRepository.getProject(policyId), null);
    assert.equal(repairRepository.getLatestRunForSession(sessionSha256), null);
  },
);

test("capacity admission validates scope, prioritizes exact duplicates, and rolls back v1", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "policytwin-policy-capacity-contract-"));
  const databasePath = join(root, "policy.sqlite");
  const repository = new SQLitePolicyRepository(databasePath);
  t.after(async () => {
    repository.close();
    await rm(root, { recursive: true, force: true });
  });

  const ordinary = project("policy-ordinary-project");
  repository.createProject(ordinary);
  const first = project(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}first`);
  repository.createProjectWithinCapacity(first, SCOPE);
  assert.equal(repository.listProjects().length, 2);
  assert.throws(
    () => repository.createProjectWithinCapacity(first, SCOPE),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_EXISTS",
  );
  assert.throws(
    () =>
      repository.createProjectWithinCapacity(
        project(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}second`),
        SCOPE,
      ),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_CAPACITY",
  );
  for (const scope of [
    null,
    {},
    { ...SCOPE, extra: true },
    { ...SCOPE, maximumProjects: 0 },
    { ...SCOPE, maximumProjects: 1.5 },
    { ...SCOPE, maximumProjects: Number.MAX_SAFE_INTEGER + 1 },
    { idPrefix: "p", maximumProjects: 2 },
    { idPrefix: "other-session-", maximumProjects: 2 },
  ]) {
    assert.throws(
      () =>
        repository.createProjectWithinCapacity(
          project(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}invalid`),
          scope,
        ),
      (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
    );
  }
  assert.throws(
    () => repository.createProject(project(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}bypass`)),
    (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
  );

  const raw = new DatabaseSync(databasePath);
  assert.throws(() =>
    raw
      .prepare(
        "INSERT INTO policy_projects(id,title,current_version,created_at,updated_at,storage_generation,capacity_scope) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}raw-bypass`,
        "Raw bypass",
        1,
        "2026-07-19T00:00:00.000Z",
        "2026-07-19T00:00:00.000Z",
        "f".repeat(32),
        null,
      ),
  );
  raw.exec(`
    CREATE TRIGGER reject_broken_policy_version
    BEFORE INSERT ON policy_versions
    WHEN NEW.policy_id = '${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}broken'
    BEGIN
      SELECT RAISE(ABORT, 'forced version failure');
    END;
  `);
  raw.close();
  assert.throws(
    () =>
      repository.createProjectWithinCapacity(project(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}broken`), {
        ...SCOPE,
        maximumProjects: 2,
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "STORAGE_FAILURE",
  );
  assert.equal(repository.getProject(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}broken`), null);
  assert.equal(repository.getVersion(`${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}broken`, 1), null);
});
