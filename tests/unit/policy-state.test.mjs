import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PolicyStateTransitionError,
  assertPolicyReadyToCompile,
  canTransitionPolicyState,
  parsePolicyIR,
  stateForPolicyCandidate,
  transitionPolicyState,
} from "../../dist/index.js";

const recorded = parsePolicyIR(
  JSON.parse(
    await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
  ),
);

test("derives decision state and blocks compilation while ambiguity remains", () => {
  assert.equal(stateForPolicyCandidate(recorded), "NEEDS_DECISION");
  assert.throws(() => assertPolicyReadyToCompile(recorded), PolicyStateTransitionError);

  const resolved = structuredClone(recorded);
  resolved.ambiguities.forEach((ambiguity) => {
    ambiguity.status = "RESOLVED";
    ambiguity.selectedOptionId = ambiguity.options[0].id;
  });
  assert.equal(stateForPolicyCandidate(resolved), "READY_TO_COMPILE");
  assert.doesNotThrow(() => assertPolicyReadyToCompile(resolved));
});

test("allows defined server transitions and rejects skipped gates", () => {
  assert.equal(canTransitionPolicyState("DRAFT", "INTERPRETING"), true);
  assert.equal(transitionPolicyState("INTERPRETING", "NEEDS_DECISION"), "NEEDS_DECISION");
  assert.equal(transitionPolicyState("READY_TO_COMPILE", "COMPILED"), "COMPILED");
  assert.equal(transitionPolicyState("VERIFYING", "VERIFIED"), "VERIFIED");
  assert.equal(canTransitionPolicyState("DRAFT", "VERIFIED"), false);
  assert.throws(
    () => transitionPolicyState("NEEDS_DECISION", "VERIFIED"),
    PolicyStateTransitionError,
  );
});

test("failure states have bounded recovery paths", () => {
  assert.equal(transitionPolicyState("INTERPRETATION_FAILED", "INTERPRETING"), "INTERPRETING");
  assert.equal(transitionPolicyState("COMPILATION_FAILED", "READY_TO_COMPILE"), "READY_TO_COMPILE");
  assert.equal(transitionPolicyState("REPAIR_FAILED", "REPAIRING"), "REPAIRING");
  assert.equal(transitionPolicyState("VERIFICATION_FAILED", "VERIFYING"), "VERIFYING");
});
