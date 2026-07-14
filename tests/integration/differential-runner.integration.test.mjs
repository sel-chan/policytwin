import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
  runDifferentialCases,
} from "../../dist/index.js";
import * as baseline from "../../.tmp/fixture-build/baseline/src/refund.js";
import * as fixed from "../../.tmp/fixture-build/expected-fixed/src/refund.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const driftCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url)),
);
const summarySnapshot = JSON.parse(
  await readFile(new URL("../snapshots/offline-m6-summary.json", import.meta.url)),
);
let policy = recorded;
for (const [ambiguityId, optionId] of [
  ["ambiguity-purchase-day-index", "purchase-day-zero"],
  ["ambiguity-usage-measurement-time", "usage-at-request"],
  ["ambiguity-default-decision", "default-deny"],
]) {
  policy = resolvePolicyAmbiguity(policy, ambiguityId, optionId, goldenCases).policy;
}
const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);

test("buggy fixture exposes D01-D03 and classifies every observed defect", () => {
  const report = runDifferentialCases(policy, cases, "fixture-baseline", baseline.decideRefund);
  assert.equal(report.executionMode, "REFERENCE_EXPECTATION_NOT_OPA");
  assert.equal(report.errors, 0);
  for (const caseId of ["D01", "D02", "D03"]) {
    assert.equal(report.records.find((record) => record.caseId === caseId).status, "DRIFT");
  }
  assert.deepEqual(report.defectClusters.map((cluster) => cluster.defectId), [
    "DAY_14_INCLUSIVE",
    "USAGE_2000_INCLUSIVE",
    "FINAL_SALE_PRECEDENCE",
    "PROMOTION_ELIGIBILITY_BYPASS",
  ]);
  assert.equal(report.defectClusters.some((cluster) => cluster.defectId === "UNCLASSIFIED"), false);
});

test("expected-fixed fixture reaches zero drift and zero execution errors", () => {
  const report = runDifferentialCases(policy, cases, "fixture-expected-fixed", fixed.decideRefund);
  assert.equal(report.total, cases.length);
  assert.equal(report.matches, cases.length);
  assert.equal(report.drifts, 0);
  assert.equal(report.errors, 0);
  assert.deepEqual(report.defectClusters, []);
});

test("application exceptions and malformed decisions are ERROR, never MATCH or DRIFT", () => {
  const throwing = runDifferentialCases(policy, cases.slice(0, 2), "throwing-adapter", () => {
    throw new Error("fixture exploded");
  });
  assert.equal(throwing.errors, 2);
  assert.equal(throwing.matches, 0);
  assert.equal(throwing.drifts, 0);
  assert.equal(throwing.records.every((record) => record.error === "fixture exploded"), true);

  const malformed = runDifferentialCases(policy, cases.slice(0, 1), "malformed-adapter", () => ({
    decision: "APPROVE",
  }));
  assert.equal(malformed.errors, 1);
  assert.match(malformed.records[0].error, /invalid decision/u);
});

test("before and after summaries match the reviewable M6 snapshot", () => {
  const before = runDifferentialCases(policy, cases, "fixture-baseline", baseline.decideRefund);
  const after = runDifferentialCases(policy, cases, "fixture-expected-fixed", fixed.decideRefund);
  assert.deepEqual(
    {
      executionMode: before.executionMode,
      caseCount: cases.length,
      before: {
        matches: before.matches,
        drifts: before.drifts,
        errors: before.errors,
        clusters: before.defectClusters,
        seededWitnesses: before.records
          .filter((record) => ["D01", "D02", "D03"].includes(record.caseId))
          .map((record) => ({
            caseId: record.caseId,
            expected: record.expected.decision,
            actual: record.actual?.decision ?? null,
            status: record.status,
            defectIds: record.defectIds,
          })),
      },
      after: { matches: after.matches, drifts: after.drifts, errors: after.errors },
    },
    summarySnapshot,
  );
});
