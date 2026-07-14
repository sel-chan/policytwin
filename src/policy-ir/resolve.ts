import type { PolicyCase } from "../domain/cases.js";
import { findGoldenContradictions, type GoldenContradiction } from "./evaluate.js";
import type { PolicyIR, PolicyPatch, Predicate } from "./types.js";
import { parsePolicyIR } from "./validate.js";

export interface PolicyDecisionRecord {
  id: string;
  policyId: string;
  fromVersion: number;
  toVersion: number;
  ambiguityId: string;
  selectedOptionId: string;
  policyPatch: PolicyPatch;
  decidedAt: string;
}

export interface PolicyResolutionResult {
  policy: PolicyIR;
  decisionRecord: PolicyDecisionRecord | null;
  idempotent: boolean;
}

export class PolicyResolutionError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_AMBIGUITY"
      | "UNKNOWN_OPTION"
      | "INVALID_PATCH_TARGET"
      | "INVALID_DECISION_TIME"
      | "GOLDEN_CONTRADICTION",
    message: string,
    readonly contradictions: GoldenContradiction[] = [],
  ) {
    super(message);
    this.name = "PolicyResolutionError";
  }
}

function replaceBoundaryOperator(
  predicate: Predicate,
  field: string,
  operator: "lt" | "lte" | "gt" | "gte",
): { predicate: Predicate; replacements: number } {
  if (predicate.type === "compare") {
    return predicate.field === field
      ? { predicate: { ...predicate, operator }, replacements: 1 }
      : { predicate, replacements: 0 };
  }
  if (predicate.type === "in") {
    return { predicate, replacements: 0 };
  }
  if (predicate.type === "not") {
    const replaced = replaceBoundaryOperator(predicate.child, field, operator);
    return {
      predicate: replaced.replacements === 0 ? predicate : { ...predicate, child: replaced.predicate },
      replacements: replaced.replacements,
    };
  }

  let replacements = 0;
  const children = predicate.children.map((child) => {
    const replaced = replaceBoundaryOperator(child, field, operator);
    replacements += replaced.replacements;
    return replaced.predicate;
  });
  return {
    predicate: replacements === 0 ? predicate : { ...predicate, children },
    replacements,
  };
}

function applyPatch(policy: PolicyIR, patch: PolicyPatch): void {
  if (patch.op === "SET_NORMALIZATION") {
    if (patch.field === "purchaseDayIndex") {
      policy.normalization.purchaseDayIndex = patch.value;
    } else {
      policy.normalization.usageMeasuredAt = patch.value;
    }
    return;
  }

  if (patch.op === "SET_BOUNDARY_OPERATOR") {
    const rule = policy.rules.find((candidate) => candidate.id === patch.ruleId);
    if (!rule) {
      throw new PolicyResolutionError(
        "INVALID_PATCH_TARGET",
        `Boundary rule does not exist: ${patch.ruleId}`,
      );
    }
    const replaced = replaceBoundaryOperator(rule.when, patch.field, patch.value);
    if (replaced.replacements !== 1) {
      throw new PolicyResolutionError(
        "INVALID_PATCH_TARGET",
        `Boundary target must resolve exactly once; got ${replaced.replacements}.`,
      );
    }
    rule.when = replaced.predicate;
    return;
  }

  if (patch.op === "SET_RULE_DECISION") {
    const rule = policy.rules.find((candidate) => candidate.id === patch.ruleId);
    if (!rule) {
      throw new PolicyResolutionError(
        "INVALID_PATCH_TARGET",
        `Decision rule does not exist: ${patch.ruleId}`,
      );
    }
    rule.decision = patch.value;
    return;
  }

  if (patch.op === "SET_PRECEDENCE") {
    const higherRule = policy.rules.find((candidate) => candidate.id === patch.higherRuleId);
    const lowerRule = policy.rules.find((candidate) => candidate.id === patch.lowerRuleId);
    if (!higherRule || !lowerRule || higherRule.id === lowerRule.id) {
      throw new PolicyResolutionError(
        "INVALID_PATCH_TARGET",
        "Precedence patch must reference two different existing rules.",
      );
    }
    if (higherRule.priority <= lowerRule.priority) {
      const higherPriority = lowerRule.priority;
      lowerRule.priority = higherRule.priority;
      higherRule.priority = higherPriority;
    }
    return;
  }

  policy.defaultDecision = patch.value;
}

export function resolvePolicyAmbiguity(
  policyValue: unknown,
  ambiguityId: string,
  selectedOptionId: string,
  goldenCases: readonly PolicyCase[],
  decidedAt = new Date().toISOString(),
): PolicyResolutionResult {
  if (Number.isNaN(Date.parse(decidedAt))) {
    throw new PolicyResolutionError(
      "INVALID_DECISION_TIME",
      "Decision time must be an ISO-compatible timestamp.",
    );
  }
  const policy = parsePolicyIR(policyValue);
  const ambiguity = policy.ambiguities.find((candidate) => candidate.id === ambiguityId);
  if (!ambiguity) {
    throw new PolicyResolutionError("UNKNOWN_AMBIGUITY", `Unknown ambiguity: ${ambiguityId}`);
  }
  const option = ambiguity.options.find((candidate) => candidate.id === selectedOptionId);
  if (!option) {
    throw new PolicyResolutionError("UNKNOWN_OPTION", `Unknown option: ${selectedOptionId}`);
  }
  if (ambiguity.status === "RESOLVED" && ambiguity.selectedOptionId === selectedOptionId) {
    return { policy, decisionRecord: null, idempotent: true };
  }

  const nextPolicy = structuredClone(policy);
  const nextAmbiguity = nextPolicy.ambiguities.find((candidate) => candidate.id === ambiguityId);
  if (!nextAmbiguity) {
    throw new PolicyResolutionError("UNKNOWN_AMBIGUITY", `Unknown ambiguity: ${ambiguityId}`);
  }
  applyPatch(nextPolicy, structuredClone(option.policyPatch));
  nextAmbiguity.status = "RESOLVED";
  nextAmbiguity.selectedOptionId = selectedOptionId;
  nextPolicy.version = policy.version + 1;
  nextPolicy.id = `${policy.policyId}-v${nextPolicy.version}`;

  const validatedPolicy = parsePolicyIR(nextPolicy);
  const contradictions = findGoldenContradictions(validatedPolicy, goldenCases);
  if (contradictions.length > 0) {
    throw new PolicyResolutionError(
      "GOLDEN_CONTRADICTION",
      `Decision contradicts ${contradictions.length} authoritative golden case(s).`,
      contradictions,
    );
  }

  const decisionRecord: PolicyDecisionRecord = {
    id: `decision-${policy.policyId}-v${validatedPolicy.version}-${ambiguityId}`,
    policyId: policy.policyId,
    fromVersion: policy.version,
    toVersion: validatedPolicy.version,
    ambiguityId,
    selectedOptionId,
    policyPatch: structuredClone(option.policyPatch),
    decidedAt: new Date(decidedAt).toISOString(),
  };
  return { policy: validatedPolicy, decisionRecord, idempotent: false };
}
