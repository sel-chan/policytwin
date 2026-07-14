import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const caseSchema = JSON.parse(
  await readFile(new URL("../../schemas/cases.v1.schema.json", import.meta.url)),
);
const mutationSchema = JSON.parse(
  await readFile(new URL("../../schemas/mutation-report.v1.schema.json", import.meta.url)),
);
const summary = JSON.parse(
  await readFile(new URL("../../tests/snapshots/offline-m5-summary.json", import.meta.url)),
);

test("case and mutation contracts are strict and versioned", () => {
  assert.equal(caseSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(caseSchema.$defs.policyCase.additionalProperties, false);
  assert.equal(caseSchema.$defs.refundInput.additionalProperties, false);
  assert.equal(mutationSchema.additionalProperties, false);
  assert.equal(mutationSchema.$defs.result.additionalProperties, false);
});

test("offline M5 snapshot clears quantitative gates without claiming OPA", () => {
  assert.equal(summary.executionMode, "REFERENCE_EVALUATOR_NOT_OPA");
  assert.equal(summary.caseCount >= 30, true);
  assert.equal(summary.mutation.killRate >= 0.9, true);
  assert.equal(summary.mutation.killed + summary.mutation.survivorCount, summary.mutation.total);
  assert.equal(summary.mutation.survivorIds.length, summary.mutation.survivorCount);
});
