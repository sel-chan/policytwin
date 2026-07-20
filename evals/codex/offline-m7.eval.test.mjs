import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(
  await readFile(new URL("../../schemas/codex-results.v1.schema.json", import.meta.url)),
);
const prompts = await Promise.all(
  ["cartographer", "repair", "repair-report", "reviewer"].map((name) =>
    readFile(new URL(`../../prompts/${name}.v1.md`, import.meta.url), "utf8"),
  ),
);
const snapshot = JSON.parse(
  await readFile(new URL("../../tests/snapshots/offline-m7-summary.json", import.meta.url)),
);
const [rpcContract, rpcClient, sdkAdapter] = await Promise.all([
  "worker-rpc-contract.ts",
  "worker-rpc-client.ts",
  "sdk-adapter.ts",
].map((name) => readFile(new URL(`../../src/codex/${name}`, import.meta.url), "utf8")));

test("Codex worker schemas are closed at every executable result boundary", () => {
  for (const name of ["refundInput", "driftWitness", "metadata", "location", "repairInput", "cartography", "repair", "finding", "review", "commandResult", "commandEvidence", "policyVerificationCaseResult", "policyVerification", "failure", "workerReport"]) {
    assert.equal(schema.$defs[name].additionalProperties, false, name);
  }
  assert.deepEqual(schema.$defs.executionMode.enum, ["OFFLINE_TEST_DOUBLE", "LIVE_CODEX_SDK"]);
  assert.deepEqual(schema.$defs.commandId.enum, ["fixture-typecheck", "fixture-test"]);
  assert.equal(schema.$defs.workerReport.properties.attempts.maximum, 2);
  assert.equal(schema.$defs.repairInput.properties.acceptedCases.minItems, 41);
  assert.equal(schema.$defs.repairInput.properties.acceptedCases.maxItems, 41);
  assert.equal(schema.$defs.policyVerification.required.includes("repairRunId"), true);
  assert.equal(schema.$defs.workerReport.required.includes("policyVerificationAttempts"), true);
});

test("cartography, repair execution, repair reporting, and review prompts preserve the trusted-fixture boundary", () => {
  const [cartographer, repair, repairReport, reviewer] = prompts;
  assert.match(cartographer, /read-only/iu);
  assert.match(cartographer, /expected-fixed/iu);
  assert.match(repair, /smallest coherent change/iu);
  assert.match(repair, /Do not weaken or skip tests/iu);
  assert.match(repair, /Do not output the structured repair report in this turn/iu);
  assert.match(repairReport, /must not modify any file/iu);
  assert.match(repairReport, /strict repair model-output body/iu);
  assert.match(reviewer, /distinct run identity/iu);
  assert.match(reviewer, /HIGH.*CRITICAL.*BLOCK/isu);
  assert.equal(prompts.every((prompt) => /strict/iu.test(prompt)), true);
});

test("offline M7 snapshot cannot be mistaken for live Codex evidence", () => {
  assert.equal(snapshot.executionMode, "OFFLINE_TEST_DOUBLE");
  assert.equal(snapshot.liveCodexClaim, false);
  assert.equal(snapshot.status, "PASS");
  assert.equal(snapshot.attempts, 2);
  assert.equal(snapshot.commandEvidenceAttemptCount, 2);
  assert.equal(snapshot.retainedFailedCommandCount, 1);
  assert.deepEqual(snapshot.finalCommandIds, ["fixture-typecheck", "fixture-test"]);
  assert.equal(snapshot.policyVerificationAttemptCount, 1);
  assert.equal(snapshot.policyVerificationStatus, "PASS");
  assert.equal(snapshot.policyVerificationTotal, 41);
  assert.equal(snapshot.reviewVerdict, "APPROVE");
});

test("external worker RPC keeps authentication as a transport precondition rather than a host live path", () => {
  assert.match(rpcContract, /PolicyTwin-External-Worker-RPC-v1/u);
  assert.match(rpcContract, /processTreeReaped: true/u);
  assert.match(rpcContract, /IMMUTABLE_RECONSTRUCTED/u);
  assert.match(rpcClient, /MUTUAL_TLS.*LOCAL_SOCKET_ACL/su);
  assert.match(rpcClient, /Ed25519/u);
  assert.match(rpcClient, /one active run/u);
  assert.match(sdkAdapter, /Live Codex SDK construction is disabled in the host process/u);
});
