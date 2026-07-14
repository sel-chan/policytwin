import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PolicyStateTransitionError,
  compilePolicyToRego,
  resolvePolicyAmbiguity,
} from "../../dist/index.js";

const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);
const goldenCases = JSON.parse(
  await readFile(new URL("../../fixtures/refund-demo/cases/golden-cases.json", import.meta.url)),
);
const regoSnapshot = await readFile(
  new URL("../snapshots/seeded-policy.rego", import.meta.url),
  "utf8",
);
const manifestSnapshot = JSON.parse(
  await readFile(new URL("../snapshots/seeded-policy.compiler-manifest.json", import.meta.url)),
);

function acceptedPolicy() {
  let policy = structuredClone(recorded);
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
  return policy;
}

test("compiles accepted seeded policy byte-for-byte deterministically", () => {
  const policy = acceptedPolicy();
  const first = compilePolicyToRego(policy);
  const second = compilePolicyToRego(structuredClone(policy));
  assert.deepEqual(first, second);
  assert.equal(first.manifest.policyVersion, 4);
  assert.equal(first.manifest.ruleMappings.length, 4);
  assert.equal(first.manifest.sourceBytes, new TextEncoder().encode(first.source).length);
  assert.match(first.source, /package policytwin\.refund/u);
  assert.match(first.source, /import rego\.v1/u);
  assert.match(first.source, /object\.keys\(input\)/u);
  assert.equal(first.source, regoSnapshot);
  assert.deepEqual(first.manifest, manifestSnapshot);
});

test("manifest mappings point at exact decision rule lines in priority order", () => {
  const { source, manifest } = compilePolicyToRego(acceptedPolicy());
  const lines = source.split("\n");
  assert.deepEqual(
    manifest.ruleMappings.map((mapping) => mapping.ruleId),
    ["final-sale-deny", "promotion-approved", "promotion-review", "refund-eligible"],
  );
  for (const mapping of manifest.ruleMappings) {
    const mappedSource = lines.slice(mapping.startLine - 1, mapping.endLine).join("\n");
    assert.match(mappedSource, /^decision := \{/u);
    assert.match(mappedSource, new RegExp(JSON.stringify(mapping.ruleId), "u"));
  }
});

test("supports compare, membership, and, or, and not predicate compilation", () => {
  const policy = acceptedPolicy();
  policy.rules.find((rule) => rule.id === "refund-eligible").when = {
    type: "and",
    children: [
      { type: "compare", field: "daysSincePurchase", operator: "lte", value: 14 },
      {
        type: "or",
        children: [
          { type: "in", field: "planType", values: ["MONTHLY", "ANNUAL"] },
          {
            type: "not",
            child: { type: "compare", field: "finalSale", operator: "eq", value: true },
          },
        ],
      },
    ],
  };
  const { source } = compilePolicyToRego(policy);
  assert.match(source, /input\.daysSincePurchase <= 14/u);
  assert.match(source, /input\.planType in \{"ANNUAL", "MONTHLY"\}/u);
  assert.match(source, /not rule_3_predicate_1_1_0/u);
  assert.equal((source.match(/rule_3_predicate_1 if \{/gu) ?? []).length, 2);
});

test("priority exclusions and default fallback make first-match behavior explicit", () => {
  const { source } = compilePolicyToRego(acceptedPolicy());
  const finalRuleIndex = source.indexOf('"matchedRuleId": "final-sale-deny"');
  const promotionIndex = source.indexOf('"matchedRuleId": "promotion-approved"');
  const fallbackIndex = source.indexOf('"matchedRuleId": null');
  assert.equal(finalRuleIndex < promotionIndex && promotionIndex < fallbackIndex, true);
  assert.match(source.slice(promotionIndex, fallbackIndex), /not rule_0_predicate/u);
  assert.match(source.slice(fallbackIndex), /not rule_3_predicate/u);
});

test("refuses unresolved and structurally invalid policy input before generation", () => {
  assert.throws(() => compilePolicyToRego(recorded), PolicyStateTransitionError);
  const invalid = structuredClone(acceptedPolicy());
  invalid.rules[0].when = { type: "code", source: "allow = true" };
  assert.throws(() => compilePolicyToRego(invalid));
});
