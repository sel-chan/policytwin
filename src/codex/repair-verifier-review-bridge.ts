import type { WorkerRuntimeLayout } from "./worker-runtime-contract.js";
import {
  parseWorkerRpcV2Request,
  workerRpcSha256,
  type WorkerRpcV2Request,
} from "./worker-rpc-contract.js";
import type {
  RepairResult,
  ReviewResult,
  WorkerExecutionMode,
} from "./types.js";
import { parseRepairResult, parseReviewResult } from "./validate.js";
import {
  admittedVerifierReceipt,
  assertVerifierExchangeAuthority,
  authorizeVerifierRetry,
  authorizeVerifierReview,
  consumeVerifierReviewAuthorization,
  type AdmittedVerifierReceipt,
  type VerifierCapabilityDelivery,
  type VerifierExchangeAuthority,
  type VerifierRetryAuthorization,
  type VerifierReviewAuthorization,
} from "./verifier-exchange-authority.js";
import type {
  SealedVerifierSnapshot,
  VerifierExchangeReceipt,
} from "./verifier-exchange-contract.js";

export interface VerifierBridgeAttempt {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_BRIDGE_ATTEMPT_NOT_RUNTIME_FINALIZED";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly inputSha256: string;
  readonly policySha256: string;
  readonly executionBindingSha256: string;
  readonly attempt: 1 | 2;
  readonly repairRunId: string;
  readonly repairResultSha256: string;
  readonly snapshot: SealedVerifierSnapshot;
  readonly delivery: VerifierCapabilityDelivery;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface VerifierBridgeReviewRequired {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_REVIEW_REQUIRED_NOT_RUNTIME_FINALIZED";
  readonly requestId: string;
  readonly attempt: 1 | 2;
  readonly repairRunId: string;
  readonly verifierReceiptSha256: string;
  readonly finalExecutionTreeSha256: string;
  readonly reviewBindingSha256: string;
  readonly reviewContext: {
    readonly schemaVersion: "1";
    readonly kind: "VERIFIER_RECEIPT_BOUND_REVIEW_CONTEXT";
    readonly requestId: string;
    readonly requestSha256: string;
    readonly repairRunId: string;
    readonly repairResultSha256: string;
    readonly snapshotSha256: string;
    readonly verifierReceiptSha256: string;
    readonly finalExecutionTreeSha256: string;
    readonly acceptedCorpusSha256: string;
    readonly policyIrSha256: string;
  };
  readonly authorization: VerifierReviewAuthorization;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface VerifierBoundReviewSubmission {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_RECEIPT_BOUND_REVIEW_SUBMISSION";
  readonly reviewBindingSha256: string;
  readonly review: unknown;
}

export interface VerifierBridgeRetryRequired {
  readonly schemaVersion: "1";
  readonly kind: "VERIFIER_RETRY_REQUIRED_NOT_RUNTIME_FINALIZED";
  readonly requestId: string;
  readonly failedRepairRunId: string;
  readonly failedVerifierReceiptSha256: string;
  readonly nextAttempt: 2;
  readonly authorization: VerifierRetryAuthorization;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface RepairVerifierReviewBridgeResult {
  readonly schemaVersion: "1";
  readonly kind: "REPAIR_VERIFIER_REVIEW_BRIDGE_RESULT";
  readonly status: "BOUND_NOT_RUNTIME_FINALIZED";
  readonly outcome:
    | "VERIFIER_FAILED"
    | "STRUCTURAL_REVIEW_APPROVED"
    | "STRUCTURAL_REVIEW_BLOCKED";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly inputSha256: string;
  readonly policySha256: string;
  readonly executionBindingSha256: string;
  readonly attempt: 1 | 2;
  readonly repairRunId: string;
  readonly repairResultSha256: string;
  readonly snapshotSha256: string;
  readonly verifierImageDigest: string;
  readonly verifierRunId: string;
  readonly verifierReceiptSha256: string;
  readonly finalExecutionTreeSha256: string;
  readonly acceptedCorpusSha256: string;
  readonly policyIrSha256: string;
  readonly reviewBindingSha256: string | null;
  readonly reviewAuthority:
    | "NOT_RUN"
    | "CALLER_SUPPLIED_REVIEW_ECHO_BOUND_NOT_RUNTIME_REVIEW_PROOF";
  readonly reviewSha256: string | null;
  readonly review: ReviewResult | null;
  readonly liveClaim: false;
  readonly passSigningEligible: false;
  readonly externalSettlementEligible: false;
}

export interface RepairVerifierReviewBridge {
  prepareInitialAttempt(input: {
    layout: WorkerRuntimeLayout;
    request: unknown;
    repair: unknown;
    verifierImageDigest: string;
  }): VerifierBridgeAttempt;
  admitVerifierReceipt(
    attempt: VerifierBridgeAttempt,
    receipt: unknown,
  ):
    | VerifierBridgeReviewRequired
    | VerifierBridgeRetryRequired
    | RepairVerifierReviewBridgeResult;
  prepareRetry(
    outcome: VerifierBridgeRetryRequired,
    input: {
      layout: WorkerRuntimeLayout;
      request: unknown;
      repair: unknown;
      verifierImageDigest: string;
    },
  ): VerifierBridgeAttempt;
  bindReview(
    outcome: VerifierBridgeReviewRequired,
    submission: VerifierBoundReviewSubmission,
  ): RepairVerifierReviewBridgeResult;
}

export interface RepairVerifierReviewBridgeOptions {
  authority: VerifierExchangeAuthority;
  expectedExecutionMode: WorkerExecutionMode;
  now?: () => Date;
}

interface RequestState {
  request: WorkerRpcV2Request;
  requestSha256: string;
  seenRunIds: Set<string>;
}

interface AttemptMetadata {
  requestState: RequestState;
  repair: RepairResult;
  repairResultSha256: string;
  snapshot: SealedVerifierSnapshot;
  delivery: VerifierCapabilityDelivery;
  settled: boolean;
}

interface ReviewMetadata {
  attempt: AttemptMetadata;
  admitted: AdmittedVerifierReceipt;
  receipt: VerifierExchangeReceipt;
  authorization: VerifierReviewAuthorization;
  reviewBindingSha256: string;
  consumed: boolean;
}

interface RetryMetadata {
  attempt: AttemptMetadata;
  admitted: AdmittedVerifierReceipt;
  receipt: VerifierExchangeReceipt;
  authorization: VerifierRetryAuthorization;
  consumed: boolean;
}

const REPAIR_VERIFIER_REVIEW_BRIDGES = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseReviewSubmission(value: unknown): VerifierBoundReviewSubmission {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("Verifier-bound review submission is invalid.");
  }
  const record = value as Record<string, unknown>;
  const expected = ["kind", "review", "reviewBindingSha256", "schemaVersion"].sort();
  const actual = Object.keys(record).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    record.schemaVersion !== "1" ||
    record.kind !== "VERIFIER_RECEIPT_BOUND_REVIEW_SUBMISSION" ||
    typeof record.reviewBindingSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.reviewBindingSha256)
  ) {
    throw new Error("Verifier-bound review submission is invalid.");
  }
  return {
    schemaVersion: "1",
    kind: "VERIFIER_RECEIPT_BOUND_REVIEW_SUBMISSION",
    reviewBindingSha256: record.reviewBindingSha256,
    review: record.review,
  };
}

