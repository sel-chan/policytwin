import type { PolicyCase, CaseSource } from "../domain/cases.js";
import { parseRefundPolicyInput, type RefundPolicyInput } from "../domain/refund.js";
import { evaluatePolicyIRReference, findGoldenContradictions } from "../policy-ir/evaluate.js";
import { assertPolicyReadyToCompile } from "../policy-ir/state.js";
import type { PolicyIR } from "../policy-ir/types.js";
import { parsePolicyIR } from "../policy-ir/validate.js";

export class CaseGenerationError extends Error {
  constructor(
    readonly code:
      | "GOLDEN_CONTRADICTION"
      | "REQUIRED_CASE_CONTRADICTION"
      | "DUPLICATE_GOLDEN_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CaseGenerationError";
  }
}

export function canonicalRefundInputKey(input: RefundPolicyInput): string {
  return [
    input.daysSincePurchase,
    input.usageBasisPoints,
    input.promotionalPurchase ? 1 : 0,
    input.finalSale ? 1 : 0,
    input.managerApproved ? 1 : 0,
    input.planType,
  ].join("|");
}

function stableCaseHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

interface CaseCandidate {
  title: string;
  source: Exclude<CaseSource, "USER_GOLDEN">;
  input: RefundPolicyInput;
  rationale: string;
}

function collectNumericThresholds(
  predicate: PolicyIR["rules"][number]["when"],
  field: "daysSincePurchase" | "usageBasisPoints",
): number[] {
  if (predicate.type === "compare") {
    return predicate.field === field &&
      typeof predicate.value === "number" &&
      ["lt", "lte", "gt", "gte"].includes(predicate.operator)
      ? [predicate.value]
      : [];
  }
  if (predicate.type === "not") {
    return collectNumericThresholds(predicate.child, field);
  }
  if (predicate.type === "in") {
    return [];
  }
  return predicate.children.flatMap((child) => collectNumericThresholds(child, field));
}

function thresholdValues(policy: PolicyIR, field: "daysSincePurchase" | "usageBasisPoints"): number[] {
  const values = [
    ...new Set(policy.rules.flatMap((rule) => collectNumericThresholds(rule.when, field))),
  ].sort((left, right) => left - right);
  if (values.length === 0) {
    throw new Error(`Accepted policy has no numeric threshold for ${field}.`);
  }
  return values;
}

function thresholdNeighbors(values: readonly number[]): number[] {
  return [
    ...new Set(values.flatMap((value) => [Math.max(0, value - 1), value, value + 1])),
  ].sort((left, right) => left - right);
}

function generatedCandidates(policy: PolicyIR): CaseCandidate[] {
  const candidates: CaseCandidate[] = [];
  const dayThresholds = thresholdValues(policy, "daysSincePurchase");
  const usageThresholds = thresholdValues(policy, "usageBasisPoints");
  const days = thresholdNeighbors(dayThresholds);
  const usages = thresholdNeighbors(usageThresholds);
  const base = {
    promotionalPurchase: false,
    finalSale: false,
    managerApproved: false,
    planType: "MONTHLY" as const,
  };

  for (const daysSincePurchase of days) {
    for (const usageBasisPoints of usages) {
      candidates.push({
        title: `Standard boundary d${daysSincePurchase} u${usageBasisPoints}`,
        source: "BOUNDARY",
        input: { ...base, daysSincePurchase, usageBasisPoints },
        rationale: "Cross-product of exact numeric threshold neighbors.",
      });
      for (const managerApproved of [false, true]) {
        candidates.push({
          title: `Promotion contrast d${daysSincePurchase} u${usageBasisPoints} approved ${managerApproved}`,
          source: "MINIMAL_CONTRAST",
          input: {
            ...base,
            daysSincePurchase,
            usageBasisPoints,
            promotionalPurchase: true,
            managerApproved,
          },
          rationale: "Pairs promotion approval states at numeric threshold neighbors.",
        });
      }
    }
  }

  const exactDay = Math.max(...dayThresholds);
  const exactUsage = Math.max(...usageThresholds);
  for (const promotionalPurchase of [false, true]) {
    for (const managerApproved of [false, true]) {
      candidates.push({
        title: `Final-sale conflict promo ${promotionalPurchase} approved ${managerApproved}`,
        source: "CONFLICT",
        input: {
          daysSincePurchase: exactDay,
          usageBasisPoints: exactUsage,
          promotionalPurchase,
          finalSale: true,
          managerApproved,
          planType: "MONTHLY",
        },
        rationale: "Exercises final-sale precedence over every otherwise eligible state.",
      });
    }
  }

  candidates.push({
    title: "No-match accepted default",
    source: "GENERATED",
    input: {
      daysSincePurchase: exactDay + 16,
      usageBasisPoints: Math.min(500, exactUsage),
      promotionalPurchase: false,
      finalSale: false,
      managerApproved: false,
      planType: "ENTERPRISE",
    },
    rationale: "No explicit eligibility rule matches, so the accepted default applies.",
  });
  return candidates;
}

