import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PolicyResolutionError,
  parsePolicyIR,
  resolvePolicyAmbiguity,
  stateForPolicyCandidate,
} from "../../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);

test("resolves seeded decisions into immutable sequential policy versions", () => {
  const original = parsePolicyIR(structuredClone(recorded));
  assert.equal(stateForPolicyCandidate(original), "NEEDS_DECISION");

  const first = resolvePolicyAmbiguity(
    original,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    goldenCases,
    "2026-07-14T01:00:00.000Z",
  );
  const second = resolvePolicyAmbiguity(
    first.policy,
    "ambiguity-usage-measurement-time",
    "usage-at-request",
    goldenCases,
    "2026-07-14T01:01:00.000Z",
  );
  const third = resolvePolicyAmbiguity(
    second.policy,
    "ambiguity-default-decision",
    "default-deny",
    goldenCases,
    "2026-07-14T01:02:00.000Z",
  );

  assert.equal(original.version, 1);
  assert.equal(original.ambiguities.every((ambiguity) => ambiguity.status === "OPEN"), true);
  assert.equal(third.policy.version, 4);
  assert.equal(third.policy.id, "policy-seeded-refund-v4");
  assert.equal(third.policy.normalization.purchaseDayIndex, 0);
  assert.equal(third.policy.normalization.usageMeasuredAt, "REQUEST_TIME");
  assert.equal(third.policy.defaultDecision, "DENY");
  assert.equal(stateForPolicyCandidate(third.policy), "READY_TO_COMPILE");
  assert.deepEqual(
    [first.decisionRecord.fromVersion, second.decisionRecord.fromVersion, third.decisionRecord.fromVersion],
    [1, 2, 3],
  );
});

test("same resolved option is idempotent while a different option creates a new version", () => {
  const first = resolvePolicyAmbiguity(
    recorded,
    "ambiguity-default-decision",
    "default-deny",
    goldenCases,
  );
  const repeated = resolvePolicyAmbiguity(
    first.policy,
    "ambiguity-default-decision",
    "default-deny",
    goldenCases,
  );
  assert.equal(repeated.idempotent, true);
  assert.strictEqual(repeated.policy, first.policy);
  assert.equal(repeated.decisionRecord, null);

  const revisited = resolvePolicyAmbiguity(
    first.policy,
    "ambiguity-default-decision",
    "default-review",
    [],
  );
  assert.equal(revisited.idempotent, false);
  assert.equal(revisited.policy.version, first.policy.version + 1);
  assert.equal(revisited.policy.defaultDecision, "REVIEW");
});

test("normalization options update both closed normalization fields", () => {
  const dayOne = resolvePolicyAmbiguity(
    recorded,
    "ambiguity-purchase-day-index",
    "purchase-day-one",
    [],
  );
  assert.equal(dayOne.policy.normalization.purchaseDayIndex, 1);

  const decisionTime = resolvePolicyAmbiguity(
    dayOne.policy,
    "ambiguity-usage-measurement-time",
    "usage-at-decision",
    [],
  );
  assert.equal(decisionTime.policy.normalization.usageMeasuredAt, "DECISION_TIME");
});

test("authoritative golden contradictions block a decision version", () => {
  assert.throws(
    () =>
      resolvePolicyAmbiguity(
        recorded,
        "ambiguity-default-decision",
        "default-review",
        goldenCases,
      ),
    (error) => {
      assert.equal(error instanceof PolicyResolutionError, true);
      assert.equal(error.code, "GOLDEN_CONTRADICTION");
      assert.deepEqual(error.contradictions.map((item) => item.caseId), ["G02"]);
      return true;
    },
  );
});

test("applies boundary, rule-decision, and precedence patches from closed options", () => {
  const boundaryCandidate = structuredClone(recorded);
  boundaryCandidate.ambiguities[0].category = "BOUNDARY";
  boundaryCandidate.ambiguities[0].options[0].policyPatch = {
    op: "SET_BOUNDARY_OPERATOR",
    ruleId: "refund-eligible",
    field: "daysSincePurchase",
    value: "lt",
  };
  boundaryCandidate.ambiguities[0].options[1].policyPatch = {
    op: "SET_BOUNDARY_OPERATOR",
    ruleId: "refund-eligible",
    field: "daysSincePurchase",
    value: "lte",
  };
  const boundary = resolvePolicyAmbiguity(
    boundaryCandidate,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    [],
  );
  assert.match(JSON.stringify(boundary.policy.rules.find((rule) => rule.id === "refund-eligible")), /"operator":"lt"/u);

  const decisionCandidate = structuredClone(recorded);
  decisionCandidate.ambiguities[0].category = "MISSING_OUTCOME";
  decisionCandidate.ambiguities[0].options[0].policyPatch = {
    op: "SET_RULE_DECISION",
    ruleId: "refund-eligible",
    value: "DENY",
  };
  decisionCandidate.ambiguities[0].options[1].policyPatch = {
    op: "SET_RULE_DECISION",
    ruleId: "refund-eligible",
    value: "ALLOW",
  };
  const decision = resolvePolicyAmbiguity(
    decisionCandidate,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    [],
  );
  assert.equal(decision.policy.rules.find((rule) => rule.id === "refund-eligible").decision, "DENY");

  const precedenceCandidate = structuredClone(recorded);
  precedenceCandidate.ambiguities[0].category = "PRECEDENCE";
  precedenceCandidate.ambiguities[0].options[0].policyPatch = {
    op: "SET_PRECEDENCE",
    higherRuleId: "refund-eligible",
    lowerRuleId: "final-sale-deny",
  };
  precedenceCandidate.ambiguities[0].options[1].policyPatch = {
    op: "SET_PRECEDENCE",
    higherRuleId: "final-sale-deny",
    lowerRuleId: "refund-eligible",
  };
  const precedence = resolvePolicyAmbiguity(
    precedenceCandidate,
    "ambiguity-purchase-day-index",
    "purchase-day-zero",
    [],
  );
  const refundPriority = precedence.policy.rules.find((rule) => rule.id === "refund-eligible").priority;
  const finalSalePriority = precedence.policy.rules.find((rule) => rule.id === "final-sale-deny").priority;
  assert.equal(refundPriority > finalSalePriority, true);
});

test("rejects unknown ambiguity and option identifiers", () => {
  assert.throws(
    () => resolvePolicyAmbiguity(recorded, "missing", "default-deny", goldenCases),
    (error) => error instanceof PolicyResolutionError && error.code === "UNKNOWN_AMBIGUITY",
  );
  assert.throws(
    () => resolvePolicyAmbiguity(recorded, "ambiguity-default-decision", "missing", goldenCases),
    (error) => error instanceof PolicyResolutionError && error.code === "UNKNOWN_OPTION",
  );
  assert.throws(
    () =>
      resolvePolicyAmbiguity(
        recorded,
        "ambiguity-default-decision",
        "default-deny",
        goldenCases,
        "not-a-time",
      ),
    (error) => error instanceof PolicyResolutionError && error.code === "INVALID_DECISION_TIME",
  );
});
