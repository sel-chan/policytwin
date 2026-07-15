import {
  parseWorkerRpcRequest,
  workerRpcSha256,
  type WorkerRpcRequest,
} from "./worker-rpc-contract.js";

export type WorkerOsLifecycleStage =
  | "REQUEST_VALIDATED"
  | "HANDLE_CREATED"
  | "LAYOUT_PREPARED"
  | "WORKER_RESULT_VALIDATED"
  | "VERIFIER_RESULT_VALIDATED"
  | "SUPERVISOR_CLEANUP_VALIDATED";

export interface WorkerOsCleanupObservation {
  schemaVersion: "1";
  workerContainerRemoved: boolean;
  verifierContainerRemoved: boolean;
  egressContainerRemoved: boolean;
  workerNetworkReleased: boolean;
  outboundNetworkReleased: boolean;
  repairWorkspaceDeleted: boolean;
  verificationWorkspaceDeleted: boolean;
  processTreeReaped: boolean;
  remainingProcessCount: number;
}

export interface PreparedWorkerOsLifecycleResult {
  schemaVersion: "1";
  status: "STATIC_DRIVER_TEST_ONLY";
  requestSha256: string;
  stages: readonly WorkerOsLifecycleStage[];
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
}

export interface WorkerOsLifecycleDriver<Handle, WorkerOutput, VerifierOutput> {
  /** This factory must be synchronous and side-effect-free; resource allocation begins in prepare. */
  createHandle(request: WorkerRpcRequest): Handle;
  prepare(handle: Handle, request: WorkerRpcRequest, signal: AbortSignal): Promise<void>;
  runWorker(
    handle: Handle,
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<WorkerOutput>;
  validateWorkerOutput(output: WorkerOutput, request: WorkerRpcRequest): void;
  runVerifier(
    handle: Handle,
    workerOutput: WorkerOutput,
    request: WorkerRpcRequest,
    signal: AbortSignal,
  ): Promise<VerifierOutput>;
  validateVerifierOutput(output: VerifierOutput, request: WorkerRpcRequest): void;
  cleanup(
    handle: Handle,
    reason: "SUCCESS" | "FAILURE" | "ABORT",
    signal: AbortSignal,
  ): Promise<WorkerOsCleanupObservation>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("The worker lifecycle was aborted.");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertRequestBinding(request: WorkerRpcRequest, expectedSha256: string): void {
  if (workerRpcSha256(parseWorkerRpcRequest(request)) !== expectedSha256) {
    throw new Error("The admitted worker request changed during execution.");
  }
}

function assertCleanup(value: WorkerOsCleanupObservation): void {
  if (
    value.schemaVersion !== "1" ||
    value.workerContainerRemoved !== true ||
    value.verifierContainerRemoved !== true ||
    value.egressContainerRemoved !== true ||
    value.workerNetworkReleased !== true ||
    value.outboundNetworkReleased !== true ||
    value.repairWorkspaceDeleted !== true ||
    value.verificationWorkspaceDeleted !== true ||
    value.processTreeReaped !== true ||
    value.remainingProcessCount !== 0
  ) {
    throw new Error("Supervisor cleanup did not prove complete teardown.");
  }
}

export function createPreparedSupervisorWorkerLifecycle<Handle, WorkerOutput, VerifierOutput>(
  driver: WorkerOsLifecycleDriver<Handle, WorkerOutput, VerifierOutput>,
  options: { cleanupTimeoutMs?: number } = {},
): {
  execute(value: unknown, input: { signal: AbortSignal }): Promise<PreparedWorkerOsLifecycleResult>;
} {
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 30_000;
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1_000 || cleanupTimeoutMs > 60_000) {
    throw new Error("The worker cleanup timeout is invalid.");
  }
  let active = false;
  let poisoned = false;
  return {
    async execute(value, input) {
      if (poisoned) throw new Error("The worker lifecycle is poisoned after incomplete cleanup.");
      if (active) throw new Error("The worker lifecycle already has an active run.");
      active = true;
      try {
        throwIfAborted(input.signal);
        const request = deepFreeze(parseWorkerRpcRequest(value));
        const requestSha256 = workerRpcSha256(request);
        const stages: WorkerOsLifecycleStage[] = ["REQUEST_VALIDATED"];
        const wallController = new AbortController();
        const wallTimer = setTimeout(() => {
          wallController.abort(new Error("The worker lifecycle exceeded its total wall-time limit."));
        }, request.policy.limits.wallTimeMs);
        wallTimer.unref();
        const executionSignal = AbortSignal.any([input.signal, wallController.signal]);
        let handle: Handle | undefined;
        let failure: unknown = null;
        let reason: "SUCCESS" | "FAILURE" | "ABORT" = "FAILURE";
        try {
          handle = driver.createHandle(request);
          stages.push("HANDLE_CREATED");
          throwIfAborted(executionSignal);
          assertRequestBinding(request, requestSha256);
          await driver.prepare(handle, request, executionSignal);
          stages.push("LAYOUT_PREPARED");
          throwIfAborted(executionSignal);
          assertRequestBinding(request, requestSha256);
          const workerOutput = await driver.runWorker(handle, request, executionSignal);
          throwIfAborted(executionSignal);
          driver.validateWorkerOutput(workerOutput, request);
          stages.push("WORKER_RESULT_VALIDATED");
          assertRequestBinding(request, requestSha256);
          const verifierOutput = await driver.runVerifier(
            handle,
            workerOutput,
            request,
            executionSignal,
          );
          throwIfAborted(executionSignal);
          driver.validateVerifierOutput(verifierOutput, request);
          stages.push("VERIFIER_RESULT_VALIDATED");
          assertRequestBinding(request, requestSha256);
          reason = "SUCCESS";
        } catch (error) {
          failure = error;
          reason = executionSignal.aborted ? "ABORT" : "FAILURE";
        } finally {
          clearTimeout(wallTimer);
        }
        if (handle === undefined) {
          throw failure instanceof Error ? failure : new Error("The worker lifecycle failed.");
        }
        const cleanupController = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        const cleanupDeadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error("Supervisor cleanup timed out.");
            cleanupController.abort(error);
            reject(error);
          }, cleanupTimeoutMs);
        });
        try {
          const cleanup = await Promise.race([
            driver.cleanup(handle, reason, cleanupController.signal),
            cleanupDeadline,
          ]);
          assertCleanup(cleanup);
          stages.push("SUPERVISOR_CLEANUP_VALIDATED");
        } catch (cleanupError) {
          poisoned = true;
          throw new Error("Supervisor-owned worker cleanup failed.", { cause: cleanupError });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        if (failure !== null) {
          throw failure instanceof Error ? failure : new Error("The worker lifecycle failed.");
        }
        return {
          schemaVersion: "1",
          status: "STATIC_DRIVER_TEST_ONLY",
          requestSha256,
          stages,
          dynamicIsolationVerified: false,
          liveCodexExecuted: false,
        };
      } finally {
        active = false;
      }
    },
  };
}
