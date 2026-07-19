import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolvePolicyAmbiguity } from "../../dist/index.js";
import {
  ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
  PolicyPersistenceError,
  SQLitePolicyRepository,
} from "../../dist/persistence/sqlite.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const sourceText = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);

async function withRepository(testContext) {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-persistence-unit-"));
  const databasePath = join(directory, "policytwin.sqlite");
  const repository = new SQLitePolicyRepository(databasePath);
  testContext.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { databasePath, repository };
}

function createSeededProject(repository) {
  return repository.createProject({
    id: recorded.policyId,
    title: "Seeded refund policy",
    sourceText,
    goldenCases,
    policyIR: recorded,
    createdAt: "2026-07-14T02:00:00.000Z",
  });
}

test("strictly creates an immutable initial project snapshot", async (testContext) => {
  const { repository } = await withRepository(testContext);
  const project = createSeededProject(repository);
  assert.deepEqual(project, {
    id: "policy-seeded-refund",
    title: "Seeded refund policy",
    currentVersion: 1,
    createdAt: "2026-07-14T02:00:00.000Z",
    updatedAt: "2026-07-14T02:00:00.000Z",
  });

  const firstRead = repository.getVersion(recorded.policyId, 1);
  assert.equal(firstRead.state, "NEEDS_DECISION");
  firstRead.goldenCases[0].title = "mutated caller copy";
  firstRead.policyIR.rules[0].title = "mutated caller copy";
  const secondRead = repository.getVersion(recorded.policyId, 1);
  assert.notEqual(secondRead.goldenCases[0].title, "mutated caller copy");
  assert.notEqual(secondRead.policyIR.rules[0].title, "mutated caller copy");

  assert.throws(
    () => createSeededProject(repository),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_EXISTS",
  );
  assert.throws(
    () => repository.createProject({ id: "valid", title: "x", sourceText: "x", goldenCases: [], extra: true }),
    (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
  );
  assert.throws(
    () =>
      repository.createProject({
        id: "invalid-time",
        title: "x",
        sourceText: "x",
        goldenCases: [],
        createdAt: "not-a-time",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
  );
});

test("lists projects and deletes an isolated project with all child records", async (testContext) => {
  const { repository } = await withRepository(testContext);
  createSeededProject(repository);
  const resolved = resolvePolicyAmbiguity(
    recorded,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    goldenCases,
    "2026-07-14T02:01:00.000Z",
  );
  repository.appendVersion({
    policyId: recorded.policyId,
    expectedParentVersion: 1,
    sourceText,
    goldenCases,
    policyIR: resolved.policy,
    decisionRecord: resolved.decisionRecord,
    createdAt: "2026-07-14T02:01:00.000Z",
  });
  repository.createProject({
    id: "policy-session-second",
    title: "Second isolated session",
    sourceText: "Draft",
    goldenCases: [],
    createdAt: "2026-07-14T02:02:00.000Z",
  });

  assert.deepEqual(
    repository.listProjects().map((project) => project.id),
    [recorded.policyId, "policy-session-second"],
  );
  assert.equal(repository.deleteProject(recorded.policyId), true);
  assert.equal(repository.getProject(recorded.policyId), null);
  assert.deepEqual(repository.listVersions(recorded.policyId), []);
  assert.deepEqual(repository.listDecisionRecords(recorded.policyId), []);
  assert.equal(repository.deleteProject(recorded.policyId), false);
  assert.deepEqual(repository.listProjects().map((project) => project.id), [
    "policy-session-second",
  ]);
});

test("rejects stale versions, mismatched decisions, and invalid source traceability", async (testContext) => {
  const { repository } = await withRepository(testContext);
  createSeededProject(repository);
  const first = resolvePolicyAmbiguity(
    recorded,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    goldenCases,
    "2026-07-14T02:01:00.000Z",
  );
  repository.appendVersion({
    policyId: recorded.policyId,
    expectedParentVersion: 1,
    sourceText,
    goldenCases,
    policyIR: first.policy,
    decisionRecord: first.decisionRecord,
    createdAt: "2026-07-14T02:01:00.000Z",
  });

  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 1,
        sourceText,
        goldenCases,
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "STALE_VERSION",
  );
  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 2,
        sourceText,
        goldenCases,
        createdAt: "2026-07-14T01:59:00.000Z",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
  );

  const second = resolvePolicyAmbiguity(
    first.policy,
    "ambiguity-usage-measurement-time",
    "usage-at-request",
    goldenCases,
    "2026-07-14T02:02:00.000Z",
  );
  const tamperedRecord = structuredClone(second.decisionRecord);
  tamperedRecord.policyPatch = {
    op: "SET_NORMALIZATION",
    field: "usageMeasuredAt",
    value: "DECISION_TIME",
  };
  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 2,
        sourceText,
        goldenCases,
        policyIR: second.policy,
        decisionRecord: tamperedRecord,
        createdAt: "2026-07-14T02:02:00.000Z",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "DECISION_MISMATCH",
  );
  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 2,
        sourceText,
        goldenCases,
        policyIR: second.policy,
        createdAt: "2026-07-14T02:02:00.000Z",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "DECISION_MISMATCH",
  );

  const unrelatedChange = structuredClone(second.policy);
  unrelatedChange.rules[0].title = "Unrelated hidden change";
  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 2,
        sourceText,
        goldenCases,
        policyIR: unrelatedChange,
        decisionRecord: second.decisionRecord,
        createdAt: "2026-07-14T02:02:00.000Z",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "DECISION_MISMATCH",
  );
  assert.throws(
    () =>
      repository.appendVersion({
        policyId: recorded.policyId,
        expectedParentVersion: 2,
        sourceText: `changed ${sourceText}`,
        goldenCases,
        policyIR: second.policy,
        createdAt: "2026-07-14T02:02:00.000Z",
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "INVALID_INPUT",
  );
  assert.equal(repository.getProject(recorded.policyId).currentVersion, 2);
});

