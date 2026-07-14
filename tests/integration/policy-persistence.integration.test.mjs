import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolvePolicyAmbiguity } from "../../dist/index.js";
import { SQLitePolicyRepository } from "../../dist/persistence/sqlite.js";

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

test("restores policy text, cases, versions, decisions, and state after process-style reopen", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-persistence-integration-"));
  const databasePath = join(directory, "policytwin.sqlite");
  let repository = new SQLitePolicyRepository(databasePath);
  repository.createProject({
    id: recorded.policyId,
    title: "Seeded refund policy",
    sourceText,
    goldenCases,
    policyIR: recorded,
    createdAt: "2026-07-14T03:00:00.000Z",
  });

  let policy = recorded;
  const choices = [
    ["ambiguity-purchase-day-index", "purchase-day-zero"],
    ["ambiguity-usage-measurement-time", "usage-at-request"],
    ["ambiguity-default-decision", "default-deny"],
  ];
  for (const [index, [ambiguityId, optionId]] of choices.entries()) {
    const decidedAt = `2026-07-14T03:0${index + 1}:00.000Z`;
    const resolution = resolvePolicyAmbiguity(
      policy,
      ambiguityId,
      optionId,
      goldenCases,
      decidedAt,
    );
    repository.appendVersion({
      policyId: recorded.policyId,
      expectedParentVersion: policy.version,
      sourceText,
      goldenCases,
      policyIR: resolution.policy,
      decisionRecord: resolution.decisionRecord,
      createdAt: decidedAt,
    });
    policy = resolution.policy;
  }
  repository.transitionState(
    recorded.policyId,
    4,
    "READY_TO_COMPILE",
    "COMPILED",
    "2026-07-14T03:04:00.000Z",
  );
  repository.close();

  repository = new SQLitePolicyRepository(databasePath);
  testContext.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  const project = repository.getProject(recorded.policyId);
  const versions = repository.listVersions(recorded.policyId);
  const decisions = repository.listDecisionRecords(recorded.policyId);
  assert.equal(project.currentVersion, 4);
  assert.equal(project.updatedAt, "2026-07-14T03:04:00.000Z");
  assert.deepEqual(versions.map((item) => item.version), [1, 2, 3, 4]);
  assert.deepEqual(versions.map((item) => item.parentVersion), [null, 1, 2, 3]);
  assert.equal(versions.every((item) => item.sourceText === sourceText), true);
  assert.equal(versions.every((item) => item.goldenCases.length === goldenCases.length), true);
  assert.equal(versions[0].policyIR.ambiguities.every((item) => item.status === "OPEN"), true);
  assert.equal(versions[3].policyIR.ambiguities.every((item) => item.status === "RESOLVED"), true);
  assert.equal(versions[3].state, "COMPILED");
  assert.deepEqual(decisions.map((item) => item.toVersion), [2, 3, 4]);
  assert.deepEqual(decisions.map((item) => item.selectedOptionId), [
    "purchase-day-zero",
    "usage-at-request",
    "default-deny",
  ]);
});
