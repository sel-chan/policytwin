import type { Decision } from "../domain/decision.js";
import type { RefundPolicyInput } from "../domain/refund.js";

export type Scalar = string | number | boolean;
export type RefundInputField = keyof RefundPolicyInput;
export type CompareOperator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

export type Predicate =
  | {
      type: "compare";
      field: RefundInputField;
      operator: CompareOperator;
      value: Scalar;
    }
  | {
      type: "in";
      field: RefundInputField;
      values: Scalar[];
    }
  | {
      type: "and" | "or";
      children: Predicate[];
    }
  | {
      type: "not";
      child: Predicate;
    };

export interface PolicyClause {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  normalizedText: string;
}

export interface PolicyRule {
  id: string;
  sourceClauseIds: string[];
  title: string;
  description: string;
  when: Predicate;
  decision: Decision;
  priority: number;
  explanationTemplate: string;
}

export type BoundaryField = "daysSincePurchase" | "usageBasisPoints";

export type PolicyPatch =
  | {
      op: "SET_NORMALIZATION";
      field: "purchaseDayIndex";
      value: 0 | 1;
    }
  | {
      op: "SET_NORMALIZATION";
      field: "usageMeasuredAt";
      value: "REQUEST_TIME" | "DECISION_TIME";
    }
  | {
      op: "SET_BOUNDARY_OPERATOR";
      ruleId: string;
      field: BoundaryField;
      value: "lt" | "lte" | "gt" | "gte";
    }
  | {
      op: "SET_RULE_DECISION";
      ruleId: string;
      value: Decision;
    }
  | {
      op: "SET_PRECEDENCE";
      higherRuleId: string;
      lowerRuleId: string;
    }
  | {
      op: "SET_DEFAULT_DECISION";
      value: Decision;
    };

export type AmbiguityCategory =
  | "BOUNDARY"
  | "PRECEDENCE"
  | "DEFAULT"
  | "MEASUREMENT"
  | "MISSING_OUTCOME"
  | "OTHER";

export interface PolicyAmbiguityOption {
  id: string;
  label: string;
  description: string;
  policyPatch: PolicyPatch;
  exampleImpacts: Array<{
    input: RefundPolicyInput;
    result: Decision;
  }>;
}

export interface PolicyAmbiguity {
  id: string;
  sourceClauseIds: string[];
  category: AmbiguityCategory;
  question: string;
  rationale: string;
  options: PolicyAmbiguityOption[];
  status: "OPEN" | "RESOLVED";
  selectedOptionId?: string;
}

export interface PolicyIRMetadata {
  model: string;
  promptVersion: string;
  schemaVersion: "1";
  createdAt: string;
  source: "LIVE_RESPONSE" | "RECORDED_FIXTURE";
  requestId?: string;
}

export interface PolicyIR {
  id: string;
  policyId: string;
  version: number;
  schemaVersion: "1";
  domain: "saas_refund";
  clauses: PolicyClause[];
  rules: PolicyRule[];
  ambiguities: PolicyAmbiguity[];
  defaultDecision: Decision;
  normalization: {
    purchaseDayIndex: 0 | 1;
    usageMeasuredAt: "REQUEST_TIME" | "DECISION_TIME";
  };
  inputSchema: Record<string, unknown>;
  metadata: PolicyIRMetadata;
}