test("fails closed when persisted JSON is corrupted", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-persistence-corrupt-"));
  const databasePath = join(directory, "policytwin.sqlite");
  const repository = new SQLitePolicyRepository(databasePath);
  createSeededProject(repository);
  repository.close();

  const database = new DatabaseSync(databasePath);
  database
    .prepare("UPDATE policy_versions SET golden_cases_json = ? WHERE policy_id = ? AND version = 1")
    .run("{", recorded.policyId);
  database.close();

  const reopened = new SQLitePolicyRepository(databasePath);
  testContext.after(async () => {
    reopened.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.throws(
    () => reopened.getVersion(recorded.policyId, 1),
    (error) => error instanceof PolicyPersistenceError && error.code === "CORRUPTED_STORAGE",
  );
});

test("migrates schema v1 projects to fenced generations and durable retirement tombstones", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-persistence-migration-"));
  const databasePath = join(directory, "policytwin.sqlite");
  let database;
  let repository;
  testContext.after(async () => {
    repository?.close();
    database?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const policyId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}legacy`;
  const createdAt = "2026-07-14T02:00:00.000Z";
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE policy_projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_version INTEGER NOT NULL CHECK (current_version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE policy_versions (
      policy_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      parent_version INTEGER,
      source_text TEXT NOT NULL,
      golden_cases_json TEXT NOT NULL,
      policy_ir_json TEXT,
      lifecycle_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (policy_id, version),
      FOREIGN KEY (policy_id) REFERENCES policy_projects(id) ON DELETE RESTRICT,
      FOREIGN KEY (policy_id, parent_version)
        REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT
    );
    CREATE TABLE policy_decisions (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      ambiguity_id TEXT NOT NULL,
      selected_option_id TEXT NOT NULL,
      policy_patch_json TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      UNIQUE (policy_id, to_version),
      FOREIGN KEY (policy_id, from_version)
        REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT,
      FOREIGN KEY (policy_id, to_version)
        REFERENCES policy_versions(policy_id, version) ON DELETE RESTRICT
    );
    CREATE INDEX policy_versions_created_idx
      ON policy_versions(policy_id, created_at);
    CREATE INDEX policy_decisions_policy_idx
      ON policy_decisions(policy_id, to_version);
    PRAGMA user_version = 1;
  `);
  database
    .prepare(
      "INSERT INTO policy_projects(id,title,current_version,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
    .run(policyId, "Legacy anonymous project", 1, createdAt, createdAt);
  database
    .prepare(
      "INSERT INTO policy_versions(policy_id,version,parent_version,source_text,golden_cases_json,policy_ir_json,lifecycle_state,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(policyId, 1, null, "Draft", "[]", null, "DRAFT", createdAt);
  repository = new SQLitePolicyRepository(databasePath);
  const migrated = repository.getAnonymousWorkspaceProject(policyId);
  assert.ok(migrated);
  assert.match(migrated.storageGeneration, /^[a-f0-9]{32}$/u);
  assert.equal(repository.getVersion(policyId, 1)?.sourceText, "Draft");
  assert.throws(() =>
    database
      .prepare("UPDATE policy_projects SET storage_generation = ? WHERE id = ?")
      .run("f".repeat(32), policyId),
  );
  assert.throws(() =>
    database
      .prepare(
        "INSERT INTO policy_project_delete_authority(policy_id,storage_generation) VALUES (?,?)",
      )
      .run(policyId, "e".repeat(32)),
  );
  assert.equal(
    repository.deleteAnonymousWorkspaceIfGeneration(
      policyId,
      migrated.storageGeneration,
      () => true,
    ),
    true,
  );
  const tombstone = database
    .prepare(
      "SELECT policy_id,storage_generation FROM anonymous_workspace_tombstones WHERE policy_id = ?",
    )
    .get(policyId);
  assert.equal(tombstone?.policy_id, policyId);
  assert.equal(tombstone?.storage_generation, migrated.storageGeneration);
  const retiredProject = {
    id: policyId,
    title: "Recreated anonymous project",
    sourceText: "Draft",
    goldenCases: [],
    createdAt,
  };
  assert.throws(
    () =>
      repository.createProjectWithinCapacity(retiredProject, {
        idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
        maximumProjects: 1,
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_RETIRED",
  );
  assert.throws(() =>
    database
      .prepare(
        "INSERT INTO policy_projects(id,title,current_version,created_at,updated_at,storage_generation,capacity_scope) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        policyId,
        "Raw recreation",
        1,
        createdAt,
        createdAt,
        "d".repeat(32),
        "anonymous-workspace-v1",
      ),
  );
  repository.close();
  repository = new SQLitePolicyRepository(databasePath);
  assert.throws(
    () =>
      repository.createProjectWithinCapacity(retiredProject, {
        idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
        maximumProjects: 1,
      }),
    (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_RETIRED",
  );
  const replacementPolicyId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}replacement`;
  repository.createProjectWithinCapacity(
    { ...retiredProject, id: replacementPolicyId, title: "Replacement anonymous project" },
    { idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX, maximumProjects: 1 },
  );
  const replacement = repository.getAnonymousWorkspaceProject(replacementPolicyId);
  assert.ok(replacement);
  assert.throws(() => {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("DELETE FROM policy_decisions WHERE policy_id = ?").run(replacementPolicyId);
      database.prepare("DELETE FROM policy_versions WHERE policy_id = ?").run(replacementPolicyId);
      database.prepare("DELETE FROM policy_projects WHERE id = ?").run(replacementPolicyId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  assert.equal(
    repository.getAnonymousWorkspaceProject(replacementPolicyId)?.storageGeneration,
    replacement.storageGeneration,
  );
  assert.ok(repository.getVersion(replacementPolicyId, 1));
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);
  database.exec("DROP TRIGGER policy_projects_generation_update_guard");
  database
    .prepare("UPDATE policy_projects SET storage_generation = ? WHERE id = ?")
    .run("corrupted", replacementPolicyId);
  assert.throws(
    () => repository.getAnonymousWorkspaceProject(replacementPolicyId),
    (error) => error instanceof PolicyPersistenceError && error.code === "CORRUPTED_STORAGE",
  );
});

test("migrates schema v2 databases to durable anonymous retirement", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-persistence-v2-migration-"));
  const databasePath = join(directory, "policytwin.sqlite");
  let database;
  let repository;
  testContext.after(async () => {
    repository?.close();
    database?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  repository = new SQLitePolicyRepository(databasePath);
  repository.close();
  repository = null;
  database = new DatabaseSync(databasePath);
  database.exec(`
    DROP TRIGGER policy_projects_retired_anonymous_insert_guard;
    DROP TRIGGER policy_projects_retired_anonymous_update_guard;
    DROP TRIGGER anonymous_workspace_tombstones_insert_guard;
    DROP TRIGGER policy_projects_anonymous_delete_guard;
    DROP TABLE anonymous_workspace_tombstones;
    CREATE TRIGGER policy_projects_anonymous_delete_guard
      BEFORE DELETE ON policy_projects
      WHEN OLD.capacity_scope = 'anonymous-workspace-v1'
        AND NOT EXISTS (
          SELECT 1 FROM policy_project_delete_authority
          WHERE policy_id = OLD.id
            AND storage_generation = OLD.storage_generation
        )
      BEGIN
        SELECT RAISE(ABORT, 'anonymous project delete authority required');
      END;
    PRAGMA user_version = 2;
  `);
  database.close();
  database = null;

  repository = new SQLitePolicyRepository(databasePath);
  database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);
  assert.ok(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'anonymous_workspace_tombstones'",
      )
      .get(),
  );
  database.close();
  database = null;

  const policyId = `${ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX}v2-migrated`;
  const input = {
    id: policyId,
    title: "Migrated anonymous project",
    sourceText: "Draft",
    goldenCases: [],
    createdAt: "2026-07-20T00:00:00.000Z",
  };
  repository.createProjectWithinCapacity(input, {
    idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
    maximumProjects: 1,
  });
  const project = repository.getAnonymousWorkspaceProject(policyId);
  assert.ok(project);
  assert.equal(
    repository.deleteAnonymousWorkspaceIfGeneration(
      policyId,
      project.storageGeneration,
      () => true,
    ),
    true,
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(
      () =>
        repository.createProjectWithinCapacity(input, {
          idPrefix: ANONYMOUS_WORKSPACE_POLICY_ID_PREFIX,
          maximumProjects: 1,
        }),
      (error) => error instanceof PolicyPersistenceError && error.code === "PROJECT_RETIRED",
    );
  }
});
