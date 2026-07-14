import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [state, links, report, demoData, rules, claimAudit] = await Promise.all([
  "submission-state.json",
  "links.json",
  "submission-check-report.json",
].map((name) =>
  readFile(new URL(`../../artifacts/submission/${name}`, import.meta.url), "utf8").then(JSON.parse),
).concat([
  readFile(new URL("../../artifacts/demo/demo-data.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../../artifacts/submission/rules-check.md", import.meta.url), "utf8"),
  readFile(new URL("../../artifacts/submission/claim-audit.md", import.meta.url), "utf8"),
]));

test("submission draft remains non-final with no fabricated URLs or confirmation", () => {
  assert.equal(state.status, "NOT_READY");
  assert.equal(state.confirmation, null);
  assert.equal(Object.values(links).filter((value) => value === null).length, 4);
  assert.equal(report.status, "FAIL");
  assert.equal(report.failures.includes("Evidence package is not live verified PASS."), true);
  assert.equal(report.failures.includes("Official rules have not been verified."), false);
  assert.equal(report.failures.includes("Project LICENSE is absent."), true);
});

test("demo and claim drafts keep evaluation-only and live claims separate", () => {
  assert.equal(demoData.status, "DRAFT_NOT_RECORDED");
  assert.equal(demoData.postRepairDrift, null);
  assert.equal(demoData.evaluationOnlyFixedFixtureDrift, 0);
  assert.match(rules, /Status: VERIFIED_OFFICIAL_SOURCES/iu);
  assert.match(claimAudit, /Real local OPA 1\.18\.2 execution/iu);
  assert.match(claimAudit, /Never call post-repair/iu);
  assert.match(claimAudit, /Must not claim/iu);
});