function exactCurrentTime(now: () => Date): Date {
  let value: Date;
  try {
    value = now();
  } catch {
    throw new Error("Verifier review bridge clock failed.");
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Verifier review bridge clock is invalid.");
  }
  return new Date(value.getTime());
}

function assertActiveRequest(
  request: WorkerRpcV2Request,
  current: Date,
  label: string,
): void {
  if (
    current.getTime() < Date.parse(request.issuedAt) ||
    current.getTime() >= Date.parse(request.expiresAt)
  ) {
    throw new Error(`${label} requires an active Worker RPC request.`);
  }
}

function exactStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatedRepair(
  request: WorkerRpcV2Request,
  value: unknown,
  expectedExecutionMode: WorkerExecutionMode,
  current: Date,
  seenRunIds: ReadonlySet<string>,
  minimumStartedAt?: string,
): RepairResult {
  const repair = parseRepairResult(value, expectedExecutionMode);
  if (
    repair.metadata.model !== request.model ||
    repair.metadata.modelReasoningEffort !== request.modelReasoningEffort ||
    !exactStringArray(repair.changedFiles, request.policy.writablePaths) ||
    !exactStringArray(repair.verificationCommandIds, request.policy.commandIds) ||
    seenRunIds.has(repair.metadata.runId) ||
    Date.parse(repair.metadata.startedAt) < Date.parse(request.issuedAt) ||
    (minimumStartedAt !== undefined &&
      Date.parse(repair.metadata.startedAt) < Date.parse(minimumStartedAt)) ||
    Date.parse(repair.metadata.completedAt) >= Date.parse(request.expiresAt) ||
    Date.parse(repair.metadata.completedAt) > current.getTime()
  ) {
    throw new Error("Repair result is not bound to the active verifier bridge request.");
  }
  return repair;
}