export function generateAcceptedCaseCorpus(
  policyValue: unknown,
  goldenCases: readonly PolicyCase[],
  requiredCases: readonly PolicyCase[] = [],
): PolicyCase[] {
  const policy = parsePolicyIR(policyValue);
  assertPolicyReadyToCompile(policy);
  const contradictions = findGoldenContradictions(policy, goldenCases);
  if (contradictions.length > 0) {
    throw new CaseGenerationError(
      "GOLDEN_CONTRADICTION",
      `Accepted policy contradicts ${contradictions.length} golden case(s).`,
    );
  }

  const cases: PolicyCase[] = [];
  const byInput = new Map<string, PolicyCase>();
  for (const golden of goldenCases) {
    const input = parseRefundPolicyInput(golden.input);
    const key = canonicalRefundInputKey(input);
    const existing = byInput.get(key);
    if (existing && existing.expectedDecision !== golden.expectedDecision) {
      throw new CaseGenerationError(
        "DUPLICATE_GOLDEN_CONFLICT",
        `Golden cases ${existing.id} and ${golden.id} conflict for the same input.`,
      );
    }
    if (!existing) {
      const acceptedGolden = { ...structuredClone(golden), input };
      cases.push(acceptedGolden);
      byInput.set(key, acceptedGolden);
    }
  }

  const requiredContradictions = findGoldenContradictions(policy, requiredCases);
  if (requiredContradictions.length > 0) {
    throw new CaseGenerationError(
      "REQUIRED_CASE_CONTRADICTION",
      `Accepted policy contradicts ${requiredContradictions.length} required case(s).`,
    );
  }
  for (const requiredCase of requiredCases) {
    const input = parseRefundPolicyInput(requiredCase.input);
    const key = canonicalRefundInputKey(input);
    if (!byInput.has(key)) {
      const acceptedCase = { ...structuredClone(requiredCase), input };
      cases.push(acceptedCase);
      byInput.set(key, acceptedCase);
    }
  }

  for (const candidate of generatedCandidates(policy)) {
    const input = parseRefundPolicyInput(candidate.input);
    const key = canonicalRefundInputKey(input);
    if (byInput.has(key)) {
      continue;
    }
    const result = evaluatePolicyIRReference(policy, input);
    const matchedRule = result.matchedRuleId
      ? policy.rules.find((rule) => rule.id === result.matchedRuleId)
      : undefined;
    const defaultAmbiguity = policy.ambiguities.find(
      (ambiguity) => ambiguity.category === "DEFAULT" && ambiguity.status === "RESOLVED",
    );
    const policyCase: PolicyCase = {
      id: `C-${candidate.source}-${stableCaseHash(key)}`,
      title: candidate.title,
      input,
      expectedDecision: result.decision,
      source: candidate.source,
      relatedRuleIds: matchedRule ? [matchedRule.id] : [],
      relatedClauseIds: matchedRule
        ? [...matchedRule.sourceClauseIds]
        : [...(defaultAmbiguity?.sourceClauseIds ?? [])],
      rationale: candidate.rationale,
    };
    cases.push(policyCase);
    byInput.set(key, policyCase);
  }
  return cases;
}
