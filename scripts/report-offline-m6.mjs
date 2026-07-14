import { readFile } from "node:fs/promises";
import {
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
  runDifferentialCases,
} from "../dist/index.js";

await import("./build-fixtures.mjs");
const baseline = await import("../.tmp/fixture-build/baseline/src/refund.js");
const fixed = await import("../.tmp/fixture-build/expected-fixed/src/refund.js");
const recorded = JSON.parse(
  await readFile(new URL("../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const driftCases = JSON.parse(
  await readFile(new URL("../fixtures/refund-demo/cases/seeded-drift-cases.json", import.meta.url)),
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
const before = runDifferentialCases(policy, cases, "fixture-baseline", baseline.decideRefund);
const after = runDifferentialCases(policy, cases, "fixture-expected-fixed", fixed.decideRefund);
console.log(
  JSON.stringify(
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
      after: {
        matches: after.matches,
        drifts: after.drifts,
        errors: after.errors,
      },
    },
    null,
    2,
  ),
);
