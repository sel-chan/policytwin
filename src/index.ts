export const PROJECT_NAME = "PolicyTwin" as const;

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

export * from "./domain/decision.js";
export * from "./domain/refund.js";
export * from "./domain/refund-schema.js";
export * from "./domain/cases.js";
export * from "./policy-ir/types.js";
export * from "./policy-ir/clauses.js";
export * from "./policy-ir/validate.js";
export * from "./policy-ir/evaluate.js";
