import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SEEDED_REFUND_CODE_MAPPINGS,
  analyzePolicyImpact,
  buildTraceabilityReport,
  createDaysThresholdVersion,
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
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
const snapshot = JSON.parse(
  await readFile(new URL("../snapshots/offline-m8-impact.json", import.meta.url)),
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

test("creates an immutable consecutive 14-to-30 policy version and regenerates boundaries", () => {
  const before = acceptedPolicy();
  const original = JSON.stringify(before);
  const after = createDaysThresholdVersion(before, 30, "2026-07-14T01:00:00.000Z");
  assert.equal(JSON.stringify(before), original);
  assert.equal(after.version, before.version + 1);
  assert.match(after.clauses[0].text, /30 calendar days/u);
  assert.equal(after.clauses[0].text.includes("14"), false);

  const previewCases = generateAcceptedCaseCorpus(after, []);
  for (const day of [29, 30, 31]) {
    assert.equal(previewCases.some((policyCase) => policyCase.input.daysSincePurchase === day), true);
  }
  assert.throws(
    () => generateAcceptedCaseCorpus(after, goldenCases),
    (error) => error.code === "GOLDEN_CONTRADICTION",
  );
});

test("impact report blocks verification when an authoritative golden expectation changes", () => {
  const before = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(before, goldenCases, driftCases);
  const after = createDaysThresholdVersion(before, 30, "2026-07-14T01:00:00.000Z");
  const report = analyzePolicyImpact(
    before,
    after,
    cases,
    goldenCases.map((policyCase) => policyCase.id),
    SEEDED_REFUND_CODE_MAPPINGS,
  );
  assert.equal(report.executionMode, "REFERENCE_EVALUATOR_NOT_OPA");
  assert.equal(report.verificationState, "BLOCKED_BY_GOLDEN_CONTRADICTION");
  assert.deepEqual(report.goldenContradictionCaseIds, ["G02"]);
  assert.deepEqual(report.regeneratedBoundaryValues, [29, 30, 31]);
  assert.deepEqual(
    report.changedRules.map((item) => item.ruleId),
    ["promotion-approved", "promotion-review", "refund-eligible"],
  );
  assert.equal(report.potentialCodeLocations.some((item) => item.id === "code-day-window"), true);
});

test("traceability covers every accepted clause, rule, case link, and seeded code mapping", () => {
  const policy = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  const report = buildTraceabilityReport(policy, cases, SEEDED_REFUND_CODE_MAPPINGS);
  assert.deepEqual(report.gaps, {
    uncoveredClauseIds: [],
    uncoveredRuleIds: [],
    invalidCaseLinks: [],
    unlinkedCodeLocationIds: [],
  });
  assert.equal(report.metrics.clausesCovered, report.metrics.clausesTotal);
  assert.equal(report.metrics.rulesCovered, report.metrics.rulesTotal);
  assert.equal(report.metrics.casesLinked, report.metrics.casesTotal);
  assert.throws(
    () =>
      buildTraceabilityReport(policy, cases, [
        ...SEEDED_REFUND_CODE_MAPPINGS,
        { id: "bad", file: "../escape.ts", lineStart: 1, lineEnd: 1, symbol: "bad", ruleIds: [] },
      ]),
    /trusted fixture/u,
  );
});

test("impact and traceability metrics match the reviewable M8 snapshot", () => {
  const before = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(before, goldenCases, driftCases);
  const after = createDaysThresholdVersion(before, 30, "2026-07-14T01:00:00.000Z");
  const impact = analyzePolicyImpact(
    before,
    after,
    cases,
    goldenCases.map((policyCase) => policyCase.id),
    SEEDED_REFUND_CODE_MAPPINGS,
  );
  const traceability = buildTraceabilityReport(before, cases, SEEDED_REFUND_CODE_MAPPINGS);
  assert.deepEqual(
    {
      executionMode: impact.executionMode,
      versions: [impact.fromVersion, impact.toVersion],
      threshold: [impact.change.from, impact.change.to],
      verificationState: impact.verificationState,
      changedClauseIds: impact.changedClauses.map((item) => item.clauseId),
      changedRuleIds: impact.changedRules.map((item) => item.ruleId),
      changedCaseIds: impact.changedCases.map((item) => item.caseId),
      goldenContradictionCaseIds: impact.goldenContradictionCaseIds,
      boundaryValues: impact.regeneratedBoundaryValues,
      potentialCodeLocationIds: impact.potentialCodeLocations.map((item) => item.id),
      traceability: traceability.metrics,
      gaps: traceability.gaps,
    },
    snapshot,
  );
});
