import { createHash } from "node:crypto";
import { redactWorkerOutput } from "../codex/safety.js";
import { parseRepairWorkerInput } from "../codex/validate.js";
import type { RepairWorkerInput } from "../codex/types.js";
import { workerRpcSha256 } from "../codex/worker-rpc-contract.js";
import {
  assertConsumedExternalWorkerV2Run,
  assertExternalWorkerRpcV2Client,
  consumeValidatedExternalWorkerV2Run,
  workerRpcRequestIdForRepairRun,
  type ExternalWorkerRpcV2Client,
  type ValidatedExternalWorkerV2Run,
} from "../codex/worker-rpc-client.js";
import {
  RepairRunPersistenceError,
  SQLiteRepairRunRepository,
} from "./sqlite.js";
import type {
  RepairRunExecutionPort,
  RepairRunRecord,
  RepairRunVerifiedSettlement,
} from "./types.js";
import { repairRunSummaryFromValidatedExternalRun } from "./validated-result.js";

const DEFAULT_EXECUTION_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 30_000;
const VERIFIED_REPAIR_RUN_SETTLEMENTS = new WeakSet<object>();
const CLAIMED_REPAIR_RUN_SETTLEMENTS = new WeakSet<object>();

function verifiedRepairRunSettlement(
  validatedRun: ValidatedExternalWorkerV2Run,
): RepairRunVerifiedSettlement {
  const settlement = Object.freeze({ validatedRun });
  VERIFIED_REPAIR_RUN_SETTLEMENTS.add(settlement);
  return settlement;
}

function claimRepairRunSettlement(value: unknown): ValidatedExternalWorkerV2Run {
  if (
    typeof value !== "object" ||
    value === null ||
    !VERIFIED_REPAIR_RUN_SETTLEMENTS.has(value) ||
    CLAIMED_REPAIR_RUN_SETTLEMENTS.has(value)
  ) {
    throw new Error("Repair execution did not return one fresh authenticated settlement.");
  }
  CLAIMED_REPAIR_RUN_SETTLEMENTS.add(value);
  return (value as RepairRunVerifiedSettlement).validatedRun;
}

function safeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactWorkerOutput(raw, 900).text;
  return redacted.length > 0
    ? redacted
    : "The guarded repair executor failed without a safe diagnostic.";
}

function normalizedReadiness(
  value: ReturnType<RepairRunExecutionPort["readiness"]>,
): ReturnType<RepairRunExecutionPort["readiness"]> {
  if (value?.ready === true) return { ready: true };
  if (
    value?.ready === false &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{2,63}$/u.test(value.code) &&
    typeof value.message === "string" &&
    value.message.length > 0
  ) {
    const safe = redactWorkerOutput(value.message, 1_024);
    if (!safe.truncated && safe.text === value.message) return value;
  }
  return {
    ready: false,
    code: "LIVE_EXECUTOR_READINESS_FAILED",
    message: "The guarded repair executor returned an invalid readiness result.",
  };
}

function boundedTimeout(value: unknown, label: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 10 ||
    value > maximum
  ) {
    throw new Error(`${label} must be an integer from 10ms to ${maximum}ms.`);
  }
  return value;
}

function canonicalNow(now: () => Date): string {
  const value = now();
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Repair-run clock returned an invalid time.");
  }
  return new Date(milliseconds).toISOString();
}

export function repairRunSessionSha256(sessionToken: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(sessionToken)) {
    throw new Error("Repair-run session token is invalid.");
  }
  const decoded = Buffer.from(sessionToken, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== sessionToken) {
    throw new Error("Repair-run session token is invalid.");
  }
  return createHash("sha256").update(sessionToken, "utf8").digest("hex");
}

export function repairRunInputSha256(input: RepairWorkerInput): string {
  return workerRpcSha256(parseRepairWorkerInput(input));
}

export function repairRunPolicyIrSha256(input: RepairWorkerInput): string {
  return workerRpcSha256(parseRepairWorkerInput(input).acceptedPolicyIr);
}

