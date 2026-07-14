import type { PolicyCase } from "../domain/cases.js";
import type { PolicyIR, Predicate } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import { findRuleConflictWitnesses } from "../cases/analyze.js";

export type MutationOperator =
  | "LTE_TO_LT"
  | "GTE_TO_GT"
  | "AND_TO_OR"
  | "PREDICATE_DELETE"
  | "BOOLEAN_INVERT"
  | "THRESHOLD_MINUS_ONE"
  | "THRESHOLD_PLUS_ONE"
  | "PRIORITY_SWAP"
  | "RULE_DELETE"
  | "DEFAULT_CHANGE";

export interface PolicyMutant {
  id: string;
  operator: MutationOperator;
  description: string;
  policy: PolicyIR;
}

interface PredicateLocation {
  ruleIndex: number;
  path: number[];
  predicate: Predicate;
}

function collectPredicateLocations(
  predicate: Predicate,
  ruleIndex: number,
  path: number[],
  output: PredicateLocation[],
): void {
  output.push({ ruleIndex, path, predicate });
  if (predicate.type === "and" || predicate.type === "or") {
    predicate.children.forEach((child, index) =>
      collectPredicateLocations(child, ruleIndex, [...path, index], output),
    );
  } else if (predicate.type === "not") {
    collectPredicateLocations(predicate.child, ruleIndex, [...path, 0], output);
  }
}

function replacePredicateAtPath(
  predicate: Predicate,
  path: readonly number[],
  replacement: Predicate,
): Predicate {
  if (path.length === 0) {
    return replacement;
  }
  const [head, ...tail] = path;
  if (predicate.type === "not") {
    return { ...predicate, child: replacePredicateAtPath(predicate.child, tail, replacement) };
  }
  if (predicate.type === "and" || predicate.type === "or") {
    return {
      ...predicate,
      children: predicate.children.map((child, index) =>
        index === head ? replacePredicateAtPath(child, tail, replacement) : child,
      ),
    };
  }
  throw new Error("Mutation path traversed a leaf predicate.");
}

export function generatePolicyMutants(
  policyValue: unknown,
  cases: readonly PolicyCase[],
): PolicyMutant[] {
  const policy = parsePolicyIR(policyValue);
  const mutants: PolicyMutant[] = [];
  let sequence = 0;

  function add(
    operator: MutationOperator,
    description: string,
    mutate: (candidate: PolicyIR) => void,
  ): void {
    const candidate = structuredClone(policy);
    mutate(candidate);
    sequence += 1;
    mutants.push({
      id: `M${String(sequence).padStart(3, "0")}-${operator}`,
      operator,
      description,
      policy: parsePolicyIR(candidate),
    });
  }

  const locations: PredicateLocation[] = [];
  policy.rules.forEach((rule, ruleIndex) =>
    collectPredicateLocations(rule.when, ruleIndex, [], locations),
  );

  for (const location of locations) {
    const { predicate } = location;
    if (predicate.type === "compare") {
      if (predicate.operator === "lte") {
        add("LTE_TO_LT", `Changed lte to lt at rule ${location.ruleIndex}.`, (candidate) => {
          const rule = candidate.rules[location.ruleIndex];
          if (rule) {
            rule.when = replacePredicateAtPath(rule.when, location.path, { ...predicate, operator: "lt" });
          }
        });
      }
      if (predicate.operator === "gte") {
        add("GTE_TO_GT", `Changed gte to gt at rule ${location.ruleIndex}.`, (candidate) => {
          const rule = candidate.rules[location.ruleIndex];
          if (rule) {
            rule.when = replacePredicateAtPath(rule.when, location.path, { ...predicate, operator: "gt" });
          }
        });
      }
      if (typeof predicate.value === "boolean") {
        add("BOOLEAN_INVERT", `Inverted boolean at rule ${location.ruleIndex}.`, (candidate) => {
          const rule = candidate.rules[location.ruleIndex];
          if (rule) {
            rule.when = replacePredicateAtPath(rule.when, location.path, {
              ...predicate,
              value: !predicate.value,
            });
          }
        });
      }
      if (typeof predicate.value === "number") {
        const numericValue = predicate.value;
        if (numericValue > 0) {
          add("THRESHOLD_MINUS_ONE", `Decremented threshold at rule ${location.ruleIndex}.`, (candidate) => {
            const rule = candidate.rules[location.ruleIndex];
            if (rule) {
              rule.when = replacePredicateAtPath(rule.when, location.path, {
                ...predicate,
                value: numericValue - 1,
              });
            }
          });
        }
        add("THRESHOLD_PLUS_ONE", `Incremented threshold at rule ${location.ruleIndex}.`, (candidate) => {
          const rule = candidate.rules[location.ruleIndex];
          if (rule) {
            rule.when = replacePredicateAtPath(rule.when, location.path, {
              ...predicate,
              value: numericValue + 1,
            });
          }
        });
      }
    }

    if (predicate.type === "and") {
      add("AND_TO_OR", `Changed and to or at rule ${location.ruleIndex}.`, (candidate) => {
        const rule = candidate.rules[location.ruleIndex];
        if (rule) {
          rule.when = replacePredicateAtPath(rule.when, location.path, { ...predicate, type: "or" });
        }
      });
    }

    if ((predicate.type === "and" || predicate.type === "or") && predicate.children.length > 2) {
      predicate.children.forEach((_, deletedIndex) => {
        add(
          "PREDICATE_DELETE",
          `Deleted predicate ${deletedIndex} at rule ${location.ruleIndex}.`,
          (candidate) => {
            const rule = candidate.rules[location.ruleIndex];
            if (rule) {
              rule.when = replacePredicateAtPath(rule.when, location.path, {
                ...predicate,
                children: predicate.children.filter((__, index) => index !== deletedIndex),
              });
            }
          },
        );
      });
    }
  }

  for (const conflict of findRuleConflictWitnesses(policy, cases)) {
    add("PRIORITY_SWAP", `Swapped conflict priority ${conflict.higherRuleId}/${conflict.lowerRuleId}.`, (candidate) => {
      const higher = candidate.rules.find((rule) => rule.id === conflict.higherRuleId);
      const lower = candidate.rules.find((rule) => rule.id === conflict.lowerRuleId);
      if (higher && lower) {
        const priority = higher.priority;
        higher.priority = lower.priority;
        lower.priority = priority;
      }
    });
  }

  policy.rules.forEach((rule, ruleIndex) => {
    add("RULE_DELETE", `Deleted rule ${rule.id}.`, (candidate) => {
      candidate.rules.splice(ruleIndex, 1);
    });
  });

  for (const decision of ["ALLOW", "DENY", "REVIEW"] as const) {
    if (decision !== policy.defaultDecision) {
      add("DEFAULT_CHANGE", `Changed default to ${decision}.`, (candidate) => {
        candidate.defaultDecision = decision;
      });
    }
  }
  return mutants;
}
