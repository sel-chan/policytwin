import type { PolicyCase } from "../domain/cases.js";
import { evaluatePolicyIRReference } from "../policy-ir/evaluate.js";
import type { PolicyIR, Predicate } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import type { CodeMapping, PolicyImpactReport } from "./types.js";

function rewriteThreshold(predicate: Predicate, from: number, to: number): Predicate {
  if (predicate.type === "compare") {
    return predicate.field === "daysSincePurchase" && predicate.value === from
      ? { ...predicate, value: to }
      : { ...predicate };
  }
  if (predicate.type === "in") {
    return { ...predicate, values: [...predicate.values] };
  }
  if (predicate.type === "not") {
    return { ...predicate, child: rewriteThreshold(predicate.child, from, to) };
  }
  return {
    ...predicate,
    children: predicate.children.map((child) => rewriteThreshold(child, from, to)),
  };
}

function collectDayThresholds(predicate: Predicate): number[] {
  if (predicate.type === "compare") {
    return predicate.field === "daysSincePurchase" && typeof predicate.value === "number"
      ? [predicate.value]
      : [];
  }
  if (predicate.type === "in") {
    return [];
  }
  if (predicate.type === "not") {
    return collectDayThresholds(predicate.child);
  }
  return predicate.children.flatMap(collectDayThresholds);
}

export function createDaysThresholdVersion(
  policyValue: unknown,
  newThreshold: number,
  createdAt: string,
): PolicyIR {
  const policy = parsePolicyIR(policyValue);
  if (!Number.isInteger(newThreshold) || newThreshold < 0) {
    throw new Error("New day threshold must be a non-negative integer.");
  }
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error("Impact version timestamp must be ISO-compatible.");
  }
  const thresholds = [
    ...new Set(policy.rules.flatMap((rule) => collectDayThresholds(rule.when))),
  ];
  if (thresholds.length !== 1) {
    throw new Error("Policy day threshold must resolve to one consistent value.");
  }
  const oldThreshold = thresholds[0];
  if (oldThreshold === undefined || oldThreshold === newThreshold) {
    throw new Error("New day threshold must differ from the current threshold.");
  }
  const oldText = String(oldThreshold);
  const newText = String(newThreshold);
  let offsetDelta = 0;
  const clauses = policy.clauses.map((clause) => {
    const text = clause.text.replaceAll(oldText, newText);
    const normalizedText = clause.normalizedText.replaceAll(oldText, newText);
    const startOffset = clause.startOffset + offsetDelta;
    const endOffset = startOffset + text.length;
    offsetDelta += text.length - clause.text.length;
    return { ...clause, text, normalizedText, startOffset, endOffset };
  });
  const candidate = {
    ...structuredClone(policy),
    id: `${policy.id}-impact-v${policy.version + 1}`,
    version: policy.version + 1,
    clauses,
    rules: policy.rules.map((rule) => ({
      ...structuredClone(rule),
      when: rewriteThreshold(rule.when, oldThreshold, newThreshold),
    })),
    metadata: { ...policy.metadata, createdAt },
  };
  return parsePolicyIR(candidate);
}

export function analyzePolicyImpact(
  beforeValue: unknown,
  afterValue: unknown,
  cases: readonly PolicyCase[],
  goldenCaseIds: readonly string[],
  codeMappings: readonly CodeMapping[],
): PolicyImpactReport {
  const before = parsePolicyIR(beforeValue);
  const after = parsePolicyIR(afterValue);
  if (after.version !== before.version + 1 || after.policyId !== before.policyId) {
    throw new Error("Impact analysis requires consecutive versions of the same policy.");
  }
  const beforeThresholds = [...new Set(before.rules.flatMap((rule) => collectDayThresholds(rule.when)))];
  const afterThresholds = [...new Set(after.rules.flatMap((rule) => collectDayThresholds(rule.when)))];
  if (beforeThresholds.length !== 1 || afterThresholds.length !== 1) {
    throw new Error("Impact analysis requires one consistent day threshold per version.");
  }
  const changedRules = before.rules.flatMap((rule) => {
    const next = after.rules.find((candidate) => candidate.id === rule.id);
    return next && JSON.stringify(rule) !== JSON.stringify(next)
      ? [{ ruleId: rule.id, before: structuredClone(rule), after: structuredClone(next) }]
      : [];
  });
  const changedRuleIds = new Set(changedRules.map((item) => item.ruleId));
  const changedCases = cases.flatMap((policyCase) => {
    const oldResult = evaluatePolicyIRReference(before, policyCase.input);
    const newResult = evaluatePolicyIRReference(after, policyCase.input);
    return oldResult.decision === newResult.decision
      ? []
      : [
          {
            caseId: policyCase.id,
            input: structuredClone(policyCase.input),
            beforeDecision: oldResult.decision,
            afterDecision: newResult.decision,
            beforeRuleId: oldResult.matchedRuleId,
            afterRuleId: newResult.matchedRuleId,
            source: policyCase.source,
          },
        ];
  });
  const golden = new Set(goldenCaseIds);
  const goldenContradictionCaseIds = changedCases
    .filter((item) => golden.has(item.caseId))
    .map((item) => item.caseId);
  const from = beforeThresholds[0] as number;
  const to = afterThresholds[0] as number;
  return {
    schemaVersion: "1",
    executionMode: "REFERENCE_EVALUATOR_NOT_OPA",
    fromVersion: before.version,
    toVersion: after.version,
    change: { field: "daysSincePurchase", from, to },
    verificationState:
      goldenContradictionCaseIds.length > 0
        ? "BLOCKED_BY_GOLDEN_CONTRADICTION"
        : "READY_FOR_REVIEW",
    changedClauses: before.clauses.flatMap((clause) => {
      const next = after.clauses.find((candidate) => candidate.id === clause.id);
      return next && next.text !== clause.text
        ? [{ clauseId: clause.id, beforeText: clause.text, afterText: next.text }]
        : [];
    }),
    changedRules,
    changedCases,
    goldenContradictionCaseIds,
    regeneratedBoundaryValues: [Math.max(0, to - 1), to, to + 1],
    potentialCodeLocations: codeMappings
      .filter((mapping) => mapping.ruleIds.some((ruleId) => changedRuleIds.has(ruleId)))
      .map((mapping) => structuredClone(mapping)),
  };
}
