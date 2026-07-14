import type { Decision } from "../domain/decision.js";
import type { PolicyCase } from "../domain/cases.js";
import type { RefundInputField } from "../policy-ir/types.js";
import { evaluatePredicateReference } from "../policy-ir/evaluate.js";
import type { PolicyIR } from "../policy-ir/types.js";

export interface RuleConflictWitness {
  id: string;
  higherRuleId: string;
  lowerRuleId: string;
  higherDecision: Decision;
  lowerDecision: Decision;
  witnessCaseIds: string[];
  resolvedByPriority: boolean;
}

export interface MinimalContrast {
  leftCaseId: string;
  rightCaseId: string;
  changedField: RefundInputField;
  leftDecision: Decision;
  rightDecision: Decision;
}

const INPUT_FIELDS: RefundInputField[] = [
  "daysSincePurchase",
  "usageBasisPoints",
  "promotionalPurchase",
  "finalSale",
  "managerApproved",
  "planType",
];

export function findRuleConflictWitnesses(
  policy: PolicyIR,
  cases: readonly PolicyCase[],
): RuleConflictWitness[] {
  const conflicts = new Map<string, RuleConflictWitness>();
  for (const policyCase of cases) {
    const matching = policy.rules
      .filter((rule) => evaluatePredicateReference(rule.when, policyCase.input))
      .sort((left, right) => right.priority - left.priority);
    for (let leftIndex = 0; leftIndex < matching.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < matching.length; rightIndex += 1) {
        const higher = matching[leftIndex];
        const lower = matching[rightIndex];
        if (!higher || !lower || higher.decision === lower.decision) {
          continue;
        }
        const id = `${higher.id}::${lower.id}`;
        const existing = conflicts.get(id);
        if (existing) {
          existing.witnessCaseIds.push(policyCase.id);
        } else {
          conflicts.set(id, {
            id,
            higherRuleId: higher.id,
            lowerRuleId: lower.id,
            higherDecision: higher.decision,
            lowerDecision: lower.decision,
            witnessCaseIds: [policyCase.id],
            resolvedByPriority: higher.priority > lower.priority,
          });
        }
      }
    }
  }
  return [...conflicts.values()];
}

export function findMinimalContrasts(cases: readonly PolicyCase[]): MinimalContrast[] {
  const contrasts: MinimalContrast[] = [];
  for (let leftIndex = 0; leftIndex < cases.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cases.length; rightIndex += 1) {
      const left = cases[leftIndex];
      const right = cases[rightIndex];
      if (!left || !right || left.expectedDecision === right.expectedDecision) {
        continue;
      }
      const changedFields = INPUT_FIELDS.filter(
        (field) => left.input[field] !== right.input[field],
      );
      if (changedFields.length === 1 && changedFields[0]) {
        contrasts.push({
          leftCaseId: left.id,
          rightCaseId: right.id,
          changedField: changedFields[0],
          leftDecision: left.expectedDecision,
          rightDecision: right.expectedDecision,
        });
      }
    }
  }
  return contrasts;
}

export function findUnreachedRuleIds(policy: PolicyIR, cases: readonly PolicyCase[]): string[] {
  return policy.rules
    .filter(
      (rule) => !cases.some((policyCase) => evaluatePredicateReference(rule.when, policyCase.input)),
    )
    .map((rule) => rule.id);
}
