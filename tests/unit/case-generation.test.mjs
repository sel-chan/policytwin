import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalRefundInputKey,
  findMinimalContrasts,
  findRuleConflictWitnesses,
  findUnreachedRuleIds,
  generateAcceptedCaseCorpus,
  resolvePolicyAmbiguity,
} from "../../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);

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

test("generates at least 30 unique accepted and traceable cases deterministically", () => {
  const policy = acceptedPolicy();
  const first = generateAcceptedCaseCorpus(policy, goldenCases);
  const second = generateAcceptedCaseCorpus(structuredClone(policy), goldenCases);
  assert.deepEqual(first, second);
  assert.equal(first.length >= 30, true);
  assert.equal(new Set(first.map((item) => canonicalRefundInputKey(item.input))).size, first.length);
  assert.equal(first.filter((item) => item.source === "USER_GOLDEN").length, 6);
  assert.equal(first.every((item) => item.rationale.length > 0), true);
  assert.equal(first.every((item) => item.relatedClauseIds.length > 0), true);
});

test("contains exact day, usage, promotion, final-sale, and default witnesses", () => {
  const cases = generateAcceptedCaseCorpus(acceptedPolicy(), goldenCases);
  for (const days of [13, 14, 15]) {
    assert.equal(cases.some((item) => item.input.daysSincePurchase === days), true);
  }
  for (const usage of [1999, 2000, 2001]) {
    assert.equal(cases.some((item) => item.input.usageBasisPoints === usage), true);
  }
  assert.equal(
    cases.some(
      (item) =>
        item.input.promotionalPurchase && item.input.managerApproved && item.expectedDecision === "ALLOW",
    ),
    true,
  );
  assert.equal(
    cases.some((item) => item.input.finalSale && item.expectedDecision === "DENY"),
    true,
  );
  assert.equal(cases.some((item) => item.title === "No-match accepted default"), true);
});

test("reports seeded overlaps, one-field contrasts, and no unreached rule", () => {
  const policy = acceptedPolicy();
  const cases = generateAcceptedCaseCorpus(policy, goldenCases);
  const conflicts = findRuleConflictWitnesses(policy, cases);
  assert.equal(
    conflicts.some(
      (conflict) =>
        conflict.higherRuleId === "final-sale-deny" &&
        conflict.lowerRuleId === "promotion-approved" &&
        conflict.resolvedByPriority,
    ),
    true,
  );
  const contrasts = findMinimalContrasts(cases);
  assert.equal(contrasts.some((contrast) => contrast.changedField === "managerApproved"), true);
  assert.equal(contrasts.some((contrast) => contrast.changedField === "finalSale"), true);
  assert.deepEqual(findUnreachedRuleIds(policy, cases), []);
});
