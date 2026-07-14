import { readFile } from "node:fs/promises";
import {
  compilePolicyToRego,
  resolvePolicyAmbiguity,
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
  policy = resolvePolicyAmbiguity(
    policy,
    ambiguityId,
    optionId,
    goldenCases,
    "2026-07-14T01:00:00.000Z",
  ).policy;
}

const result = compilePolicyToRego(policy);
if (process.argv.includes("--manifest")) {
  console.log(JSON.stringify(result.manifest, null, 2));
} else {
  process.stdout.write(result.source);
}
