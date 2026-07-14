import type { PolicyCase } from "../domain/cases.js";
import { assertSafeRelativePath } from "../codex/safety.js";
import type { PolicyIR } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";
import type { CodeMapping } from "../impact/types.js";

export const SEEDED_REFUND_CODE_MAPPINGS: readonly CodeMapping[] = [
  { id: "code-day-window", file: "src/refund.ts", lineStart: 13, lineEnd: 13, symbol: "withinWindow", ruleIds: ["promotion-approved", "promotion-review", "refund-eligible"] },
  { id: "code-usage-window", file: "src/refund.ts", lineStart: 14, lineEnd: 14, symbol: "withinUsage", ruleIds: ["promotion-approved", "promotion-review", "refund-eligible"] },
  { id: "code-promotion-approved", file: "src/refund.ts", lineStart: 16, lineEnd: 18, symbol: "decideRefund", ruleIds: ["promotion-approved"] },
  { id: "code-final-sale", file: "src/refund.ts", lineStart: 20, lineEnd: 22, symbol: "decideRefund", ruleIds: ["final-sale-deny"] },
  { id: "code-promotion-review", file: "src/refund.ts", lineStart: 28, lineEnd: 30, symbol: "decideRefund", ruleIds: ["promotion-review"] },
  { id: "code-standard-allow", file: "src/refund.ts", lineStart: 32, lineEnd: 32, symbol: "decideRefund", ruleIds: ["refund-eligible"] }
];

export interface TraceabilityReport {
  schemaVersion: "1";
  policyVersion: number;
  clauses: Array<{ clauseId: string; ruleIds: string[]; caseIds: string[] }>;
  rules: Array<{ ruleId: string; clauseIds: string[]; caseIds: string[]; codeLocationIds: string[] }>;
  cases: Array<{ caseId: string; clauseIds: string[]; ruleIds: string[]; invalidClauseIds: string[]; invalidRuleIds: string[] }>;
  codeLocations: CodeMapping[];
  metrics: {
    clausesCovered: number;
    clausesTotal: number;
    rulesCovered: number;
    rulesTotal: number;
    casesLinked: number;
    casesTotal: number;
    unlinkedCodeLocations: number;
  };
  gaps: {
    uncoveredClauseIds: string[];
    uncoveredRuleIds: string[];
    invalidCaseLinks: string[];
    unlinkedCodeLocationIds: string[];
  };
}

export function buildTraceabilityReport(
  policyValue: unknown,
  cases: readonly PolicyCase[],
  mappings: readonly CodeMapping[],
): TraceabilityReport {
  const policy: PolicyIR = parsePolicyIR(policyValue);
  const clauseIds = new Set(policy.clauses.map((clause) => clause.id));
  const ruleIds = new Set(policy.rules.map((rule) => rule.id));
  const codeLocations = mappings.map((mapping) => {
    const file = assertSafeRelativePath(mapping.file, `code mapping ${mapping.id}`);
    if (mapping.lineStart < 1 || mapping.lineEnd < mapping.lineStart) {
      throw new Error(`Code mapping ${mapping.id} has invalid line bounds.`);
    }
    const unknownRules = mapping.ruleIds.filter((ruleId) => !ruleIds.has(ruleId));
    if (unknownRules.length > 0) {
      throw new Error(`Code mapping ${mapping.id} references unknown rules: ${unknownRules.join(", ")}`);
    }
    return { ...structuredClone(mapping), file };
  });
  const caseRows = cases.map((policyCase) => {
    const invalidClauseIds = policyCase.relatedClauseIds.filter((id) => !clauseIds.has(id));
    const invalidRuleIds = policyCase.relatedRuleIds.filter((id) => !ruleIds.has(id));
    return {
      caseId: policyCase.id,
      clauseIds: [...policyCase.relatedClauseIds],
      ruleIds: [...policyCase.relatedRuleIds],
      invalidClauseIds,
      invalidRuleIds,
    };
  });
  const clauses = policy.clauses.map((clause) => ({
    clauseId: clause.id,
    ruleIds: policy.rules.filter((rule) => rule.sourceClauseIds.includes(clause.id)).map((rule) => rule.id),
    caseIds: cases.filter((policyCase) => policyCase.relatedClauseIds.includes(clause.id)).map((policyCase) => policyCase.id),
  }));
  const rules = policy.rules.map((rule) => ({
    ruleId: rule.id,
    clauseIds: [...rule.sourceClauseIds],
    caseIds: cases.filter((policyCase) => policyCase.relatedRuleIds.includes(rule.id)).map((policyCase) => policyCase.id),
    codeLocationIds: codeLocations.filter((mapping) => mapping.ruleIds.includes(rule.id)).map((mapping) => mapping.id),
  }));
  const uncoveredClauseIds = clauses.filter((item) => item.ruleIds.length === 0 || item.caseIds.length === 0).map((item) => item.clauseId);
  const uncoveredRuleIds = rules.filter((item) => item.caseIds.length === 0 || item.codeLocationIds.length === 0).map((item) => item.ruleId);
  const invalidCaseLinks = caseRows
    .filter(
      (item) =>
        item.clauseIds.length === 0 ||
        item.invalidClauseIds.length > 0 ||
        item.invalidRuleIds.length > 0,
    )
    .map((item) => item.caseId);
  const unlinkedCodeLocationIds = codeLocations.filter((mapping) => mapping.ruleIds.length === 0).map((mapping) => mapping.id);
  return {
    schemaVersion: "1",
    policyVersion: policy.version,
    clauses,
    rules,
    cases: caseRows,
    codeLocations,
    metrics: {
      clausesCovered: clauses.length - uncoveredClauseIds.length,
      clausesTotal: clauses.length,
      rulesCovered: rules.length - uncoveredRuleIds.length,
      rulesTotal: rules.length,
      casesLinked: caseRows.length - invalidCaseLinks.length,
      casesTotal: caseRows.length,
      unlinkedCodeLocations: unlinkedCodeLocationIds.length,
    },
    gaps: { uncoveredClauseIds, uncoveredRuleIds, invalidCaseLinks, unlinkedCodeLocationIds },
  };
}
