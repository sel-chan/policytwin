import { isDecision } from "../domain/decision.js";
import { PLAN_TYPES, validateRefundPolicyInput } from "../domain/refund.js";
import { REFUND_INPUT_SCHEMA_V1 } from "../domain/refund-schema.js";
import { PolicyIRStructureSchema } from "./zod-schema.js";
import type {
  AmbiguityCategory,
  PolicyIR,
  PolicyPatch,
  PolicyRule,
  Predicate,
  RefundInputField,
} from "./types.js";

export interface PolicyIRValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type PolicyIRValidationResult =
  | { success: true; data: PolicyIR }
  | { success: false; issues: PolicyIRValidationIssue[] };

const INPUT_FIELDS = [
  "daysSincePurchase",
  "usageBasisPoints",
  "promotionalPurchase",
  "finalSale",
  "managerApproved",
  "planType",
] as const;
const NUMERIC_FIELDS = new Set<RefundInputField>(["daysSincePurchase", "usageBasisPoints"]);
const BOOLEAN_FIELDS = new Set<RefundInputField>([
  "promotionalPurchase",
  "finalSale",
  "managerApproved",
]);
const COMPARE_OPERATORS = new Set(["eq", "neq", "lt", "lte", "gt", "gte"]);
const AMBIGUITY_CATEGORIES = new Set([
  "BOUNDARY",
  "PRECEDENCE",
  "DEFAULT",
  "MEASUREMENT",
  "MISSING_OUTCOME",
  "OTHER",
]);
const EXPECTED_PATCH_BY_CATEGORY: Partial<Record<AmbiguityCategory, PolicyPatch["op"]>> = {
  BOUNDARY: "SET_BOUNDARY_OPERATOR",
  PRECEDENCE: "SET_PRECEDENCE",
  DEFAULT: "SET_DEFAULT_DECISION",
  MEASUREMENT: "SET_NORMALIZATION",
  MISSING_OUTCOME: "SET_RULE_DECISION",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item));
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      items.sort();
    }
    return `[${items.join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function issue(
  issues: PolicyIRValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function schemaIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    const name = String(segment);
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)
      ? `${result}.${name}`
      : `${result}[${JSON.stringify(name)}]`;
  }, "$");
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: PolicyIRValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issue(issues, `${path}.${key}`, "UNKNOWN_FIELD", `${key} is not allowed.`);
    }
  }
}

function requireString(
  value: unknown,
  path: string,
  issues: PolicyIRValidationIssue[],
): value is string {
  if (typeof value !== "string" || value.length === 0) {
    issue(issues, path, "INVALID_STRING", `${path} must be a non-empty string.`);
    return false;
  }
  return true;
}

function requireInteger(
  value: unknown,
  path: string,
  issues: PolicyIRValidationIssue[],
  minimum = 0,
): value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    issue(issues, path, "INVALID_INTEGER", `${path} must be an integer >= ${minimum}.`);
    return false;
  }
  return true;
}

function validateScalarForField(
  field: RefundInputField,
  value: unknown,
  path: string,
  issues: PolicyIRValidationIssue[],
): boolean {
  if (NUMERIC_FIELDS.has(field)) {
    return requireInteger(value, path, issues);
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value !== "boolean") {
      issue(issues, path, "INVALID_SCALAR", `${path} must be boolean for ${field}.`);
      return false;
    }
    return true;
  }
  if (typeof value !== "string" || !PLAN_TYPES.includes(value as (typeof PLAN_TYPES)[number])) {
    issue(issues, path, "INVALID_SCALAR", `${path} must be a supported plan type.`);
    return false;
  }
  return true;
}

function validatePredicate(
  value: unknown,
  path: string,
  issues: PolicyIRValidationIssue[],
): value is Predicate {
  if (!isRecord(value)) {
    issue(issues, path, "INVALID_PREDICATE", "Predicate must be an object.");
    return false;
  }
  if (typeof value.type !== "string") {
    issue(issues, `${path}.type`, "INVALID_PREDICATE", "Predicate type is required.");
    return false;
  }

  if (value.type === "compare") {
    rejectUnknownKeys(value, ["type", "field", "operator", "value"], path, issues);
    if (!INPUT_FIELDS.includes(value.field as (typeof INPUT_FIELDS)[number])) {
      issue(issues, `${path}.field`, "UNKNOWN_INPUT_FIELD", "Comparison field is unsupported.");
      return false;
    }
    const field = value.field as RefundInputField;
    if (!COMPARE_OPERATORS.has(value.operator as string)) {
      issue(issues, `${path}.operator`, "INVALID_OPERATOR", "Comparison operator is unsupported.");
    } else if (!NUMERIC_FIELDS.has(field) && !["eq", "neq"].includes(value.operator as string)) {
      issue(issues, `${path}.operator`, "INVALID_OPERATOR", `${field} supports only eq/neq.`);
    }
    validateScalarForField(field, value.value, `${path}.value`, issues);
    return true;
  }

  if (value.type === "in") {
    rejectUnknownKeys(value, ["type", "field", "values"], path, issues);
    if (!INPUT_FIELDS.includes(value.field as (typeof INPUT_FIELDS)[number])) {
      issue(issues, `${path}.field`, "UNKNOWN_INPUT_FIELD", "Membership field is unsupported.");
      return false;
    }
    if (!Array.isArray(value.values) || value.values.length === 0) {
      issue(issues, `${path}.values`, "INVALID_VALUES", "Membership values must be non-empty.");
      return false;
    }
    value.values.forEach((item, index) =>
      validateScalarForField(
        value.field as RefundInputField,
        item,
        `${path}.values[${index}]`,
        issues,
      ),
    );
    return true;
  }

  if (value.type === "and" || value.type === "or") {
    rejectUnknownKeys(value, ["type", "children"], path, issues);
    if (!Array.isArray(value.children) || value.children.length < 2) {
      issue(issues, `${path}.children`, "INVALID_CHILDREN", "and/or needs at least two children.");
      return false;
    }
    value.children.forEach((child, index) =>
      validatePredicate(child, `${path}.children[${index}]`, issues),
    );
    return true;
  }

  if (value.type === "not") {
    rejectUnknownKeys(value, ["type", "child"], path, issues);
    return validatePredicate(value.child, `${path}.child`, issues);
  }

  issue(issues, `${path}.type`, "INVALID_PREDICATE", `${String(value.type)} is unsupported.`);
  return false;
}

function comparisonCount(predicate: Predicate, field: string): number {
  if (predicate.type === "compare") {
    return predicate.field === field ? 1 : 0;
  }
  if (predicate.type === "in") {
    return 0;
  }
  if (predicate.type === "not") {
    return comparisonCount(predicate.child, field);
  }
  return predicate.children.reduce((total, child) => total + comparisonCount(child, field), 0);
}

function validatePatch(
  value: unknown,
  category: AmbiguityCategory,
  path: string,
  rules: Map<string, PolicyRule>,
  issues: PolicyIRValidationIssue[],
): value is PolicyPatch {
  if (!isRecord(value) || typeof value.op !== "string") {
    issue(issues, path, "INVALID_PATCH", "Policy patch must have a closed operation.");
    return false;
  }
  const expectedOperation = EXPECTED_PATCH_BY_CATEGORY[category];
  if (category === "OTHER") {
    issue(issues, path, "UNSUPPORTED_AMBIGUITY", "OTHER requires a schema-versioned extension.");
  } else if (value.op !== expectedOperation) {
    issue(issues, `${path}.op`, "PATCH_CATEGORY_MISMATCH", `${category} requires ${expectedOperation}.`);
  }

  if (value.op === "SET_NORMALIZATION") {
    rejectUnknownKeys(value, ["op", "field", "value"], path, issues);
    const validPurchaseDay = value.field === "purchaseDayIndex" && [0, 1].includes(value.value as number);
    const validUsageTime =
      value.field === "usageMeasuredAt" &&
      ["REQUEST_TIME", "DECISION_TIME"].includes(value.value as string);
    if (!validPurchaseDay && !validUsageTime) {
      issue(issues, path, "INVALID_PATCH", "Normalization field/value pair is invalid.");
    }
    return true;
  }

  if (value.op === "SET_BOUNDARY_OPERATOR") {
    rejectUnknownKeys(value, ["op", "ruleId", "field", "value"], path, issues);
    const rule = rules.get(value.ruleId as string);
    if (!rule) {
      issue(issues, `${path}.ruleId`, "UNKNOWN_RULE", "Boundary rule does not exist.");
    }
    if (!["daysSincePurchase", "usageBasisPoints"].includes(value.field as string)) {
      issue(issues, `${path}.field`, "INVALID_BOUNDARY_FIELD", "Boundary field is unsupported.");
    }
    if (!["lt", "lte", "gt", "gte"].includes(value.value as string)) {
      issue(issues, `${path}.value`, "INVALID_OPERATOR", "Boundary operator is unsupported.");
    }
    if (rule && comparisonCount(rule.when, value.field as string) !== 1) {
      issue(issues, path, "AMBIGUOUS_BOUNDARY_TARGET", "Boundary target must resolve exactly once.");
    }
    return true;
  }

  if (value.op === "SET_RULE_DECISION") {
    rejectUnknownKeys(value, ["op", "ruleId", "value"], path, issues);
    if (!rules.has(value.ruleId as string)) {
      issue(issues, `${path}.ruleId`, "UNKNOWN_RULE", "Decision rule does not exist.");
    }
    if (!isDecision(value.value)) {
      issue(issues, `${path}.value`, "INVALID_DECISION", "Rule decision is invalid.");
    }
    return true;
  }

  if (value.op === "SET_PRECEDENCE") {
    rejectUnknownKeys(value, ["op", "higherRuleId", "lowerRuleId"], path, issues);
    if (!rules.has(value.higherRuleId as string) || !rules.has(value.lowerRuleId as string)) {
      issue(issues, path, "UNKNOWN_RULE", "Precedence rules must both exist.");
    }
    if (value.higherRuleId === value.lowerRuleId) {
      issue(issues, path, "INVALID_PRECEDENCE", "A rule cannot outrank itself.");
    }
    return true;
  }

  if (value.op === "SET_DEFAULT_DECISION") {
    rejectUnknownKeys(value, ["op", "value"], path, issues);
    if (!isDecision(value.value)) {
      issue(issues, `${path}.value`, "INVALID_DECISION", "Default decision is invalid.");
    }
    return true;
  }

  issue(issues, `${path}.op`, "INVALID_PATCH", `${value.op} is unsupported.`);
  return false;
}

export function validatePolicyIR(value: unknown): PolicyIRValidationResult {
  const issues: PolicyIRValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ path: "$", code: "INVALID_IR", message: "PolicyIR must be an object." }],
    };
  }

  const structuralResult = PolicyIRStructureSchema.safeParse(value);
  if (!structuralResult.success) {
    for (const structuralIssue of structuralResult.error.issues) {
      issue(
        issues,
        schemaIssuePath(structuralIssue.path),
        "SCHEMA_VIOLATION",
        structuralIssue.message,
      );
    }
  }

  rejectUnknownKeys(
    value,
    [
      "id",
      "policyId",
      "version",
      "schemaVersion",
      "domain",
      "clauses",
      "rules",
      "ambiguities",
      "defaultDecision",
      "normalization",
      "inputSchema",
      "metadata",
    ],
    "$",
    issues,
  );
  requireString(value.id, "$.id", issues);
  requireString(value.policyId, "$.policyId", issues);
  requireInteger(value.version, "$.version", issues, 1);
  if (value.schemaVersion !== "1") {
    issue(issues, "$.schemaVersion", "INVALID_SCHEMA_VERSION", "schemaVersion must be 1.");
  }
  if (value.domain !== "saas_refund") {
    issue(issues, "$.domain", "INVALID_DOMAIN", "domain must be saas_refund.");
  }

  const clauseIds = new Set<string>();
  if (!Array.isArray(value.clauses) || value.clauses.length === 0) {
    issue(issues, "$.clauses", "INVALID_CLAUSES", "At least one clause is required.");
  } else {
    value.clauses.forEach((clause, index) => {
      const path = `$.clauses[${index}]`;
      if (!isRecord(clause)) {
        issue(issues, path, "INVALID_CLAUSE", "Clause must be an object.");
        return;
      }
      rejectUnknownKeys(
        clause,
        ["id", "text", "startOffset", "endOffset", "normalizedText"],
        path,
        issues,
      );
      if (requireString(clause.id, `${path}.id`, issues)) {
        if (clauseIds.has(clause.id)) {
          issue(issues, `${path}.id`, "DUPLICATE_ID", "Clause ID must be unique.");
        }
        clauseIds.add(clause.id);
      }
      requireString(clause.text, `${path}.text`, issues);
      requireString(clause.normalizedText, `${path}.normalizedText`, issues);
      const startOffset = clause.startOffset;
      const endOffset = clause.endOffset;
      const startValid = requireInteger(startOffset, `${path}.startOffset`, issues);
      const endValid = requireInteger(endOffset, `${path}.endOffset`, issues);
      if (startValid && endValid && endOffset <= startOffset) {
        issue(issues, path, "INVALID_OFFSETS", "Clause endOffset must exceed startOffset.");
      }
    });
  }

  const rules = new Map<string, PolicyRule>();
  const priorities = new Set<number>();
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    issue(issues, "$.rules", "INVALID_RULES", "At least one rule is required.");
  } else {
    value.rules.forEach((ruleValue, index) => {
      const path = `$.rules[${index}]`;
      if (!isRecord(ruleValue)) {
        issue(issues, path, "INVALID_RULE", "Rule must be an object.");
        return;
      }
      rejectUnknownKeys(
        ruleValue,
        [
          "id",
          "sourceClauseIds",
          "title",
          "description",
          "when",
          "decision",
          "priority",
          "explanationTemplate",
        ],
        path,
        issues,
      );
      const idValid = requireString(ruleValue.id, `${path}.id`, issues);
      requireString(ruleValue.title, `${path}.title`, issues);
      requireString(ruleValue.description, `${path}.description`, issues);
      requireString(ruleValue.explanationTemplate, `${path}.explanationTemplate`, issues);
      if (!Array.isArray(ruleValue.sourceClauseIds) || ruleValue.sourceClauseIds.length === 0) {
        issue(issues, `${path}.sourceClauseIds`, "MISSING_TRACEABILITY", "Rule needs source clauses.");
      } else {
        ruleValue.sourceClauseIds.forEach((clauseId, clauseIndex) => {
          if (typeof clauseId !== "string" || !clauseIds.has(clauseId)) {
            issue(
              issues,
              `${path}.sourceClauseIds[${clauseIndex}]`,
              "UNKNOWN_CLAUSE",
              "Rule references an unknown clause.",
            );
          }
        });
      }
      const predicateValid = validatePredicate(ruleValue.when, `${path}.when`, issues);
      if (!isDecision(ruleValue.decision)) {
        issue(issues, `${path}.decision`, "INVALID_DECISION", "Rule decision is invalid.");
      }
      if (requireInteger(ruleValue.priority, `${path}.priority`, issues)) {
        if (priorities.has(ruleValue.priority)) {
          issue(issues, `${path}.priority`, "DUPLICATE_PRIORITY", "Priorities must be unique.");
        }
        priorities.add(ruleValue.priority);
      }
      if (idValid) {
        if (rules.has(ruleValue.id as string)) {
          issue(issues, `${path}.id`, "DUPLICATE_ID", "Rule ID must be unique.");
        } else if (predicateValid) {
          rules.set(ruleValue.id as string, ruleValue as unknown as PolicyRule);
        }
      }
    });
  }

  if (!Array.isArray(value.ambiguities)) {
    issue(issues, "$.ambiguities", "INVALID_AMBIGUITIES", "ambiguities must be an array.");
  } else {
    const ambiguityIds = new Set<string>();
    value.ambiguities.forEach((ambiguity, index) => {
      const path = `$.ambiguities[${index}]`;
      if (!isRecord(ambiguity)) {
        issue(issues, path, "INVALID_AMBIGUITY", "Ambiguity must be an object.");
        return;
      }
      rejectUnknownKeys(
        ambiguity,
        [
          "id",
          "sourceClauseIds",
          "category",
          "question",
          "rationale",
          "options",
          "status",
          "selectedOptionId",
        ],
        path,
        issues,
      );
      if (requireString(ambiguity.id, `${path}.id`, issues)) {
        if (ambiguityIds.has(ambiguity.id)) {
          issue(issues, `${path}.id`, "DUPLICATE_ID", "Ambiguity ID must be unique.");
        }
        ambiguityIds.add(ambiguity.id);
      }
      requireString(ambiguity.question, `${path}.question`, issues);
      requireString(ambiguity.rationale, `${path}.rationale`, issues);
      if (!AMBIGUITY_CATEGORIES.has(ambiguity.category as string)) {
        issue(issues, `${path}.category`, "INVALID_CATEGORY", "Ambiguity category is invalid.");
      }
      if (!Array.isArray(ambiguity.sourceClauseIds) || ambiguity.sourceClauseIds.length === 0) {
        issue(issues, `${path}.sourceClauseIds`, "MISSING_TRACEABILITY", "Ambiguity needs source clauses.");
      } else {
        ambiguity.sourceClauseIds.forEach((clauseId, clauseIndex) => {
          if (typeof clauseId !== "string" || !clauseIds.has(clauseId)) {
            issue(
              issues,
              `${path}.sourceClauseIds[${clauseIndex}]`,
              "UNKNOWN_CLAUSE",
              "Ambiguity references an unknown clause.",
            );
          }
        });
      }

      const optionIds = new Set<string>();
      if (!Array.isArray(ambiguity.options) || ambiguity.options.length < 2) {
        issue(issues, `${path}.options`, "INVALID_OPTIONS", "Ambiguity needs at least two options.");
      } else {
        ambiguity.options.forEach((option, optionIndex) => {
          const optionPath = `${path}.options[${optionIndex}]`;
          if (!isRecord(option)) {
            issue(issues, optionPath, "INVALID_OPTION", "Option must be an object.");
            return;
          }
          rejectUnknownKeys(
            option,
            ["id", "label", "description", "policyPatch", "exampleImpacts"],
            optionPath,
            issues,
          );
          if (requireString(option.id, `${optionPath}.id`, issues)) {
            if (optionIds.has(option.id)) {
              issue(issues, `${optionPath}.id`, "DUPLICATE_ID", "Option ID must be unique.");
            }
            optionIds.add(option.id);
          }
          requireString(option.label, `${optionPath}.label`, issues);
          requireString(option.description, `${optionPath}.description`, issues);
          validatePatch(
            option.policyPatch,
            ambiguity.category as AmbiguityCategory,
            `${optionPath}.policyPatch`,
            rules,
            issues,
          );
          if (!Array.isArray(option.exampleImpacts) || option.exampleImpacts.length === 0) {
            issue(issues, `${optionPath}.exampleImpacts`, "INVALID_EXAMPLES", "Examples are required.");
          } else {
            option.exampleImpacts.forEach((example, exampleIndex) => {
              const examplePath = `${optionPath}.exampleImpacts[${exampleIndex}]`;
              if (!isRecord(example)) {
                issue(issues, examplePath, "INVALID_EXAMPLE", "Example must be an object.");
                return;
              }
              rejectUnknownKeys(example, ["input", "result"], examplePath, issues);
              const inputResult = validateRefundPolicyInput(example.input);
              if (!inputResult.success) {
                issue(issues, `${examplePath}.input`, "INVALID_INPUT", "Example input is invalid.");
              }
              if (!isDecision(example.result)) {
                issue(issues, `${examplePath}.result`, "INVALID_DECISION", "Example result is invalid.");
              }
            });
          }
        });
      }

      if (!["OPEN", "RESOLVED"].includes(ambiguity.status as string)) {
        issue(issues, `${path}.status`, "INVALID_STATUS", "Ambiguity status is invalid.");
      } else if (ambiguity.status === "OPEN" && ambiguity.selectedOptionId !== undefined) {
        issue(issues, `${path}.selectedOptionId`, "INVALID_SELECTION", "Open ambiguity cannot be selected.");
      } else if (
        ambiguity.status === "RESOLVED" &&
        (typeof ambiguity.selectedOptionId !== "string" || !optionIds.has(ambiguity.selectedOptionId))
      ) {
        issue(issues, `${path}.selectedOptionId`, "INVALID_SELECTION", "Resolved option must exist.");
      }
    });
  }

  if (!isDecision(value.defaultDecision)) {
    issue(issues, "$.defaultDecision", "INVALID_DECISION", "Default decision is invalid.");
  }
  if (!isRecord(value.normalization)) {
    issue(issues, "$.normalization", "INVALID_NORMALIZATION", "Normalization is required.");
  } else {
    rejectUnknownKeys(
      value.normalization,
      ["purchaseDayIndex", "usageMeasuredAt"],
      "$.normalization",
      issues,
    );
    if (![0, 1].includes(value.normalization.purchaseDayIndex as number)) {
      issue(issues, "$.normalization.purchaseDayIndex", "INVALID_NORMALIZATION", "Index must be 0 or 1.");
    }
    if (!["REQUEST_TIME", "DECISION_TIME"].includes(value.normalization.usageMeasuredAt as string)) {
      issue(issues, "$.normalization.usageMeasuredAt", "INVALID_NORMALIZATION", "Usage time is invalid.");
    }
  }
  if (canonicalJson(value.inputSchema) !== canonicalJson(REFUND_INPUT_SCHEMA_V1)) {
    issue(
      issues,
      "$.inputSchema",
      "INVALID_INPUT_SCHEMA",
      "Input schema must exactly match the closed refund field catalog.",
    );
  }
  if (!isRecord(value.metadata)) {
    issue(issues, "$.metadata", "INVALID_METADATA", "Metadata is required.");
  } else {
    rejectUnknownKeys(
      value.metadata,
      ["model", "promptVersion", "schemaVersion", "createdAt", "source", "requestId"],
      "$.metadata",
      issues,
    );
    requireString(value.metadata.model, "$.metadata.model", issues);
    requireString(value.metadata.promptVersion, "$.metadata.promptVersion", issues);
    if (value.metadata.schemaVersion !== "1") {
      issue(issues, "$.metadata.schemaVersion", "INVALID_SCHEMA_VERSION", "Metadata schema must be 1.");
    }
    if (typeof value.metadata.createdAt !== "string" || Number.isNaN(Date.parse(value.metadata.createdAt))) {
      issue(issues, "$.metadata.createdAt", "INVALID_TIMESTAMP", "createdAt must be ISO-compatible.");
    }
    if (!["LIVE_RESPONSE", "RECORDED_FIXTURE"].includes(value.metadata.source as string)) {
      issue(issues, "$.metadata.source", "INVALID_SOURCE", "Metadata source is invalid.");
    }
    if (value.metadata.requestId !== undefined && typeof value.metadata.requestId !== "string") {
      issue(issues, "$.metadata.requestId", "INVALID_REQUEST_ID", "requestId must be a string.");
    }
    if (value.metadata.source === "LIVE_RESPONSE" && !requireString(value.metadata.requestId, "$.metadata.requestId", issues)) {
      issue(issues, "$.metadata.requestId", "MISSING_REQUEST_ID", "Live output needs a request ID.");
    }
  }

  return issues.length === 0
    ? { success: true, data: value as unknown as PolicyIR }
    : { success: false, issues };
}

export class PolicyIRValidationError extends Error {
  constructor(readonly issues: PolicyIRValidationIssue[]) {
    super(issues.map((item) => `${item.path}: ${item.message}`).join("; "));
    this.name = "PolicyIRValidationError";
  }
}

export function parsePolicyIR(value: unknown): PolicyIR {
  const result = validatePolicyIR(value);
  if (!result.success) {
    throw new PolicyIRValidationError(result.issues);
  }
  return result.data;
}
