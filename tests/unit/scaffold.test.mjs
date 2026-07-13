import assert from "node:assert/strict";
import test from "node:test";
import { DECISIONS, PROJECT_NAME, isDecision } from "../../dist/index.js";

test("exports the PolicyTwin identity and closed MVP decisions", () => {
  assert.equal(PROJECT_NAME, "PolicyTwin");
  assert.deepEqual(DECISIONS, ["ALLOW", "DENY", "REVIEW"]);
  assert.equal(isDecision("ALLOW"), true);
  assert.equal(isDecision("APPROVE"), false);
  assert.equal(isDecision(null), false);
});
