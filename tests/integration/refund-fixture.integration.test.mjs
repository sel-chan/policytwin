import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
