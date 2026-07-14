import { readFile } from "node:fs/promises";
import {
  SEEDED_REFUND_CODE_MAPPINGS,
  analyzePolicyImpact,
  buildTraceabilityReport,
  createDaysThresholdVersion,
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
} from "../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const driftCases = JSON.parse(
  await readFile(new URL("../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url)),
);
let before = recorded;
for (const [ambiguityId, optionId] of [
  ["ambiguity-purchase-day-index", "purchase-day-zero"],
  ["ambiguity-usage-measurement-time", "usage-at-request"],
  ["ambiguity-default-decision", "default-deny"],
]) {
  before = resolvePolicyAmbiguity(before, ambiguityId, optionId, goldenCases).policy;
}
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
console.log(
  JSON.stringify(
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
    null,
    2,
  ),
);
