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
export * from "./domain/case-validation.js";
export * from "./policy-ir/types.js";
export * from "./policy-ir/clauses.js";
export * from "./policy-ir/validate.js";
export * from "./policy-ir/evaluate.js";
export * from "./policy-ir/resolve.js";
export * from "./policy-ir/state.js";
export * from "./compiler/types.js";
export * from "./compiler/rego.js";
export * from "./opa/types.js";
export * from "./opa/runner.js";
export * from "./cases/generate.js";
export * from "./cases/analyze.js";
export * from "./mutation/mutate.js";
export * from "./mutation/report.js";
export * from "./differential/types.js";
export * from "./differential/run.js";
export * from "./codex/types.js";
export * from "./codex/safety.js";
export * from "./codex/validate.js";
export * from "./codex/orchestrate.js";
export * from "./impact/types.js";
export * from "./impact/analyze.js";
export * from "./traceability/report.js";
export * from "./evidence/validate.js";
export * from "./evidence/archive.js";
export * from "./evidence/files.js";
export * from "./workspace/service.js";
export * from "./workspace/http.js";
export * from "./openai/interpreter.js";
export * from "./openai/request-guard.js";