function assertVerifiedSettlementBinding(
  runId: string,
  input: RepairWorkerInput,
  createdAt: string,
  observedAt: string,
  value: unknown,
): asserts value is ValidatedExternalWorkerV2Run {
  assertConsumedExternalWorkerV2Run(value);
  const completedAt = Date.parse(value.completedAt);
  if (
    value.requestId !== workerRpcRequestIdForRepairRun(runId) ||
    value.inputSha256 !== repairRunInputSha256(input) ||
    !Number.isFinite(completedAt) ||
    new Date(completedAt).toISOString() !== value.completedAt ||
    completedAt < Date.parse(createdAt) ||
    completedAt > Date.parse(observedAt) + 5_000
  ) {
    throw new Error("Authenticated external-worker settlement is not bound to this repair run.");
  }
}

export function createUnavailableRepairRunExecutionPort(
  code = "LIVE_EXECUTOR_NOT_ADMITTED",
  message =
    "Live repair is blocked until immutable role images, an eligible Linux cgroup-v2 supervisor, and the signed external-worker runtime are admitted.",
): RepairRunExecutionPort {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) {
    throw new Error("Unavailable repair execution code is invalid.");
  }
  const safeMessage = redactWorkerOutput(message, 1_024);
  if (safeMessage.truncated || safeMessage.text !== message || message.length === 0) {
    throw new Error("Unavailable repair execution message is unsafe.");
  }
  return Object.freeze({
    readiness: () => ({ ready: false as const, code, message }),
    async execute() {
      throw new Error("Unavailable repair execution port cannot execute.");
    },
  });
}

export function createAuthenticatedExternalWorkerRepairRunExecutionPort(
  client: ExternalWorkerRpcV2Client,
): RepairRunExecutionPort {
  assertExternalWorkerRpcV2Client(client);
  return Object.freeze({
    readiness: () => ({ ready: true as const }),
    async execute(
      input: RepairWorkerInput,
      context: Parameters<RepairRunExecutionPort["execute"]>[1],
    ) {
      if (context.signal.aborted) {
        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error("The authenticated external-worker run was aborted before admission.");
      }
      await context.onProgress({
        type: "PHASE_STARTED",
        phase: "CARTOGRAPHY",
        detail: { message: "Authenticated external-worker cartography and repair started." },
      });
      const validatedRun = await client.runRepair(structuredClone(input), {
        repairRunId: context.runId,
        signal: context.signal,
      });
      consumeValidatedExternalWorkerV2Run(validatedRun);
      if (validatedRun.requestId !== workerRpcRequestIdForRepairRun(context.runId)) {
        throw new Error("Authenticated external-worker result is not bound to this repair run.");
      }
      const settlement = verifiedRepairRunSettlement(validatedRun);
      if (context.signal.aborted) {
        return settlement;
      }
      const summary = repairRunSummaryFromValidatedExternalRun(validatedRun);
      await context.onProgress({
        type: "PHASE_COMPLETED",
        phase: "CARTOGRAPHY",
        detail: { message: "Signed read-only cartography was admitted." },
      });
      await context.onProgress({
        type: "PHASE_STARTED",
        phase: "REPAIR",
        detail: { message: "Admitting the signed bounded repair result.", attempt: summary.attempts },
      });
      await context.onProgress({
        type: "PHASE_COMPLETED",
        phase: "REPAIR",
        detail: {
          message: "Signed repair changes matched the fixed write set.",
          attempt: summary.attempts,
          changedFiles: summary.changedFiles,
        },
      });
      await context.onProgress({
        type: "PHASE_STARTED",
        phase: "VERIFICATION",
        detail: {
          message: "Admitting signed command and server-owned corpus receipts.",
          attempt: summary.attempts,
        },
      });
      await context.onProgress({
        type: "PHASE_COMPLETED",
        phase: "VERIFICATION",
        detail: {
          message: "Signed verification receipts were admitted.",
          attempt: summary.attempts,
          passed: summary.verification.passed,
          total: summary.verification.total,
        },
      });
      await context.onProgress({
        type: "PHASE_STARTED",
        phase: "REVIEW",
        detail: { message: "Admitting the signed independent review." },
      });
      await context.onProgress({
        type: "PHASE_COMPLETED",
        phase: "REVIEW",
        detail: {
          message: "Signed independent review was admitted.",
          ...(summary.review ? { reviewVerdict: summary.review.verdict } : {}),
        },
      });
      return settlement;
    },
  });
}

