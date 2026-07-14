export const WORKER_EXECUTION_MODES = ["OFFLINE_TEST_DOUBLE", "LIVE_CODEX_SDK"] as const;
export type WorkerExecutionMode = (typeof WORKER_EXECUTION_MODES)[number];

export const REPAIR_COMMAND_IDS = ["fixture-typecheck", "fixture-test"] as const;
export type RepairCommandId = (typeof REPAIR_COMMAND_IDS)[number];

export interface WorkerRunMetadata {
  executionMode: WorkerExecutionMode;
  backendId: string;
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
  addedTests: string[];
  remainingRisks: string[];
  verificationCommandIds: RepairCommandId[];
}

export interface CommandEvidence {
  schemaVersion: "1";
  commandId: RepairCommandId;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
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
  policySummary: string;
  failingCaseIds: string[];
  allowedCommandIds: RepairCommandId[];
  maxRepairAttempts: 1 | 2;
}

export interface RepairFailure {
  code:
    | "CARTOGRAPHY_INVALID"
    | "REPAIR_INVALID"
    | "COMMAND_FAILED"
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
}

export interface ReviewContext {
  input: RepairWorkerInput;
  cartography: CartographyResult;
  repair: RepairResult;
  commandEvidence: CommandEvidence[];
}

export interface CodexWorkerBackend {
  executionMode: WorkerExecutionMode;
  cartograph(context: CartographyContext): Promise<unknown>;
  repair(context: RepairContext): Promise<unknown>;
  review(context: ReviewContext): Promise<unknown>;
}

export type RepairCommandRunner = (commandId: RepairCommandId) => Promise<unknown>;
