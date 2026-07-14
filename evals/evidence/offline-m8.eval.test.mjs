import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(
  await readFile(new URL("../../schemas/verification-summary.v1.schema.json", import.meta.url)),
);
const summary = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/verification-summary.json", import.meta.url)),
);
const impact = JSON.parse(
  await readFile(new URL("../../artifacts/evidence/impact-report.json", import.meta.url)),
);

test("verification summary schema is closed and exposes every external gate", () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.mutation.additionalProperties, false);
  assert.equal(schema.properties.traceability.additionalProperties, false);
  assert.equal(schema.properties.security.additionalProperties, false);
  assert.equal(schema.properties.externalGates.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.externalGates.properties), [
    "gpt56",
    "opa",
    "codex",
    "browser",
    "container",
    "deployment",
  ]);
});

test("partial offline proof is FAIL and keeps evaluation-only results separate", () => {
  assert.equal(summary.status, "FAIL");
  assert.equal(summary.evidenceMode, "PARTIAL_OFFLINE");
  assert.equal(summary.driftAfter, null);
  assert.equal(summary.evaluationOnlyFixedFixtureDrift, 0);
  assert.equal(summary.mutation.executionMode, "REFERENCE_EVALUATOR_NOT_OPA");
  assert.equal(summary.security.status, "NOT_RUN");
  assert.equal(impact.verificationState, "BLOCKED_BY_GOLDEN_CONTRADICTION");
  assert.deepEqual(impact.goldenContradictionCaseIds, ["G02"]);
});
