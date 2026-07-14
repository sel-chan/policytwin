import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { resolvePolicyAmbiguity } from "../../dist/index.js";
import {
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
