import type { PolicyCase } from "../domain/cases.js";
import type { PolicyDecisionResult, RefundPolicyInput } from "../domain/refund.js";
import type { PolicyIR, Predicate } from "./types.js";

function evaluatePredicate(predicate: Predicate, input: RefundPolicyInput): boolean {
  if (predicate.type === "compare") {
    const actual = input[predicate.field];
    if (predicate.operator === "eq") {
      return Object.is(actual, predicate.value);
    }
    if (predicate.operator === "neq") {
      return !Object.is(actual, predicate.value);
    }
    if (typeof actual !== "number" || typeof predicate.value !== "number") {
      return false;
    }
    if (predicate.operator === "lt") {
      return actual < predicate.value;
    }
    if (predicate.operator === "lte") {
      return actual <= predicate.value;
    }
    if (predicate.operator === "gt") {
      return actual > predicate.value;
    }
    return actual >= predicate.value;
  }

  if (predicate.type === "in") {
    return predicate.values.some((value) => Object.is(input[predicate.field], value));
  }
  if (predicate.type === "not") {
    return !evaluatePredicate(predicate.child, input);
  }
  return predicate.type === "and"
    ? predicate.children.every((child) => evaluatePredicate(child, input))
    : predicate.children.some((child) => evaluatePredicate(child, input));
}

/**
 * Deterministic diagnostic evaluator for schema fixtures and contradiction
 * checks. It does not replace OPA evidence and must not mark a policy verified.
 */
export function evaluatePolicyIRReference(
  policy: PolicyIR,
  input: RefundPolicyInput,
): PolicyDecisionResult {
  const orderedRules = [...policy.rules].sort((left, right) => right.priority - left.priority);
  const matchedRule = orderedRules.find((rule) => evaluatePredicate(rule.when, input));
  if (!matchedRule) {
    return {
      decision: policy.defaultDecision,
      matchedRuleId: null,
      explanation: "No explicit rule matched; applied the candidate default decision.",
      policyVersion: policy.version,
    };
  }
  return {
    decision: matchedRule.decision,
    matchedRuleId: matchedRule.id,
    explanation: matchedRule.explanationTemplate,
    policyVersion: policy.version,
  };
}

export interface GoldenContradiction {
  caseId: string;
  expectedDecision: PolicyCase["expectedDecision"];
  candidateDecision: PolicyCase["expectedDecision"];
  matchedRuleId: string | null;
}

export function findGoldenContradictions(
  policy: PolicyIR,
  cases: readonly PolicyCase[],
): GoldenContradiction[] {
  return cases.flatMap((policyCase) => {
    const result = evaluatePolicyIRReference(policy, policyCase.input);
    return result.decision === policyCase.expectedDecision
      ? []
      : [
          {
            caseId: policyCase.id,
            expectedDecision: policyCase.expectedDecision,
            candidateDecision: result.decision,
            matchedRuleId: result.matchedRuleId,
          },
        ];
  });
}
