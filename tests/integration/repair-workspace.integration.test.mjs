import assert from "node:assert/strict";
import { appendFile, access } from "node:fs/promises";
import test from "node:test";
import {
  assertCanonicalFixtureUnchanged,
  createRepairWorkspace,
  getRepairWorkspacePaths,
  removeRepairWorkspace,
} from "../../scripts/repair-workspace.mjs";
import { buildSanitizedEnvironment, runRepairCommand } from "../../scripts/repair-command.mjs";
import { directoryHash } from "../../scripts/fixture.mjs";

const runId = `offline-contract-${process.pid}`;

test("fresh repair workspace is baseline-identical, isolated, and disposable", async () => {
  const stale = getRepairWorkspacePaths(runId);
  removeRepairWorkspace(runId);
  const workspace = createRepairWorkspace(runId);
  try {
    assert.equal(workspace.baselineHashBefore, workspace.workspaceHashAtCreation);
    await assert.rejects(access(`${workspace.fixtureRoot}/expected-fixed/src/refund.ts`));
    await appendFile(`${workspace.fixtureRoot}/src/refund.ts`, "\n// temporary repair probe\n", "utf8");
    assert.notEqual(directoryHash(workspace.fixtureRoot), workspace.baselineHashBefore);
    assert.equal(assertCanonicalFixtureUnchanged(workspace.baselineHashBefore), workspace.baselineHashBefore);
    assert.throws(() => createRepairWorkspace(runId), /already exists/u);
  } finally {
    removeRepairWorkspace(runId);
  }
  await assert.rejects(access(stale.runRoot));
});

test("workspace IDs and command working directories cannot escape the managed root", () => {
  for (const value of ["../escape", "a/b", "C:\\escape", "", "a".repeat(65)]) {
    assert.throws(() => getRepairWorkspacePaths(value));
  }
  assert.throws(() => runRepairCommand(process.cwd(), "fixture-test"), /not a managed fixture/u);
});

test("sanitized command environment excludes model credentials and fixture tests pass", () => {
  const environment = buildSanitizedEnvironment({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    OPENAI_API_KEY: "must-not-pass",
    CODEX_API_KEY: "must-not-pass",
  });
  assert.equal("OPENAI_API_KEY" in environment, false);
  assert.equal("CODEX_API_KEY" in environment, false);

  const commandRunId = `${runId}-command`;
  removeRepairWorkspace(commandRunId);
  const workspace = createRepairWorkspace(commandRunId);
  try {
    const evidence = runRepairCommand(workspace.fixtureRoot, "fixture-test");
    assert.equal(evidence.commandId, "fixture-test");
    assert.equal(evidence.timedOut, false);
    assert.equal(evidence.exitCode, 0, evidence.stderr);
    assert.equal(evidence.stdout.includes("must-not-pass"), false);
  } finally {
    assertCanonicalFixtureUnchanged(workspace.baselineHashBefore);
    removeRepairWorkspace(commandRunId);
  }
});
