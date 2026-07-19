import type { PolicyDecisionResult, RefundPolicyInput } from "../domain/refund.js";

export interface OpaExecutionCase {
  id: string;
  input: RefundPolicyInput;
}

export interface OpaRunnerInput {
  executablePath: string;
  expectedVersion: string;
  expectedExecutableSha256: string;
  regoSource: string;
  query: "data.policytwin.refund.decision";
  cases: readonly OpaExecutionCase[];
  timeoutMs?: number;
  overallTimeoutMs?: number;
}

export interface OpaCaseResult {
  caseId: string;
  inputHash: string;
  result: PolicyDecisionResult;
}

export interface OpaRunReport {
  schemaVersion: "1";
  executionMode: "OPA_CLI";
  opaVersion: string;
  executableSha256: string;
  policyHash: string;
  query: "data.policytwin.refund.decision";
  compileCommand: "opa check --strict <policy.rego>";
  evalCommand: "opa eval --format json --stdin-input --data <policy.rego> <query>";
  results: OpaCaseResult[];
}
