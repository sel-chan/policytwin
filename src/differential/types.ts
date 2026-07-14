import type { Decision } from "../domain/decision.js";
import type { PolicyCase } from "../domain/cases.js";
import type { PolicyDecisionResult, RefundPolicyInput } from "../domain/refund.js";

export type SeededDefectId =
  | "DAY_14_INCLUSIVE"
  | "USAGE_2000_INCLUSIVE"
  | "FINAL_SALE_PRECEDENCE"
  | "PROMOTION_ELIGIBILITY_BYPASS"
  | "UNCLASSIFIED";

export interface ApplicationDecisionResult {
  decision: Decision;
  matchedRuleId: string | null;
  explanation: string;
}

export interface DifferentialRecord {
  caseId: string;
  input: RefundPolicyInput;
  expected: PolicyDecisionResult;
  actual: ApplicationDecisionResult | null;
  relatedClauseIds: string[];
  relatedRuleIds: string[];
  status: "MATCH" | "DRIFT" | "ERROR";
  defectIds: SeededDefectId[];
  error?: string;
}

export interface DefectCluster {
  defectId: SeededDefectId;
  recordCount: number;
  witnessCaseIds: string[];
}

export interface DifferentialReport {
  schemaVersion: "1";
  executionMode: "REFERENCE_EXPECTATION_NOT_OPA";
  adapterId: string;
  total: number;
  matches: number;
  drifts: number;
  errors: number;
  records: DifferentialRecord[];
  defectClusters: DefectCluster[];
}

export type ApplicationEvaluator = (input: RefundPolicyInput, policyCase: PolicyCase) => unknown;
