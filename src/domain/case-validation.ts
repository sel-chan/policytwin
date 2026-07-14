import { isDecision } from "./decision.js";
import { parseRefundPolicyInput } from "./refund.js";
import type { CaseSource, PolicyCase } from "./cases.js";

const CASE_SOURCES = new Set<CaseSource>([
  "USER_GOLDEN",
  "BOUNDARY",
  "CONFLICT",
  "MINIMAL_CONTRAST",
  "GENERATED",
  "REGRESSION",
  "MUTATION_WITNESS",
]);
const CASE_KEYS = new Set([
  "id",
  "title",
  "input",
  "expectedDecision",
  "source",
  "relatedRuleIds",
  "relatedClauseIds",
  "rationale",
]);

export class PolicyCaseValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "PolicyCaseValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PolicyCaseValidationError(path, "must be a non-empty string.");
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new PolicyCaseValidationError(path, "must be an array.");
  }
  const result = value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new PolicyCaseValidationError(path, "must not contain duplicate identifiers.");
  }
  return result;
}

export function parsePolicyCase(value: unknown, path = "$case"): PolicyCase {
  if (!isRecord(value)) {
    throw new PolicyCaseValidationError(path, "must be an object.");
  }
  for (const key of Object.keys(value)) {
    if (!CASE_KEYS.has(key)) {
      throw new PolicyCaseValidationError(`${path}.${key}`, "is not allowed.");
    }
  }

  const source = value.source;
  if (typeof source !== "string" || !CASE_SOURCES.has(source as CaseSource)) {
    throw new PolicyCaseValidationError(`${path}.source`, "is not a supported case source.");
  }
  if (!isDecision(value.expectedDecision)) {
    throw new PolicyCaseValidationError(
      `${path}.expectedDecision`,
      "must be ALLOW, DENY, or REVIEW.",
    );
  }

  return {
    id: nonEmptyString(value.id, `${path}.id`),
    title: nonEmptyString(value.title, `${path}.title`),
    input: parseRefundPolicyInput(value.input),
    expectedDecision: value.expectedDecision,
    source: source as CaseSource,
    relatedRuleIds: stringArray(value.relatedRuleIds, `${path}.relatedRuleIds`),
    relatedClauseIds: stringArray(value.relatedClauseIds, `${path}.relatedClauseIds`),
    rationale: nonEmptyString(value.rationale, `${path}.rationale`),
  };
}

export function parsePolicyCases(value: unknown, path = "$cases"): PolicyCase[] {
  if (!Array.isArray(value)) {
    throw new PolicyCaseValidationError(path, "must be an array.");
  }
  const cases = value.map((item, index) => parsePolicyCase(item, `${path}[${index}]`));
  const identifiers = cases.map((item) => item.id);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new PolicyCaseValidationError(path, "case identifiers must be unique.");
  }
  return cases;
}
