import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(
  await readFile(new URL("../../schemas/differential-report.v1.schema.json", import.meta.url)),
);
const summary = JSON.parse(
  await readFile(new URL("../../tests/snapshots/offline-m6-summary.json", import.meta.url)),
);

test("differential contract separates match, drift, and execution error", () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.$defs.record.properties.status.enum, ["MATCH", "DRIFT", "ERROR"]);
  assert.equal(schema.$defs.record.additionalProperties, false);
  assert.equal(schema.$defs.input.additionalProperties, false);
  assert.equal(schema.$defs.expected.additionalProperties, false);
  assert.equal(schema.$defs.actual.additionalProperties, false);
  assert.equal(schema.$defs.cluster.additionalProperties, false);
});

test("offline M6 snapshot proves seeded witnesses and zero fixed-reference drift", () => {
  assert.equal(summary.executionMode, "REFERENCE_EXPECTATION_NOT_OPA");
  assert.deepEqual(summary.before.seededWitnesses.map((item) => item.caseId), ["D01", "D02", "D03"]);
  assert.equal(summary.before.seededWitnesses.every((item) => item.status === "DRIFT"), true);
  assert.equal(summary.before.clusters.some((item) => item.defectId === "UNCLASSIFIED"), false);
  assert.equal(summary.after.matches, summary.caseCount);
  assert.equal(summary.after.drifts, 0);
  assert.equal(summary.after.errors, 0);
});
