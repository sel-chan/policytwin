import { readFile } from "node:fs/promises";
import {
  findMinimalContrasts,
  findRuleConflictWitnesses,
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
  runOfflineMutationSuite,
} from "../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
let policy = recorded;
for (const [ambiguityId, optionId] of [
  ["ambiguity-purchase-day-index", "purchase-day-zero"],
  ["ambiguity-usage-measurement-time", "usage-at-request"],
  ["ambiguity-default-decision", "default-deny"],
]) {
  policy = resolvePolicyAmbiguity(policy, ambiguityId, optionId, goldenCases).policy;
}

const cases = generateAcceptedCaseCorpus(policy, goldenCases);
const conflicts = findRuleConflictWitnesses(policy, cases);
const contrasts = findMinimalContrasts(cases);
const mutation = runOfflineMutationSuite(policy, cases);
console.log(
  JSON.stringify(
    {
      executionMode: mutation.executionMode,
      caseCount: cases.length,
      sourceCounts: Object.fromEntries(
        [...new Set(cases.map((item) => item.source))]
          .sort()
          .map((source) => [source, cases.filter((item) => item.source === source).length]),
      ),
      conflictCount: conflicts.length,
      contrastCount: contrasts.length,
      mutation: {
        killed: mutation.killed,
        total: mutation.total,
        killRate: mutation.killRate,
        survivorCount: mutation.survivors.length,
        survivors: mutation.survivors,
        operatorCounts: mutation.operatorCounts,
      },
    },
    null,
    2,
  ),
);