function resultFor(
  attempt: AttemptMetadata,
  receipt: VerifierExchangeReceipt,
  outcome: RepairVerifierReviewBridgeResult["outcome"],
  review: ReviewResult | null,
  reviewBindingSha256: string | null,
): RepairVerifierReviewBridgeResult {
  return deepFreeze({
    schemaVersion: "1" as const,
    kind: "REPAIR_VERIFIER_REVIEW_BRIDGE_RESULT" as const,
    status: "BOUND_NOT_RUNTIME_FINALIZED" as const,
    outcome,
    requestId: receipt.requestId,
    requestSha256: receipt.requestSha256,
    inputSha256: receipt.inputSha256,
    policySha256: receipt.policySha256,
    executionBindingSha256: receipt.executionBindingSha256,
    attempt: receipt.attempt,
    repairRunId: receipt.repairRunId,
    repairResultSha256: attempt.repairResultSha256,
    snapshotSha256: receipt.snapshotSha256,
    verifierImageDigest: receipt.verifierImageDigest,
    verifierRunId: receipt.verifierRunId,
    verifierReceiptSha256: receipt.receiptSha256,
    finalExecutionTreeSha256: receipt.finalExecutionTreeSha256,
    acceptedCorpusSha256: receipt.acceptedCorpusSha256,
    policyIrSha256: receipt.policyIrSha256,
    reviewBindingSha256,
    reviewAuthority: review === null
      ? "NOT_RUN" as const
      : "CALLER_SUPPLIED_REVIEW_ECHO_BOUND_NOT_RUNTIME_REVIEW_PROOF" as const,
    reviewSha256: review === null ? null : workerRpcSha256(review),
    review: review === null ? null : deepFreeze(review),
    liveClaim: false as const,
    passSigningEligible: false as const,
    externalSettlementEligible: false as const,
  });
}

export function assertRepairVerifierReviewBridge(
  value: unknown,
): asserts value is RepairVerifierReviewBridge {
  if (
    typeof value !== "object" ||
    value === null ||
    !REPAIR_VERIFIER_REVIEW_BRIDGES.has(value)
  ) {
    throw new Error("Repair verifier review bridge must be factory issued.");
  }
}

