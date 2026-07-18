import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";
import { compileCurrentFixture, resetFixture } from "./fixture.mjs";

resetFixture();
compileCurrentFixture();

const cases = JSON.parse(
  await readFile(resolve(ROOT, "fixtures", "refund-demo", "cases", "seeded-drift-cases.json"), "utf8"),
);
const { decideRefund } = await import("../.tmp/refund-demo/current-dist/refund.js");
const results = cases.map((policyCase) => {
  const actualDecision = decideRefund(policyCase.input);
  return {
    caseId: policyCase.id,
    expectedDecision: policyCase.expectedDecision,
    actualDecision,
    status: actualDecision === policyCase.expectedDecision ? "MATCH" : "DRIFT",
  };
});
const driftCount = results.filter((result) => result.status === "DRIFT").length;

await writeFile(
  resolve(ROOT, ".tmp", "refund-demo", "last-run.json"),
  `${JSON.stringify({ driftCount, results }, null, 2)}\n`,
  "utf8",
);

if (driftCount !== 3 || results.length !== 3) {
  console.error(JSON.stringify({ driftCount, results }, null, 2));
  console.error("Seeded demo must reproduce exactly three required drifts.");
  process.exit(1);
}

console.log(JSON.stringify({ driftCount, results }, null, 2));
