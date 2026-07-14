import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeClauseText, segmentPolicyClauses } from "../../dist/index.js";

const policyText = await readFile(
  new URL("../../fixtures/interpreter/seeded-refund-policy.txt", import.meta.url),
  "utf8",
);
const recorded = JSON.parse(
  await readFile(new URL("../../fixtures/interpreter/recorded-policy-ir.v1.json", import.meta.url)),
);

test("segments seeded policy into deterministic recorded clauses", () => {
  const first = segmentPolicyClauses(policyText);
  const second = segmentPolicyClauses(policyText);
  assert.deepEqual(first, second);
  assert.deepEqual(first, recorded.clauses);
});

test("every clause offset slices the exact original source text", () => {
  for (const clause of segmentPolicyClauses(policyText)) {
    assert.equal(policyText.slice(clause.startOffset, clause.endOffset), clause.text);
    assert.equal(normalizeClauseText(clause.text), clause.normalizedText);
  }
});

test("offsets remain correct for UTF-16 surrogate pairs and duplicate clauses get unique IDs", () => {
  const source = "😀 First rule.\n\nSame rule! Same rule!";
  const clauses = segmentPolicyClauses(source);
  assert.equal(clauses.length, 3);
  clauses.forEach((clause) => {
    assert.equal(source.slice(clause.startOffset, clause.endOffset), clause.text);
  });
  assert.notEqual(clauses[1].id, clauses[2].id);
  assert.match(clauses[2].id, /-2$/u);
});
