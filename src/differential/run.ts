import type { PolicyCase } from "../domain/cases.js";
import { isDecision } from "../domain/decision.js";
import type { PolicyDecisionResult } from "../domain/refund.js";
import { evaluatePolicyIRReference } from "../policy-ir/evaluate.js";
import type { PolicyIR } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import type {
  ApplicationDecisionResult,
  ApplicationEvaluator,
  DefectCluster,
  DifferentialRecord,
  DifferentialReport,
  SeededDefectId,
} from "./types.js";

function normalizeApplicationResult(value: unknown): ApplicationDecisionResult {
  if (isDecision(value)) {
    return {
      decision: value,
      matchedRuleId: null,
      explanation: "Fixture returned a decision without trace metadata.",
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Application result must be a decision or decision object.");
  }
  const result = value as Record<string, unknown>;
  if (!isDecision(result.decision)) {
    throw new Error("Application result contains an invalid decision.");
  }
  if (result.matchedRuleId !== null && typeof result.matchedRuleId !== "string") {
    throw new Error("Application matchedRuleId must be string or null.");
  }
  if (typeof result.explanation !== "string") {
    throw new Error("Application explanation must be a string.");
  }
  return {
    decision: result.decision,
    matchedRuleId: result.matchedRuleId,
    explanation: result.explanation,
  };
}

function identifyDefects(
  policyCase: PolicyCase,
  expected: PolicyDecisionResult,
  actual: ApplicationDecisionResult,
): SeededDefectId[] {
  if (expected.decision === actual.decision) {
    return [];
  }
  const defectIds: SeededDefectId[] = [];
  if (
    policyCase.input.finalSale &&
    policyCase.input.promotionalPurchase &&
    policyCase.input.managerApproved &&
    expected.decision === "DENY" &&
    actual.decision === "ALLOW"
  ) {
    defectIds.push("FINAL_SALE_PRECEDENCE");
  }
  if (
    !policyCase.input.finalSale &&
    policyCase.input.daysSincePurchase === 14 &&
    expected.decision !== "DENY" &&
    actual.decision === "DENY"
  ) {
    defectIds.push("DAY_14_INCLUSIVE");
  }
  if (
    !policyCase.input.finalSale &&
    policyCase.input.usageBasisPoints === 2000 &&
    expected.decision !== "DENY" &&
    actual.decision === "DENY"
  ) {
    defectIds.push("USAGE_2000_INCLUSIVE");
  }
  if (
    !policyCase.input.finalSale &&
    policyCase.input.promotionalPurchase &&
    policyCase.input.managerApproved &&
    (policyCase.input.daysSincePurchase > 14 || policyCase.input.usageBasisPoints > 2000) &&
    expected.decision === "DENY" &&
    actual.decision === "ALLOW"
  ) {
    defectIds.push("PROMOTION_ELIGIBILITY_BYPASS");
  }
  return defectIds.length > 0 ? defectIds : ["UNCLASSIFIED"];
}

function clusterDefects(records: readonly DifferentialRecord[]): DefectCluster[] {
  const order: SeededDefectId[] = [
    "DAY_14_INCLUSIVE",
    "USAGE_2000_INCLUSIVE",
    "FINAL_SALE_PRECEDENCE",
    "PROMOTION_ELIGIBILITY_BYPASS",
    "UNCLASSIFIED",
  ];
  return order.flatMap((defectId) => {
    const witnessCaseIds = records
      .filter((record) => record.defectIds.includes(defectId))
      .map((record) => record.caseId);
    return witnessCaseIds.length === 0
      ? []
      : [{ defectId, recordCount: witnessCaseIds.length, witnessCaseIds }];
  });
}

export function runDifferentialCases(
  policyValue: unknown,
  cases: readonly PolicyCase[],
  adapterId: string,
  evaluateApplication: ApplicationEvaluator,
): DifferentialReport {
  const policy: PolicyIR = parsePolicyIR(policyValue);
  const records = cases.map((policyCase): DifferentialRecord => {
    const expected = evaluatePolicyIRReference(policy, policyCase.input);
    try {
      const actual = normalizeApplicationResult(evaluateApplication(policyCase.input, policyCase));
      const status = actual.decision === expected.decision ? "MATCH" : "DRIFT";
      return {
        caseId: policyCase.id,
        input: structuredClone(policyCase.input),
        expected,
        actual,
        relatedClauseIds: [...policyCase.relatedClauseIds],
        relatedRuleIds: [...policyCase.relatedRuleIds],
        status,
        defectIds: status === "DRIFT" ? identifyDefects(policyCase, expected, actual) : [],
      };
    } catch (error) {
      return {
        caseId: policyCase.id,
        input: structuredClone(policyCase.input),
        expected,
        actual: null,
        relatedClauseIds: [...policyCase.relatedClauseIds],
        relatedRuleIds: [...policyCase.relatedRuleIds],
        status: "ERROR",
        defectIds: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    schemaVersion: "1",
    executionMode: "REFERENCE_EXPECTATION_NOT_OPA",
    adapterId,
    total: records.length,
    matches: records.filter((record) => record.status === "MATCH").length,
    drifts: records.filter((record) => record.status === "DRIFT").length,
    errors: records.filter((record) => record.status === "ERROR").length,
    records,
    defectClusters: clusterDefects(records),
  };
}
