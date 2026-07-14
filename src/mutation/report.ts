import type { PolicyCase } from "../domain/cases.js";
import { evaluatePolicyIRReference } from "../policy-ir/evaluate.js";
import type { PolicyIR } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import {
  generatePolicyMutants,
  type MutationOperator,
  type PolicyMutant,
} from "./mutate.js";

export interface MutationResult {
  mutantId: string;
  operator: MutationOperator;
  description: string;
  killed: boolean;
  witnessCaseIds: string[];
}

export interface OfflineMutationReport {
  executionMode: "REFERENCE_EVALUATOR_NOT_OPA";
  killed: number;
  total: number;
  excludedEquivalent: number;
  killRate: number;
  results: MutationResult[];
  survivors: MutationResult[];
  operatorCounts: Record<MutationOperator, number>;
}

const OPERATORS: MutationOperator[] = [
  "LTE_TO_LT",
  "GTE_TO_GT",
  "AND_TO_OR",
  "PREDICATE_DELETE",
  "BOOLEAN_INVERT",
  "THRESHOLD_MINUS_ONE",
  "THRESHOLD_PLUS_ONE",
  "PRIORITY_SWAP",
  "RULE_DELETE",
  "DEFAULT_CHANGE",
];

function executeMutant(mutant: PolicyMutant, cases: readonly PolicyCase[]): MutationResult {
  const witnessCaseIds = cases
    .filter(
      (policyCase) =>
        evaluatePolicyIRReference(mutant.policy, policyCase.input).decision !==
        policyCase.expectedDecision,
    )
    .map((policyCase) => policyCase.id);
  return {
    mutantId: mutant.id,
    operator: mutant.operator,
    description: mutant.description,
    killed: witnessCaseIds.length > 0,
    witnessCaseIds,
  };
}

export function runOfflineMutationSuite(
  policyValue: unknown,
  cases: readonly PolicyCase[],
): OfflineMutationReport {
  const policy: PolicyIR = parsePolicyIR(policyValue);
  const mutants = generatePolicyMutants(policy, cases);
  const results = mutants.map((mutant) => executeMutant(mutant, cases));
  const killed = results.filter((result) => result.killed).length;
  const total = results.length;
  const operatorCounts = Object.fromEntries(
    OPERATORS.map((operator) => [operator, results.filter((result) => result.operator === operator).length]),
  ) as Record<MutationOperator, number>;
  return {
    executionMode: "REFERENCE_EVALUATOR_NOT_OPA",
    killed,
    total,
    excludedEquivalent: 0,
    killRate: total === 0 ? 0 : killed / total,
    results,
    survivors: results.filter((result) => !result.killed),
    operatorCounts,
  };
}
