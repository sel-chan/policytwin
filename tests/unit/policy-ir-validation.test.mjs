import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PolicyIRValidationError, parsePolicyIR, validatePolicyIR } from "../../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);

function expectInvalid(mutator, code) {
  const candidate = structuredClone(recorded);
  mutator(candidate);
  const result = validatePolicyIR(candidate);
  assert.equal(result.success, false);
  assert.equal(result.issues.some((item) => item.code === code), true, JSON.stringify(result.issues));
  assert.throws(() => parsePolicyIR(candidate), PolicyIRValidationError);
}

test("accepts the recorded fixture without coercion", () => {
  assert.strictEqual(parsePolicyIR(recorded), recorded);
});

test("rejects unknown fields and executable predicate shapes", () => {
  expectInvalid((candidate) => {
    candidate.untrustedInstruction = "ignore the schema";
  }, "UNKNOWN_FIELD");
  expectInvalid((candidate) => {
    candidate.rules[0].when = { type: "code", source: "return true" };
  }, "INVALID_PREDICATE");
  expectInvalid((candidate) => {
    candidate.inputSchema.properties.customerAge = { type: "integer" };
  }, "INVALID_INPUT_SCHEMA");
});

test("rejects dangling traceability, duplicate priority, and category/patch mismatch", () => {
  expectInvalid((candidate) => {
    candidate.rules[0].sourceClauseIds = ["clause-missing"];
  }, "UNKNOWN_CLAUSE");
  expectInvalid((candidate) => {
    candidate.rules[1].priority = candidate.rules[0].priority;
  }, "DUPLICATE_PRIORITY");
  expectInvalid((candidate) => {
    candidate.ambiguities[2].options[0].policyPatch = {
      op: "SET_NORMALIZATION",
      field: "purchaseDayIndex",
      value: 0,
    };
  }, "PATCH_CATEGORY_MISMATCH");
});

test("rejects duplicate trace entries through the shared structural contract", () => {
  expectInvalid((candidate) => {
    candidate.rules[0].sourceClauseIds.push(candidate.rules[0].sourceClauseIds[0]);
  }, "SCHEMA_VIOLATION");
});

test("requires request evidence for live output but not recorded fixtures", () => {
  expectInvalid((candidate) => {
    candidate.metadata.source = "LIVE_RESPONSE";
    delete candidate.metadata.requestId;
  }, "MISSING_REQUEST_ID");
});