export class RepairRunCoordinator {
  readonly #active = new Map<string, Promise<void>>();
  readonly #executionTimeoutMs: number;
  readonly #settlementTimeoutMs: number;
  readonly #now: () => Date;

  constructor(
    readonly repository: SQLiteRepairRunRepository,
    readonly executionPort: RepairRunExecutionPort,
    options: {
      executionTimeoutMs?: number;
      settlementTimeoutMs?: number;
      now?: () => Date;
    } = {},
  ) {
    this.#executionTimeoutMs = boundedTimeout(
      options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
      "Repair-run execution timeout",
      DEFAULT_EXECUTION_TIMEOUT_MS,
    );
    this.#settlementTimeoutMs = boundedTimeout(
      options.settlementTimeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS,
      "Repair-run settlement timeout",
      60_000,
    );
    this.#now = options.now ?? (() => new Date());
  }

  start(value: {
    clientRequestId: string;
    sessionToken: string;
    input: unknown;
  }): { run: RepairRunRecord; created: boolean } {
    const input = parseRepairWorkerInput(value.input);
    const sessionSha256 = repairRunSessionSha256(value.sessionToken);
    const created = this.repository.createOrGetRun({
      clientRequestId: value.clientRequestId,
      sessionSha256,
      policyId: input.policyId,
      policyVersion: input.policyVersion,
      policyIrSha256: repairRunPolicyIrSha256(input),
      inputSha256: repairRunInputSha256(input),
      createdAt: canonicalNow(this.#now),
    });
    if (!created.created) return created;

    let readiness: ReturnType<RepairRunExecutionPort["readiness"]>;
    try {
      readiness = normalizedReadiness(this.executionPort.readiness());
    } catch {
      readiness = {
        ready: false,
        code: "LIVE_EXECUTOR_READINESS_FAILED",
        message: "The guarded repair executor could not prove readiness.",
      };
    }
    if (!readiness.ready) {
      return {
        created: true,
        run: this.repository.markBlocked(
          created.run.id,
          { code: readiness.code, message: readiness.message },
          canonicalNow(this.#now),
        ),
      };
    }

    const running = this.repository.markRunning(created.run.id, canonicalNow(this.#now));
    const execution = this.#execute(running.id, structuredClone(input), running.createdAt);
    this.#active.set(running.id, execution);
    const clear = () => {
      if (this.#active.get(running.id) === execution) this.#active.delete(running.id);
    };
    void execution.then(clear, clear);
    return { run: running, created: true };
  }

  async #execute(runId: string, input: RepairWorkerInput, createdAt: string): Promise<void> {
    const controller = new AbortController();
    let execution: Promise<RepairRunVerifiedSettlement> | undefined;
    let verifiedSettlement: ValidatedExternalWorkerV2Run | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("The guarded repair execution exceeded its wall-time limit.");
        controller.abort(error);
        reject(error);
      }, this.#executionTimeoutMs);
    });
    try {
      execution = this.executionPort.execute(input, {
          runId,
          signal: controller.signal,
          onProgress: async (event) => {
            if (controller.signal.aborted) {
              throw controller.signal.reason instanceof Error
                ? controller.signal.reason
                : new Error("The guarded repair execution was aborted.");
            }
            this.repository.appendProgress(
              runId,
              event.type,
              event.phase,
              event.detail,
              canonicalNow(this.#now),
            );
          },
        });
      const settlement = await Promise.race([execution, timeout]);
      const validatedRun = claimRepairRunSettlement(settlement);
      const observedAt = canonicalNow(this.#now);
      assertVerifiedSettlementBinding(runId, input, createdAt, observedAt, validatedRun);
      verifiedSettlement = validatedRun;
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("The guarded repair execution was aborted.");
      }
      const result = repairRunSummaryFromValidatedExternalRun(validatedRun);
      if (result.verification.total !== input.acceptedCases.length) {
        throw new Error("Live repair verification did not cover the complete accepted corpus.");
      }
      this.repository.markSucceeded(runId, validatedRun, observedAt);
    } catch (error) {
      try {
        if (controller.signal.aborted && execution !== undefined) {
          this.repository.markCleanupPending(
            runId,
            {
              code: "LIVE_EXECUTION_TIMEOUT_CLEANUP_PENDING",
              message:
                "The live execution timed out; this session remains closed while external-worker settlement is observed.",
            },
            canonicalNow(this.#now),
          );
          if (verifiedSettlement !== undefined) {
            this.repository.markFailedAfterVerifiedSettlement(
              runId,
              verifiedSettlement,
              {
                code: "LIVE_EXECUTION_TIMEOUT",
                message:
                  "The timed-out external-worker call returned an authenticated cleanup-complete settlement after the deadline.",
              },
              canonicalNow(this.#now),
            );
          } else {
            let settlementTimer: ReturnType<typeof setTimeout> | undefined;
            const settled = await Promise.race([
              execution.then(
                (value) => ({ kind: "RESOLVED" as const, value }),
                () => ({ kind: "REJECTED" as const }),
              ),
              new Promise<{ kind: "UNSETTLED" }>((resolve) => {
                settlementTimer = setTimeout(
                  () => resolve({ kind: "UNSETTLED" }),
                  this.#settlementTimeoutMs,
                );
              }),
            ]);
            if (settlementTimer !== undefined) clearTimeout(settlementTimer);
            if (settled.kind === "RESOLVED") {
              const observedAt = canonicalNow(this.#now);
              try {
                const validatedRun = claimRepairRunSettlement(settled.value);
                assertVerifiedSettlementBinding(runId, input, createdAt, observedAt, validatedRun);
                this.repository.markFailedAfterVerifiedSettlement(
                  runId,
                  validatedRun,
                  {
                    code: "LIVE_EXECUTION_TIMEOUT",
                    message:
                      "The timed-out external-worker call returned an authenticated cleanup-complete settlement after the deadline.",
                  },
                  observedAt,
                );
              } catch {
                this.repository.markPoisoned(
                  runId,
                  {
                    code: "LIVE_EXECUTION_SETTLEMENT_UNVERIFIED",
                    message:
                      "The external-worker call settled without a run-bound authenticated cleanup receipt; new runs remain fail-stop blocked.",
                  },
                  observedAt,
                );
              }
            } else {
              this.repository.markPoisoned(
                runId,
                {
                  code:
                    settled.kind === "UNSETTLED"
                      ? "LIVE_EXECUTION_UNSETTLED"
                      : "LIVE_EXECUTION_SETTLEMENT_UNVERIFIED",
                  message:
                    settled.kind === "UNSETTLED"
                      ? "The external-worker call ignored cancellation and did not settle; new runs remain fail-stop blocked."
                      : "The external-worker transport ended without an authenticated cleanup receipt; new runs remain fail-stop blocked.",
                },
                canonicalNow(this.#now),
              );
            }
          }
        } else if (verifiedSettlement !== undefined) {
          this.repository.markFailedAfterVerifiedSettlement(
            runId,
            verifiedSettlement,
            {
              code: "LIVE_EXECUTION_RESULT_REJECTED",
              message: safeFailureMessage(error),
            },
            canonicalNow(this.#now),
          );
        } else {
          this.repository.markPoisoned(
            runId,
            {
              code: "LIVE_EXECUTION_SETTLEMENT_UNVERIFIED",
              message:
                "The external-worker execution ended without a run-bound authenticated cleanup receipt; new runs remain fail-stop blocked.",
            },
            canonicalNow(this.#now),
          );
        }
      } catch (transitionError) {
        if (
          !(transitionError instanceof RepairRunPersistenceError) ||
          transitionError.code !== "INVALID_TRANSITION"
        ) {
          throw transitionError;
        }
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async waitForRun(runId: string): Promise<void> {
    await this.#active.get(runId);
  }
}
