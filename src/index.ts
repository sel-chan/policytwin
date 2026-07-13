export const PROJECT_NAME = "PolicyTwin" as const;

export const DECISIONS = ["ALLOW", "DENY", "REVIEW"] as const;

export type Decision = (typeof DECISIONS)[number];

export const REQUIRED_ROOT_SCRIPTS = [
  "dev",
  "lint",
  "typecheck",
  "test",
  "test:integration",
  "test:e2e",
  "eval",
  "build",
  "verify",
  "verify:live",
  "demo:reset",
  "demo:run",
  "submission:check",
] as const;

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && DECISIONS.includes(value as Decision);
}

export * from "./domain/refund.js";
export * from "./domain/cases.js";
