import type { Decision } from "../domain/decision.js";
import type { RefundPolicyInput } from "../domain/refund.js";
import type { PolicyIR } from "../policy-ir/types.js";

export interface CodeMapping {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  symbol: string;
  ruleIds: string[];
}

export interface ChangedClause {
  clauseId: string;
  beforeText: string;
  afterText: string;
}

export interface ChangedRule {
  ruleId: string;
  before: PolicyIR["rules"][number];
  after: PolicyIR["rules"][number];
}

export interface ChangedCaseExpectation {
  caseId: string;
  input: RefundPolicyInput;
  beforeDecision: Decision;
  afterDecision: Decision;
  beforeRuleId: string | null;
  afterRuleId: string | null;
  source: string;
}

export interface PolicyImpactReport {
  schemaVersion: "1";
  executionMode: "REFERENCE_EVALUATOR_NOT_OPA";
  fromVersion: number;
  toVersion: number;
  change: {
    field: "daysSincePurchase";
    from: number;
    to: number;
  };
  verificationState: "BLOCKED_BY_GOLDEN_CONTRADICTION" | "READY_FOR_REVIEW";
  changedClauses: ChangedClause[];
  changedRules: ChangedRule[];
  changedCases: ChangedCaseExpectation[];
  goldenContradictionCaseIds: string[];
  regeneratedBoundaryValues: number[];
  potentialCodeLocations: CodeMapping[];
}
