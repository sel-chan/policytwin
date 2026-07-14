export const WORKER_EXECUTION_MODES = ["OFFLINE_TEST_DOUBLE", "LIVE_CODEX_SDK"] as const;
export type WorkerExecutionMode = (typeof WORKER_EXECUTION_MODES)[number];

export const WORKER_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type WorkerReasoningEffort = (typeof WORKER_REASONING_EFFORTS)[number];

export const REPAIR_COMMAND_IDS = ["fixture-typecheck", "fixture-test"] as const;
export type RepairCommandId = (typeof REPAIR_COMMAND_IDS)[number];

export interface WorkerRunMetadata {
  executionMode: WorkerExecutionMode;
  backendId: string;
  sdkVersion: string;
  model: string;
  modelReasoningEffort: WorkerReasoningEffort;
  promptTemplateSha256: string;
  requestSha256: string;
  outputSchemaSha256: string;
  runId: string;
  startedAt: string;
  completedAt: string;
}

export interface CodeLocation {
  file: string;
  lineStart: number;
  lineEnd: number;
  symbol: string;
  reason: string;
}

export interface CartographyResult {
  schemaVersion: "1";
  phase: "CARTOGRAPHY";
  metadata: WorkerRunMetadata;
  relevantFiles: string[];
  entryPoints: CodeLocation[];
  policyLogicLocations: CodeLocation[];
  dataFlow: CodeLocation[];
  testFiles: string[];
  risks: string[];
  proposedFilesToChange: string[];
  verificationCommandIds: RepairCommandId[];
}

export interface RepairResult {
  schemaVersion: "1";
  phase: "REPAIR";
  metadata: WorkerRunMetadata;
  changedFiles: string[];
  summary: string;
  rationale: string[];
  remainingRisks: string[];
  verificationCommandIds: RepairCommandId[];
}

export interface CommandResult {
  schemaVersion: "1";
  commandId: RepairCommandId;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  fixtureTreeBeforeSha256: string;
  fixtureTreeAfterSha256: string;
}

export interface CommandEvidence extends CommandResult {
  attempt: 1 | 2;
  repairRunId: string;
}

export interface CommandFailureEvidence {
  schemaVersion: "1";
  commandId: RepairCommandId;
  attempt: 1 | 2;
  repairRunId: string;
  failureKind: "COMMAND_RUNNER_OR_EVIDENCE_ERROR";
  error: string;
}

export interface PolicyVerificationCaseResult {
  caseId: string;
  expectedDecision: Decision;
  actualDecision: Decision | null;
  status: "PASS" | "FAIL" | "ERROR";
  error: string | null;
}

export interface PolicyVerificationEvidence {
  schemaVersion: "1";
  executionMode: "SERVER_OWNED_CORPUS";
  attempt: 1 | 2;
  repairRunId: string;
  fixtureTreeSha256: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
  status: "PASS" | "FAIL";
  total: number;
  passed: number;
  results: PolicyVerificationCaseResult[];
}

export const REVIEW_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  title: string;
  description: string;
  relatedFiles: string[];
}

export interface ReviewResult {
  schemaVersion: "1";
  phase: "REVIEW";
  metadata: WorkerRunMetadata;
  verdict: "APPROVE" | "BLOCK";
  summary: string;
  findings: ReviewFinding[];
}

export interface RepairWorkerInput {
  policyId: string;
  policyVersion: number;
  fixtureId: "seeded-refund-demo";
  sourcePolicy: string;
  policySummary: string;
  acceptedPolicyIr: PolicyIR;
  acceptedCases: PolicyCase[];
  failingCaseIds: string[];
  failingDriftWitnesses: RepairDriftWitness[];
  allowedCommandIds: RepairCommandId[];
  maxRepairAttempts: 1 | 2;
}

export interface RepairDriftWitness {
  caseId: string;
  input: RefundPolicyInput;
  expectedDecision: Decision;
  actualDecision: Decision;
  defectIds: SeededDefectId[];
  relatedClauseIds: string[];
  relatedRuleIds: string[];
}

export interface RepairFailure {
  code:
    | "CARTOGRAPHY_INVALID"
    | "REPAIR_INVALID"
    | "COMMAND_FAILED"
    | "POLICY_VERIFICATION_FAILED"
    | "REVIEW_INVALID"
    | "REVIEW_BLOCKED";
  message: string;
}

export interface RepairWorkerReport {
  schemaVersion: "1";
  executionMode: WorkerExecutionMode;
  status: "PASS" | "FAIL";
  attempts: number;
  cartography: CartographyResult | null;
  repairAttempts: RepairResult[];
  commandEvidence: CommandEvidence[];
  commandFailures: CommandFailureEvidence[];
  policyVerificationAttempts: PolicyVerificationEvidence[];
  review: ReviewResult | null;
  failure: RepairFailure | null;
}

export interface CartographyContext {
  input: RepairWorkerInput;
}

export interface RepairContext {
  input: RepairWorkerInput;
  cartography: CartographyResult;
  attempt: number;
  previousCommandEvidence: CommandEvidence[];
  previousPolicyVerification: PolicyVerificationEvidence | null;
}

export interface ReviewContext {
  input: RepairWorkerInput;
  cartography: CartographyResult;
  repair: RepairResult;
  commandEvidence: CommandEvidence[];
  policyVerification: PolicyVerificationEvidence;
}

export interface CodexWorkerBackend {
  executionMode: WorkerExecutionMode;
  cartograph(context: CartographyContext): Promise<unknown>;
  repair(context: RepairContext): Promise<unknown>;
  review(context: ReviewContext): Promise<unknown>;
}

export type RepairCommandRunner = (commandId: RepairCommandId) => Promise<unknown>;
export interface PolicyVerificationRunnerContext {
  attempt: 1 | 2;
  repairRunId: string;
  fixtureTreeSha256: string;
  acceptedCorpusSha256: string;
  policyIrSha256: string;
}

export type PolicyVerificationRunner = (
  input: RepairWorkerInput,
  context: PolicyVerificationRunnerContext,
) => Promise<unknown>;
import type { Decision } from "../domain/decision.js";
import type { PolicyCase } from "../domain/cases.js";
import type { RefundPolicyInput } from "../domain/refund.js";
import type { SeededDefectId } from "../differential/types.js";
import type { PolicyIR } from "../policy-ir/types.js";
