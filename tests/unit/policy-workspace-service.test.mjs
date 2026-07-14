import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PolicyResolutionError,
  PolicyWorkspaceService,
  PolicyWorkspaceServiceError,
} from "../../dist/index.js";
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

async function serviceFixture(testContext) {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-workspace-service-"));
  const repository = new SQLitePolicyRepository(join(directory, "policytwin.sqlite"));
  const service = new PolicyWorkspaceService(repository);
  testContext.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  const workspace = service.createProject({
    id: recorded.policyId,
    title: "Seeded refund policy",
    sourceText,
    goldenCases,
    policyIR: recorded,
    createdAt: "2026-07-14T04:00:00.000Z",
  });
  return { repository, service, workspace };
}

test("creates and reads a complete current workspace", async (testContext) => {
  const { service, workspace } = await serviceFixture(testContext);
  assert.equal(workspace.project.currentVersion, 1);
  assert.equal(workspace.currentVersion.policyIR.id, recorded.id);
  assert.equal(workspace.currentVersion.goldenCases.length, goldenCases.length);
  assert.deepEqual(workspace.decisionRecords, []);
  assert.deepEqual(service.getWorkspace(recorded.policyId), workspace);
});

test("creates an immutable DRAFT version while preserving golden cases", async (testContext) => {
  const { repository, service } = await serviceFixture(testContext);
  const changedText = sourceText.replace("14 calendar days", "30 calendar days");
  const workspace = service.createPolicyTextVersion({
    policyId: recorded.policyId,
    expectedVersion: 1,
    sourceText: changedText,
    createdAt: "2026-07-14T04:01:00.000Z",
  });
  assert.equal(workspace.project.currentVersion, 2);
  assert.equal(workspace.currentVersion.parentVersion, 1);
  assert.equal(workspace.currentVersion.state, "DRAFT");
  assert.equal(workspace.currentVersion.policyIR, null);
  assert.deepEqual(workspace.currentVersion.goldenCases, goldenCases);
  assert.equal(repository.getVersion(recorded.policyId, 1).sourceText, sourceText);

  const replayed = service.createPolicyTextVersion({
    policyId: recorded.policyId,
    expectedVersion: 1,
    sourceText: changedText,
    createdAt: "2026-07-14T04:02:00.000Z",
  });
  assert.equal(replayed.project.currentVersion, 2);
  assert.equal(replayed.currentVersion.createdAt, "2026-07-14T04:01:00.000Z");
});

test("resolves atomically, preserves idempotency, and blocks stale or contradictory choices", async (testContext) => {
  const { service } = await serviceFixture(testContext);
  const first = service.resolveAmbiguity({
    policyId: recorded.policyId,
    expectedVersion: 1,
    ambiguityId: "ambiguity-purchase-day-index",
    selectedOptionId: "purchase-day-zero",
    decidedAt: "2026-07-14T04:01:00.000Z",
  });
  assert.equal(first.idempotent, false);
  assert.equal(first.workspace.project.currentVersion, 2);
  assert.equal(first.workspace.decisionRecords.length, 1);

  const replayed = service.resolveAmbiguity({
    policyId: recorded.policyId,
    expectedVersion: 1,
    ambiguityId: "ambiguity-purchase-day-index",
    selectedOptionId: "purchase-day-zero",
    decidedAt: "2026-07-14T04:01:30.000Z",
  });
  assert.equal(replayed.idempotent, true);
  assert.equal(replayed.workspace.project.currentVersion, 2);
  assert.equal(replayed.decisionRecord.id, first.decisionRecord.id);

  const repeated = service.resolveAmbiguity({
    policyId: recorded.policyId,
    expectedVersion: 2,
    ambiguityId: "ambiguity-purchase-day-index",
    selectedOptionId: "purchase-day-zero",
    decidedAt: "2026-07-14T04:02:00.000Z",
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.workspace.project.currentVersion, 2);
  assert.equal(repeated.decisionRecord, null);

  assert.throws(
    () =>
      service.resolveAmbiguity({
        policyId: recorded.policyId,
        expectedVersion: 1,
        ambiguityId: "ambiguity-usage-measurement-time",
        selectedOptionId: "usage-at-request",
      }),
    (error) => error instanceof PolicyWorkspaceServiceError && error.code === "STALE_VERSION",
  );
  assert.throws(
    () =>
      service.resolveAmbiguity({
        policyId: recorded.policyId,
        expectedVersion: 2,
        ambiguityId: "ambiguity-default-decision",
        selectedOptionId: "default-review",
        decidedAt: "2026-07-14T04:03:00.000Z",
      }),
    (error) => error instanceof PolicyResolutionError && error.code === "GOLDEN_CONTRADICTION",
  );
  assert.equal(service.getWorkspace(recorded.policyId).project.currentVersion, 2);
});
