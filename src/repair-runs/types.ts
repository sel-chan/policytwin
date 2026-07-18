import type { RepairWorkerInput } from "../codex/types.js";
import type { ValidatedExternalWorkerV2Run } from "../codex/worker-rpc-client.js";

export const REPAIR_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "CLEANUP_PENDING",
  "BLOCKED",
  "SUCCEEDED",
  "FAILED",
  "POISONED",
] as const;
export type RepairRunStatus = (typeof REPAIR_RUN_STATUSES)[number];

export const REPAIR_RUN_PHASES = [
  "ADMISSION",
  "CARTOGRAPHY",
  "REPAIR",
  "VERIFICATION",
  "REVIEW",
  "COMPLETE",
] as const;
export type RepairRunPhase = (typeof REPAIR_RUN_PHASES)[number];

export const REPAIR_RUN_EVENT_TYPES = [
  "RUN_CREATED",
  "RUN_STARTED",
  "PHASE_STARTED",
  "PHASE_COMPLETED",
  "RUN_BLOCKED",
  "RUN_CLEANUP_PENDING",
  "RUN_SUCCEEDED",
  "RUN_FAILED",
  "RUN_POISONED",
] as const;
export type RepairRunEventType = (typeof REPAIR_RUN_EVENT_TYPES)[number];

export interface RepairRunCommandSummary {
  commandId: "fixture-typecheck" | "fixture-test";
  attempt: 1 | 2;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface RepairRunReviewSummary {
  verdict: "APPROVE" | "BLOCK";
  summary: string;
  blockingFindingCount: number;
}

export interface RepairRunResultSummary {
  executionMode: "LIVE_CODEX_SDK";
  externalRequestId: string;
  executionBindingSha256: string;
  completedAt: string;
  attempts: 1 | 2;
  changedFiles: string[];
  commands: RepairRunCommandSummary[];
  verification: {
    status: "PASS" | "FAIL";
    passed: number;
    total: number;
  };
  review: RepairRunReviewSummary | null;
}

export interface RepairRunFailure {
  code: string;
  message: string;
}

export interface RepairRunRecord {
  schemaVersion: "1";
  id: string;
  clientRequestId: string;
  policyId: string;
  policyVersion: number;
  policyIrSha256: string;
  inputSha256: string;
  status: RepairRunStatus;
  phase: RepairRunPhase;
  executionMode: "NOT_STARTED" | "LIVE_EXECUTION_UNVERIFIED" | "LIVE_CODEX_SDK";
  result: RepairRunResultSummary | null;
  failure: RepairRunFailure | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepairRunEventDetail {
  message: string;
  attempt?: 1 | 2;
  changedFiles?: string[];
  commandId?: "fixture-typecheck" | "fixture-test";
  exitCode?: number;
  passed?: number;
  total?: number;
  reviewVerdict?: "APPROVE" | "BLOCK";
}

export interface RepairRunEvent {
  schemaVersion: "1";
  runId: string;
  sequence: number;
  type: RepairRunEventType;
  phase: RepairRunPhase;
  occurredAt: string;
  detail: RepairRunEventDetail;
}

export interface RepairRunExecutionProgress {
  type: "PHASE_STARTED" | "PHASE_COMPLETED";
  phase: Exclude<RepairRunPhase, "ADMISSION" | "COMPLETE">;
  detail: RepairRunEventDetail;
}

export interface RepairRunVerifiedSettlement {
  readonly validatedRun: ValidatedExternalWorkerV2Run;
}

export interface RepairRunExecutionPort {
  readiness():
    | { ready: true }
    | { ready: false; code: string; message: string };
  execute(
    input: RepairWorkerInput,
    context: {
      runId: string;
      signal: AbortSignal;
      onProgress(event: RepairRunExecutionProgress): Promise<void>;
    },
  ): Promise<RepairRunVerifiedSettlement>;
}
