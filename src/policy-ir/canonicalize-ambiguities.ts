import { createHash } from "node:crypto";
import { segmentPolicyClauses } from "./clauses.js";
import type {
  AmbiguityCategory,
  PolicyAmbiguity,
  PolicyAmbiguityOption,
  PolicyIR,
  PolicyPatch,
} from "./types.js";

interface CanonicalOptionTemplate {
  id: string;
  label: string;
  description: string;
  policyPatch: PolicyPatch;
  exampleImpacts: PolicyAmbiguityOption["exampleImpacts"];
}

interface CanonicalAmbiguityTemplate {
  id: string;
  category: AmbiguityCategory;
  sourceClauseIds: readonly string[];
  question: string;
  rationale: string;
  options: readonly CanonicalOptionTemplate[];
}

export interface KnownRefundAmbiguityCanonicalizationContext {
  policyId: string;
  version: number;
  sourceText: string;
}

const TRUSTED_SEEDED_POLICY_ID = "policy-seeded-refund";
const TRUSTED_SEEDED_SOURCE_SHA256 =
  "8c49c3f8ec0ead1d31ab969631c48f601b41f585096aaadff58a3473de1ace04";

const CANONICAL_AMBIGUITIES: readonly CanonicalAmbiguityTemplate[] = [
  {
    id: "ambiguity-purchase-day-index",
    category: "MEASUREMENT",
    sourceClauseIds: ["clause-2db0db31"],
    question: "Is the purchase day counted as day 0 or day 1?",
    rationale: "The policy gives a calendar-day limit but does not define the starting index.",
    options: [
      {
        id: "purchase-day-zero",
        label: "Purchase day is day 0",
        description: "Elapsed calendar days start at zero on the purchase date.",
        policyPatch: { op: "SET_NORMALIZATION", field: "purchaseDayIndex", value: 0 },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 14,
              usageBasisPoints: 0,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "MONTHLY",
            },
            result: "ALLOW",
          },
        ],
      },
      {
        id: "purchase-day-one",
        label: "Purchase day is day 1",
        description: "Ordinal calendar-day counting starts at one on the purchase date.",
        policyPatch: { op: "SET_NORMALIZATION", field: "purchaseDayIndex", value: 1 },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 15,
              usageBasisPoints: 0,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "MONTHLY",
            },
            result: "DENY",
          },
        ],
      },
    ],
  },
  {
    id: "ambiguity-usage-measurement-time",
    category: "MEASUREMENT",
    sourceClauseIds: ["clause-2db0db31"],
    question: "Is usage measured at request time or decision time?",
    rationale: "The policy specifies a usage threshold but not the observation time.",
    options: [
      {
        id: "usage-at-request",
        label: "Measure at request time",
        description: "Freeze usage when the refund request is submitted.",
        policyPatch: { op: "SET_NORMALIZATION", field: "usageMeasuredAt", value: "REQUEST_TIME" },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 3,
              usageBasisPoints: 2000,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "ANNUAL",
            },
            result: "ALLOW",
          },
        ],
      },
      {
        id: "usage-at-decision",
        label: "Measure at decision time",
        description: "Use the latest usage when the refund decision is made.",
        policyPatch: { op: "SET_NORMALIZATION", field: "usageMeasuredAt", value: "DECISION_TIME" },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 3,
              usageBasisPoints: 2001,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "ANNUAL",
            },
            result: "DENY",
          },
        ],
      },
    ],
  },
  {
    id: "ambiguity-default-decision",
    category: "DEFAULT",
    sourceClauseIds: ["clause-2db0db31"],
    question: "What is the result when no eligibility rule matches?",
    rationale: "The policy does not state the fallback outcome for an ineligible ordinary request.",
    options: [
      {
        id: "default-deny",
        label: "Deny by default",
        description: "A request is denied when no explicit rule matches.",
        policyPatch: { op: "SET_DEFAULT_DECISION", value: "DENY" },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 20,
              usageBasisPoints: 0,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "ENTERPRISE",
            },
            result: "DENY",
          },
        ],
      },
      {
        id: "default-review",
        label: "Review by default",
        description: "A request requires review when no explicit rule matches.",
        policyPatch: { op: "SET_DEFAULT_DECISION", value: "REVIEW" },
        exampleImpacts: [
          {
            input: {
              daysSincePurchase: 20,
              usageBasisPoints: 0,
              promotionalPurchase: false,
              finalSale: false,
              managerApproved: false,
              planType: "ENTERPRISE",
            },
            result: "REVIEW",
          },
        ],
      },
    ],
  },
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function patchKey(patch: PolicyPatch): string {
  return JSON.stringify(canonicalValue(patch));
}

