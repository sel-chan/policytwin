import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseRefundPolicyInput } from "../../dist/index.js";
import {
  BASELINE_FIXTURE,
  CURRENT_BUILD,
  CURRENT_FIXTURE,
  compileCurrentFixture,
  directoryHash,
  resetFixture,
} from "../../scripts/fixture.mjs";

const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const driftCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url)),
);
const baselineModule = await import("../../.tmp/fixture-build/baseline/src/refund.js");
const fixedModule = await import("../../.tmp/fixture-build/expected-fixed/src/refund.js");

test("golden and seeded cases contain strict valid refund inputs", () => {
  for (const policyCase of [...goldenCases, ...driftCases]) {
    assert.deepEqual(parseRefundPolicyInput(policyCase.input), policyCase.input);
  }
});

test("expected-fixed fixture satisfies all golden and seeded cases", () => {
  for (const policyCase of [...goldenCases, ...driftCases]) {
    assert.equal(fixedModule.decideRefund(policyCase.input), policyCase.expectedDecision, policyCase.id);
  }
});

test("canonical buggy fixture exposes exactly the three seeded drifts", () => {
  const drifts = driftCases.filter(
    (policyCase) => baselineModule.decideRefund(policyCase.input) !== policyCase.expectedDecision,
  );
  assert.deepEqual(
    drifts.map((policyCase) => policyCase.id),
    ["D01", "D02", "D03"],
  );
});

test("reset is deterministic, preserves the baseline, and reproduces three drifts", async () => {
  const baselineBefore = directoryHash(BASELINE_FIXTURE);
  const firstReset = resetFixture();
  const secondReset = resetFixture();
  assert.equal(firstReset.baselineHash, baselineBefore);
  assert.equal(secondReset.currentHash, baselineBefore);
  assert.equal(directoryHash(CURRENT_FIXTURE), baselineBefore);
  assert.equal(directoryHash(BASELINE_FIXTURE), baselineBefore);
  assert.equal(existsSync(resolve(CURRENT_FIXTURE, "dist")), false);

  compileCurrentFixture();
  const moduleUrl = pathToFileURL(`${CURRENT_BUILD}/refund.js`);
  moduleUrl.searchParams.set("test", String(Date.now()));
  const currentModule = await import(moduleUrl.href);
  const drifts = driftCases.filter(
    (policyCase) => currentModule.decideRefund(policyCase.input) !== policyCase.expectedDecision,
  );
  assert.equal(drifts.length, 3);
});

test("demo reset refuses to delete a configured custom SQLite path", async (testContext) => {
  const directory = await mkdtemp(join(tmpdir(), "policytwin-reset-guard-"));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  const customDatabasePath = join(directory, "custom.sqlite");
  await writeFile(customDatabasePath, "owner-data", "utf8");
  // Security-reviewed test boundary: the executable and script are fixed,
  // and the generated path is passed only as an environment value.
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../scripts/demo-reset.mjs", import.meta.url))],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, POLICYTWIN_DATABASE_PATH: customDatabasePath },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /refuses to delete a custom/u);
  assert.equal(await readFile(customDatabasePath, "utf8"), "owner-data");
});
