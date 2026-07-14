import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(
  await readFile(new URL("../../schemas/codex-results.v1.schema.json", import.meta.url)),
);
const prompts = await Promise.all(
  ["cartographer", "repair", "reviewer"].map((name) =>
    readFile(new URL(`../../prompts/${name}.v1.md`, import.meta.url), "utf8"),
  ),
);
const snapshot = JSON.parse(
  await readFile(new URL("../../tests/snapshots/offline-m7-summary.json", import.meta.url)),
);

test("Codex worker schemas are closed at every executable result boundary", () => {
  for (const name of ["metadata", "location", "repairInput", "cartography", "repair", "finding", "review", "commandEvidence", "failure", "workerReport"]) {
    assert.equal(schema.$defs[name].additionalProperties, false, name);
  }
  assert.deepEqual(schema.$defs.executionMode.enum, ["OFFLINE_TEST_DOUBLE", "LIVE_CODEX_SDK"]);
  assert.deepEqual(schema.$defs.commandId.enum, ["fixture-typecheck", "fixture-test"]);
  assert.equal(schema.$defs.workerReport.properties.attempts.maximum, 2);
});

test("cartography, repair, and review prompts preserve the trusted-fixture boundary", () => {
  const [cartographer, repair, reviewer] = prompts;
  assert.match(cartographer, /read-only/iu);
  assert.match(cartographer, /expected-fixed/iu);
  assert.match(repair, /smallest coherent change/iu);
  assert.match(repair, /Do not weaken or skip tests/iu);
  assert.match(reviewer, /distinct run identity/iu);
  assert.match(reviewer, /HIGH.*CRITICAL.*BLOCK/isu);
  assert.equal(prompts.every((prompt) => /strict/iu.test(prompt)), true);
});

test("offline M7 snapshot cannot be mistaken for live Codex evidence", () => {
  assert.equal(snapshot.executionMode, "OFFLINE_TEST_DOUBLE");
  assert.equal(snapshot.liveCodexClaim, false);
  assert.equal(snapshot.status, "PASS");
  assert.equal(snapshot.attempts, 2);
  assert.deepEqual(snapshot.finalCommandIds, ["fixture-typecheck", "fixture-test"]);
  assert.equal(snapshot.reviewVerdict, "APPROVE");
});