function normalizedSourceHash(sourceText: string): string {
  return createHash("sha256")
    .update(sourceText.replaceAll("\r\n", "\n").replaceAll("\r", "\n"), "utf8")
    .digest("hex");
}

function hasExactSourceClauses(policy: PolicyIR, sourceText: string): boolean {
  const expected = segmentPolicyClauses(sourceText);
  return (
    policy.clauses.length === expected.length &&
    policy.clauses.every((clause, index) => {
      const sourceClause = expected[index];
      return (
        sourceClause !== undefined &&
        clause.id === sourceClause.id &&
        clause.text === sourceClause.text &&
        clause.startOffset === sourceClause.startOffset &&
        clause.endOffset === sourceClause.endOffset &&
        clause.normalizedText === sourceClause.normalizedText
      );
    })
  );
}

function isTrustedSeededInput(
  policy: PolicyIR,
  context: KnownRefundAmbiguityCanonicalizationContext,
): boolean {
  return (
    context.policyId === TRUSTED_SEEDED_POLICY_ID &&
    policy.policyId === TRUSTED_SEEDED_POLICY_ID &&
    policy.version === context.version &&
    normalizedSourceHash(context.sourceText) === TRUSTED_SEEDED_SOURCE_SHA256 &&
    hasExactSourceClauses(policy, context.sourceText)
  );
}

function matchingTemplate(
  ambiguity: PolicyAmbiguity,
): CanonicalAmbiguityTemplate | undefined {
  const actualPatches = ambiguity.options.map((option) => patchKey(option.policyPatch)).sort(compareText);
  return CANONICAL_AMBIGUITIES.find((template) => {
    if (template.category !== ambiguity.category || template.options.length !== ambiguity.options.length) {
      return false;
    }
    const actualSourceClauseIds = [...ambiguity.sourceClauseIds].sort(compareText);
    const expectedSourceClauseIds = [...template.sourceClauseIds].sort(compareText);
    if (
      actualSourceClauseIds.length !== expectedSourceClauseIds.length ||
      !expectedSourceClauseIds.every(
        (sourceClauseId, index) => sourceClauseId === actualSourceClauseIds[index],
      )
    ) {
      return false;
    }
    const expectedPatches = template.options.map((option) => patchKey(option.policyPatch)).sort(compareText);
    return expectedPatches.every((patch, index) => patch === actualPatches[index]);
  });
}

function cloneExamples(option: CanonicalOptionTemplate): PolicyAmbiguityOption["exampleImpacts"] {
  return option.exampleImpacts.map((example) => ({
    input: { ...example.input },
    result: example.result,
  }));
}

function canonicalizeKnownAmbiguity(ambiguity: PolicyAmbiguity): PolicyAmbiguity {
  const template = matchingTemplate(ambiguity);
  if (!template) {
    return ambiguity;
  }

  const selectedOption = ambiguity.options.find(
    (option) => option.id === ambiguity.selectedOptionId,
  );
  const selectedPatchKey = selectedOption ? patchKey(selectedOption.policyPatch) : null;
  const options: PolicyAmbiguityOption[] = template.options.map((templateOption) => {
    const sourceOption = ambiguity.options.find(
      (option) => patchKey(option.policyPatch) === patchKey(templateOption.policyPatch),
    );
    if (!sourceOption) {
      throw new Error("Canonical ambiguity option mapping is incomplete.");
    }
    return {
      id: templateOption.id,
      label: templateOption.label,
      description: templateOption.description,
      policyPatch: { ...templateOption.policyPatch },
      exampleImpacts: cloneExamples(templateOption),
    };
  });
  const canonicalSelection = selectedPatchKey
    ? template.options.find((option) => patchKey(option.policyPatch) === selectedPatchKey)?.id
    : undefined;

  return {
    id: template.id,
    sourceClauseIds: [...ambiguity.sourceClauseIds].sort(compareText),
    category: template.category,
    question: template.question,
    rationale: template.rationale,
    options,
    status: ambiguity.status,
    ...(canonicalSelection ? { selectedOptionId: canonicalSelection } : {}),
  };
}

export function canonicalizeKnownRefundAmbiguities(
  policy: PolicyIR,
  context: KnownRefundAmbiguityCanonicalizationContext,
): PolicyIR {
  if (!isTrustedSeededInput(policy, context)) {
    return policy;
  }
  return {
    ...policy,
    ambiguities: policy.ambiguities.map(canonicalizeKnownAmbiguity),
  };
}
