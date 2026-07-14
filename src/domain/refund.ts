import type { Decision } from "./decision.js";

export const PLAN_TYPES = ["MONTHLY", "ANNUAL", "ENTERPRISE"] as const;

export type PlanType = (typeof PLAN_TYPES)[number];

export interface RefundPolicyInput {
  daysSincePurchase: number;
  usageBasisPoints: number;
  promotionalPurchase: boolean;
  finalSale: boolean;
  managerApproved: boolean;
  planType: PlanType;
}

export interface PolicyDecisionResult {
  decision: Decision;
  matchedRuleId: string | null;
  explanation: string;
  policyVersion: number;
}

export interface ValidationIssue {
  path: string;
  code: "UNKNOWN_FIELD" | "INVALID_TYPE" | "INVALID_INTEGER" | "OUT_OF_RANGE" | "INVALID_ENUM";
  message: string;
}

export type RefundInputValidationResult =
  | { success: true; data: RefundPolicyInput }
  | { success: false; issues: ValidationIssue[] };

const INPUT_FIELDS = new Set([
  "daysSincePurchase",
  "usageBasisPoints",
  "promotionalPurchase",
  "finalSale",
  "managerApproved",
  "planType",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNonNegativeInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, code: "INVALID_TYPE", message: `${path} must be a finite number.` });
    return false;
  }
  if (!Number.isInteger(value)) {
    issues.push({ path, code: "INVALID_INTEGER", message: `${path} must be an integer.` });
    return false;
  }
  if (value < 0) {
    issues.push({ path, code: "OUT_OF_RANGE", message: `${path} must be non-negative.` });
    return false;
  }
  return true;
}

export function validateRefundPolicyInput(value: unknown): RefundInputValidationResult {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ path: "$", code: "INVALID_TYPE", message: "Refund input must be an object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  for (const field of Object.keys(value)) {
    if (!INPUT_FIELDS.has(field)) {
      issues.push({ path: field, code: "UNKNOWN_FIELD", message: `${field} is not supported.` });
    }
  }

  const daysSincePurchase = value.daysSincePurchase;
  const usageBasisPoints = value.usageBasisPoints;
  const promotionalPurchase = value.promotionalPurchase;
  const finalSale = value.finalSale;
  const managerApproved = value.managerApproved;
  const planType = value.planType;

  validateNonNegativeInteger(daysSincePurchase, "daysSincePurchase", issues);
  validateNonNegativeInteger(usageBasisPoints, "usageBasisPoints", issues);

  for (const [path, candidate] of [
    ["promotionalPurchase", promotionalPurchase],
    ["finalSale", finalSale],
    ["managerApproved", managerApproved],
  ] as const) {
    if (typeof candidate !== "boolean") {
      issues.push({ path, code: "INVALID_TYPE", message: `${path} must be a boolean.` });
    }
  }

  if (typeof planType !== "string" || !PLAN_TYPES.includes(planType as PlanType)) {
    issues.push({ path: "planType", code: "INVALID_ENUM", message: "planType is not supported." });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      daysSincePurchase: daysSincePurchase as number,
      usageBasisPoints: usageBasisPoints as number,
      promotionalPurchase: promotionalPurchase as boolean,
      finalSale: finalSale as boolean,
      managerApproved: managerApproved as boolean,
      planType: planType as PlanType,
    },
  };
}

export class RefundInputValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "RefundInputValidationError";
  }
}

export function parseRefundPolicyInput(value: unknown): RefundPolicyInput {
  const result = validateRefundPolicyInput(value);
  if (!result.success) {
    throw new RefundInputValidationError(result.issues);
  }
  return result.data;
}
