import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  compilePolicyToRego,
  generateAcceptedCaseCorpus,
  parsePolicyCases,
  resolvePolicyAmbiguity,
  runOpaCases,
} from "../../dist/index.js";

const ROOT = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
const recorded = JSON.parse(
  readFileSync(resolve(ROOT, "fixtures/interpreter/recorded-policy-ir.v1.json"), "utf8"),
);
const goldenCases = parsePolicyCases(
  JSON.parse(readFileSync(resolve(ROOT, "fixtures/refund-demo/cases/golden-cases.json"), "utf8")),
);
const driftCases = parsePolicyCases(
  JSON.parse(
    readFileSync(resolve(ROOT, "fixtures/refund-demo/cases/seeded-drift-cases.json"), "utf8"),
  ),
);
const opaPath = resolve(
  process.env.OPA_PATH ??
    resolve(ROOT, ".tools", "opa", contract.opaVersion, process.platform === "win32" ? "opa.exe" : "opa"),
);
const opaSha256 =
  process.platform === "win32"
    ? contract.opaWindowsSha256
    : contract.opaLinuxAmd64StaticSha256;

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

test("real OPA compiles Rego v1 and agrees with the accepted 41-case corpus", () => {
  assert.equal(existsSync(opaPath), true, `OPA binary missing at ${opaPath}`);
  const policy = acceptedPolicy();
  const compilation = compilePolicyToRego(policy);
  const cases = generateAcceptedCaseCorpus(policy, goldenCases, driftCases);
  assert.equal(cases.length, 41);
  const report = runOpaCases({
    executablePath: opaPath,
    expectedVersion: contract.opaVersion,
    expectedExecutableSha256: opaSha256,
    regoSource: compilation.source,
    query: compilation.manifest.query,
    cases,
  });
  assert.equal(report.executionMode, "OPA_CLI");
  assert.equal(report.opaVersion, "1.18.2");
  assert.equal(report.executableSha256, opaSha256);
  assert.equal(report.results.length, cases.length);
  for (const [index, result] of report.results.entries()) {
    assert.equal(result.caseId, cases[index].id);
    assert.equal(result.result.decision, cases[index].expectedDecision, result.caseId);
    assert.match(result.inputHash, /^[a-f0-9]{64}$/u);
  }
});

test("OPA runner rejects malformed policy, invalid input, and an unapproved query", () => {
  const validInput = goldenCases[0].input;
  assert.throws(
    () =>
      runOpaCases({
        executablePath: opaPath,
        expectedVersion: contract.opaVersion,
        expectedExecutableSha256: opaSha256,
        regoSource: "package policytwin.refund\nthis is not rego",
        query: "data.policytwin.refund.decision",
        cases: [{ id: "bad-policy", input: validInput }],
      }),
    /OPA exited/u,
  );
  assert.throws(
    () =>
      runOpaCases({
        executablePath: opaPath,
        expectedVersion: contract.opaVersion,
        expectedExecutableSha256: opaSha256,
        regoSource: compilePolicyToRego(acceptedPolicy()).source,
        query: "data.policytwin.refund.decision",
        cases: [{ id: "bad-input", input: { ...validInput, daysSincePurchase: -1 } }],
      }),
    /non-negative/u,
  );
  assert.throws(
    () =>
      runOpaCases({
        executablePath: opaPath,
        expectedVersion: contract.opaVersion,
        expectedExecutableSha256: opaSha256,
        regoSource: compilePolicyToRego(acceptedPolicy()).source,
        query: "data.policytwin.refund.other",
        cases: [{ id: "bad-query", input: validInput }],
      }),
    /outside the PolicyTwin/u,
  );
  assert.throws(
    () =>
      runOpaCases({
        executablePath: opaPath,
        expectedVersion: contract.opaVersion,
        expectedExecutableSha256: "0".repeat(64),
        regoSource: compilePolicyToRego(acceptedPolicy()).source,
        query: "data.policytwin.refund.decision",
        cases: [{ id: "bad-checksum", input: validInput }],
      }),
    /checksum mismatch/u,
  );
});
