import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findMinimalContrasts,
  findRuleConflictWitnesses,
  generateAcceptedCaseCorpus,
  generatePolicyMutants,
  resolvePolicyAmbiguity,
  runOfflineMutationSuite,
} from "../../dist/index.js";

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
  await readFile(new URL("../snapshots/offline-m5-summary.json", import.meta.url)),
);

function acceptedPolicy() {
  let policy = structuredClone(recorded);
  for (const [ambiguityId, optionId] of [
    ["ambiguity-purchase-day-index", "purchase-day-zero"],
    ["ambiguity-usage-measurement-time", "usage-at-request"],
    ["ambiguity-default-decision", "default-deny"],
  ]) {
    policy = resolvePolicyAmbiguity(policy, ambiguityId, optionId, goldenCases).policy;
  }
  return policy;
}

test("executes real mutants and exceeds the 90 percent offline reference threshold", () => {
  const policy = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  const report = runOfflineMutationSuite(policy, cases);
  assert.equal(report.executionMode, "REFERENCE_EVALUATOR_NOT_OPA");
  assert.equal(report.total > 0, true);
  assert.equal(report.killed <= report.total, true);
  assert.equal(report.killRate >= 0.9, true, JSON.stringify(report.survivors, null, 2));
  assert.equal(report.results.every((result) => result.killed === (result.witnessCaseIds.length > 0)), true);
  assert.equal(report.survivors.every((result) => result.witnessCaseIds.length === 0), true);
});

test("covers every required seeded mutation operator and supports gte to gt generically", () => {
  const policy = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  const report = runOfflineMutationSuite(policy, cases);
  for (const operator of [
    "LTE_TO_LT",
    "AND_TO_OR",
    "PREDICATE_DELETE",
    "BOOLEAN_INVERT",
    "THRESHOLD_MINUS_ONE",
    "THRESHOLD_PLUS_ONE",
    "PRIORITY_SWAP",
    "RULE_DELETE",
    "DEFAULT_CHANGE",
  ]) {
    assert.equal(report.operatorCounts[operator] > 0, true, operator);
  }

  const gtePolicy = structuredClone(policy);
  gtePolicy.rules.find((rule) => rule.id === "refund-eligible").when.children[0].operator = "gte";
  assert.equal(
    generatePolicyMutants(gtePolicy, cases).some((mutant) => mutant.operator === "GTE_TO_GT"),
    true,
  );
});

test("does not mutate the accepted source policy while generating mutants", () => {
  const policy = acceptedPolicy();
  const before = JSON.stringify(policy);
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  generatePolicyMutants(policy, cases);
  assert.equal(JSON.stringify(policy), before);
});

test("matches the reviewable offline M5 score snapshot", () => {
  const policy = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  const report = runOfflineMutationSuite(policy, cases);
  const sourceCounts = Object.fromEntries(
    [...new Set(cases.map((item) => item.source))]
      .sort()
      .map((source) => [source, cases.filter((item) => item.source === source).length]),
  );
  assert.deepEqual(
    {
      executionMode: report.executionMode,
      caseCount: cases.length,
      sourceCounts,
      conflictCount: findRuleConflictWitnesses(policy, cases).length,
      contrastCount: findMinimalContrasts(cases).length,
      mutation: {
        killed: report.killed,
        total: report.total,
        killRate: report.killRate,
        survivorCount: report.survivors.length,
        survivorIds: report.survivors.map((item) => item.mutantId),
        operatorCounts: report.operatorCounts,
      },
    },
    summarySnapshot,
  );
});