export function createRepairVerifierReviewBridge(
  options: RepairVerifierReviewBridgeOptions,
): RepairVerifierReviewBridge {
  const authority = options.authority;
  assertVerifierExchangeAuthority(authority);
  if (
    options.expectedExecutionMode !== "OFFLINE_TEST_DOUBLE" &&
    options.expectedExecutionMode !== "LIVE_CODEX_SDK"
  ) {
    throw new Error("Verifier review bridge execution mode is invalid.");
  }
  const expectedExecutionMode = options.expectedExecutionMode;
  const now = options.now ?? (() => new Date());
  const requests = new Map<string, RequestState>();
  const attempts = new WeakMap<object, AttemptMetadata>();
  const reviews = new WeakMap<object, ReviewMetadata>();
  const retries = new WeakMap<object, RetryMetadata>();

  function buildAttempt(
    requestState: RequestState,
    repair: RepairResult,
    snapshot: SealedVerifierSnapshot,
    delivery: VerifierCapabilityDelivery,
  ): VerifierBridgeAttempt {
    const repairResultSha256 = workerRpcSha256(repair);
    const attempt = deepFreeze({
      schemaVersion: "1" as const,
      kind: "VERIFIER_BRIDGE_ATTEMPT_NOT_RUNTIME_FINALIZED" as const,
      requestId: requestState.request.requestId,
      requestSha256: requestState.requestSha256,
      inputSha256: requestState.request.inputSha256,
      policySha256: requestState.request.policySha256,
      executionBindingSha256: requestState.request.executionBindingSha256,
      attempt: snapshot.attempt,
      repairRunId: repair.metadata.runId,
      repairResultSha256,
      snapshot,
      delivery,
      liveClaim: false as const,
      passSigningEligible: false as const,
      externalSettlementEligible: false as const,
    });
    attempts.set(attempt, {
      requestState,
      repair,
      repairResultSha256,
      snapshot,
      delivery,
      settled: false,
    });
    return attempt;
  }

  const bridge: RepairVerifierReviewBridge = {
    prepareInitialAttempt(input): VerifierBridgeAttempt {
      const current = exactCurrentTime(now);
      const request = parseWorkerRpcV2Request(input.request);
      assertActiveRequest(request, current, "Initial verifier attempt");
      if (requests.has(request.requestId)) {
        throw new Error("A Worker RPC request can begin only one verifier bridge.");
      }
      const requestSha256 = workerRpcSha256(request);
      const repair = validatedRepair(
        request,
        input.repair,
        expectedExecutionMode,
        current,
        new Set(),
      );
      const snapshot = authority.prepareSnapshot({
        layout: input.layout,
        request,
        attempt: 1,
        repairRunId: repair.metadata.runId,
        verifierImageDigest: input.verifierImageDigest,
      });
      const delivery = authority.issue(snapshot);
      const requestState: RequestState = {
        request,
        requestSha256,
        seenRunIds: new Set([repair.metadata.runId]),
      };
      requests.set(request.requestId, requestState);
      return buildAttempt(requestState, repair, snapshot, delivery);
    },

    admitVerifierReceipt(attemptValue, receiptValue) {
      const attempt = attempts.get(attemptValue);
      if (attempt === undefined || attempt.settled) {
        throw new Error("Verifier receipt requires one fresh bridge attempt.");
      }
      attempt.settled = true;
      const admitted = authority.admit(attempt.delivery, receiptValue);
      const receipt = admittedVerifierReceipt(admitted);
      if (attempt.requestState.seenRunIds.has(receipt.verifierRunId)) {
        throw new Error("Verifier run identity must differ from every repair and verifier phase.");
      }
      attempt.requestState.seenRunIds.add(receipt.verifierRunId);
      if (receipt.status === "PASS") {
        const authorization = authorizeVerifierReview(admitted);
        const reviewContext = deepFreeze({
          schemaVersion: "1" as const,
          kind: "VERIFIER_RECEIPT_BOUND_REVIEW_CONTEXT" as const,
          requestId: receipt.requestId,
          requestSha256: receipt.requestSha256,
          repairRunId: receipt.repairRunId,
          repairResultSha256: attempt.repairResultSha256,
          snapshotSha256: receipt.snapshotSha256,
          verifierReceiptSha256: receipt.receiptSha256,
          finalExecutionTreeSha256: receipt.finalExecutionTreeSha256,
          acceptedCorpusSha256: receipt.acceptedCorpusSha256,
          policyIrSha256: receipt.policyIrSha256,
        });
        const reviewBindingSha256 = workerRpcSha256({
          domain: "policytwin.verifier.receipt-bound-review.v1",
          ...reviewContext,
        });
        const outcome = deepFreeze({
          schemaVersion: "1" as const,
          kind: "VERIFIER_REVIEW_REQUIRED_NOT_RUNTIME_FINALIZED" as const,
          requestId: receipt.requestId,
          attempt: receipt.attempt,
          repairRunId: receipt.repairRunId,
          verifierReceiptSha256: receipt.receiptSha256,
          finalExecutionTreeSha256: receipt.finalExecutionTreeSha256,
          reviewBindingSha256,
          reviewContext,
          authorization,
          liveClaim: false as const,
          passSigningEligible: false as const,
          externalSettlementEligible: false as const,
        });
        reviews.set(outcome, {
          attempt,
          admitted,
          receipt,
          authorization,
          reviewBindingSha256,
          consumed: false,
        });
        return outcome;
      }
      if (receipt.attempt === 1) {
        const authorization = authorizeVerifierRetry(admitted);
        const outcome = deepFreeze({
          schemaVersion: "1" as const,
          kind: "VERIFIER_RETRY_REQUIRED_NOT_RUNTIME_FINALIZED" as const,
          requestId: receipt.requestId,
          failedRepairRunId: receipt.repairRunId,
          failedVerifierReceiptSha256: receipt.receiptSha256,
          nextAttempt: 2 as const,
          authorization,
          liveClaim: false as const,
          passSigningEligible: false as const,
          externalSettlementEligible: false as const,
        });
        retries.set(outcome, {
          attempt,
          admitted,
          receipt,
          authorization,
          consumed: false,
        });
        return outcome;
      }
      return resultFor(attempt, receipt, "VERIFIER_FAILED", null, null);
    },

    prepareRetry(outcomeValue, input): VerifierBridgeAttempt {
      const retry = retries.get(outcomeValue);
      if (retry === undefined || retry.consumed) {
        throw new Error("Verifier retry requires one fresh failed-receipt outcome.");
      }
      const current = exactCurrentTime(now);
      const request = parseWorkerRpcV2Request(input.request);
      assertActiveRequest(request, current, "Verifier retry");
      if (
        request.requestId !== retry.attempt.requestState.request.requestId ||
        workerRpcSha256(request) !== retry.attempt.requestState.requestSha256
      ) {
        throw new Error("Verifier retry changed its Worker RPC request.");
      }
      const repair = validatedRepair(
        request,
        input.repair,
        expectedExecutionMode,
        current,
        retry.attempt.requestState.seenRunIds,
        retry.receipt.completedAt,
      );
      const snapshot = authority.prepareRetrySnapshot({
        authorization: retry.authorization,
        layout: input.layout,
        request,
        repairRunId: repair.metadata.runId,
        verifierImageDigest: input.verifierImageDigest,
      });
      const delivery = authority.issue(snapshot);
      retry.consumed = true;
      retry.attempt.requestState.seenRunIds.add(repair.metadata.runId);
      return buildAttempt(retry.attempt.requestState, repair, snapshot, delivery);
    },

    bindReview(outcomeValue, submissionValue): RepairVerifierReviewBridgeResult {
      const reviewState = reviews.get(outcomeValue);
      if (reviewState === undefined || reviewState.consumed) {
        throw new Error("Review requires one fresh PASS-receipt outcome.");
      }
      reviewState.consumed = true;
      consumeVerifierReviewAuthorization(reviewState.authorization);
      authority.revalidateVerifierReceipt(reviewState.admitted);
      const current = exactCurrentTime(now);
      const request = reviewState.attempt.requestState.request;
      assertActiveRequest(request, current, "Verifier-bound review");
      const submission = parseReviewSubmission(submissionValue);
      if (submission.reviewBindingSha256 !== reviewState.reviewBindingSha256) {
        throw new Error("Review submission changed its verifier receipt binding.");
      }
      const review = parseReviewResult(submission.review, expectedExecutionMode);
      if (
        review.metadata.backendId !== reviewState.attempt.repair.metadata.backendId ||
        review.metadata.model !== request.model ||
        review.metadata.modelReasoningEffort !== request.modelReasoningEffort ||
        review.metadata.requestSha256 !== reviewState.reviewBindingSha256 ||
        reviewState.attempt.requestState.seenRunIds.has(review.metadata.runId) ||
        Date.parse(review.metadata.startedAt) < Date.parse(reviewState.receipt.completedAt) ||
        Date.parse(review.metadata.completedAt) >= Date.parse(request.expiresAt) ||
        Date.parse(review.metadata.completedAt) > current.getTime()
      ) {
        throw new Error("Review is not ordered after and bound to the verifier receipt.");
      }
      reviewState.attempt.requestState.seenRunIds.add(review.metadata.runId);
      return resultFor(
        reviewState.attempt,
        reviewState.receipt,
        review.verdict === "APPROVE"
          ? "STRUCTURAL_REVIEW_APPROVED"
          : "STRUCTURAL_REVIEW_BLOCKED",
        review,
        reviewState.reviewBindingSha256,
      );
    },
  };

  REPAIR_VERIFIER_REVIEW_BRIDGES.add(bridge);
  return Object.freeze(bridge);
}
