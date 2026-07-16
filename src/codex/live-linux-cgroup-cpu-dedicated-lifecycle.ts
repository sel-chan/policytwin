import type {
  LiveLinuxCgroupCpuDedicatedSuccessStage,
  PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract,
} from "./live-linux-cgroup-cpu-adapter-capability.js";
import { LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES } from "./live-linux-cgroup-cpu-adapter.js";

const UINT64_MAX = (1n << 64n) - 1n;
const FORCED_TERMINATION_SETTLE_MS = 250;
const ROLE_ORDER = Object.freeze(["egress", "worker", "verifier"] as const);

export type DedicatedLifecycleRole = (typeof ROLE_ORDER)[number];
export type DedicatedLifecycleContainmentReason = "NORMAL" | "FAILURE" | "OVER_BUDGET";

export interface DedicatedLifecyclePortSample {
  readonly monotonicRawNs: bigint;
  readonly usageUsec: bigint;
  readonly populated: boolean;
  readonly directProcessCount: number;
}

/**
 * Non-privileged harness port. This interface can exercise ordering, arithmetic, and failure
 * handling, but it is deliberately not an authority-bearing real-Linux system adapter.
 */
export interface NonPrivilegedDedicatedLifecycleSystemPort {
  readonly provenance: "NON_PRIVILEGED_TEST_PORT";
  createOwnedContainers(signal: AbortSignal): Promise<void>;
  startRoleHeld(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  waitRoleBarrierHeld(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  bindRoleIdentityAndCgroup(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  readRoleBaselineCpuUsageUsec(
    role: DedicatedLifecycleRole,
    signal: AbortSignal,
  ): Promise<bigint>;
  releaseRoleBarrier(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  revalidateAndReadRoleCpuSample(
    role: DedicatedLifecycleRole,
    signal: AbortSignal,
  ): Promise<DedicatedLifecyclePortSample>;
  waitRoleExit(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  stopOrContainRole(
    role: DedicatedLifecycleRole,
    reason: DedicatedLifecycleContainmentReason,
    signal: AbortSignal,
  ): Promise<void>;
  readQuiescentRoleCpuSample(
    role: DedicatedLifecycleRole,
    signal: AbortSignal,
  ): Promise<DedicatedLifecyclePortSample>;
  releaseRoleDocker(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  releaseRoleCgroup(role: DedicatedLifecycleRole, signal: AbortSignal): Promise<void>;
  stopController(signal: AbortSignal): Promise<void>;
  terminateControllerAfterCleanupTimeout(): Promise<void>;
}

export type DedicatedLifecycleFailureCode =
  | "CPU_BUDGET_EXCEEDED"
  | "EXECUTION_ABORTED"
  | "RAW_CLOCK_INVALID"
  | "ROLE_IDENTITY_REVALIDATION_FAILED"
  | "ROLE_CPU_COUNTER_INVALID"
  | "ROLE_EXECUTION_FAILED"
  | "LIFECYCLE_OPERATION_FAILED";

export interface DedicatedLifecycleSample {
  readonly sequence: number;
  readonly monotonicRawNs: string;
  readonly role: DedicatedLifecycleRole;
  readonly usageUsec: string;
  readonly cumulativeCpuUsec: string;
}

export interface NonPrivilegedDedicatedLifecycleCompletedResult {
  readonly schemaVersion: "1";
  readonly status: "COMPLETED_NOT_FINALIZED";
  readonly harnessProvenance: "NON_PRIVILEGED_TEST_PORT";
  readonly liveClaim: false;
  readonly dynamicRuntimeVerified: false;
  readonly finalizedEvidenceIssued: false;
  readonly passSigningEligible: false;
  readonly finalizationBlockedReason: "FINALIZED_EVIDENCE_ISSUER_NOT_IMPLEMENTED";
  readonly cleanupFailureSticky: false;
  readonly cleanupFailures: readonly [];
  readonly completedSuccessStages: readonly LiveLinuxCgroupCpuDedicatedSuccessStage[];
  readonly samples: readonly DedicatedLifecycleSample[];
  readonly cumulativeCpuUsec: string;
}

export interface NonPrivilegedDedicatedLifecycleFailedResult {
  readonly schemaVersion: "1";
  readonly status: "FAILED_NOT_FINALIZED";
  readonly harnessProvenance: "NON_PRIVILEGED_TEST_PORT";
  readonly liveClaim: false;
  readonly dynamicRuntimeVerified: false;
  readonly finalizedEvidenceIssued: false;
  readonly passSigningEligible: false;
  readonly failureCode: DedicatedLifecycleFailureCode;
  readonly cleanupFailureSticky: boolean;
  readonly cleanupFailures: readonly string[];
  readonly completedSuccessStages: readonly LiveLinuxCgroupCpuDedicatedSuccessStage[];
  readonly samples: readonly DedicatedLifecycleSample[];
  readonly cumulativeCpuUsec: string;
}

export type NonPrivilegedDedicatedLifecycleResult =
  | NonPrivilegedDedicatedLifecycleCompletedResult
  | NonPrivilegedDedicatedLifecycleFailedResult;

export interface RunNonPrivilegedDedicatedLifecycleHarnessOptions {
  lifecycleContract: PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract;
  system: NonPrivilegedDedicatedLifecycleSystemPort;
  maximumCumulativeCpuUsec: bigint;
  pollIntervalMs: number;
  executionSignal?: AbortSignal;
}

class LifecycleFailure extends Error {
  constructor(
    readonly code: DedicatedLifecycleFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "LifecycleFailure";
  }
}

class UnsettledCleanupFatal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsettledCleanupFatal";
  }
}

function validateSystem(system: NonPrivilegedDedicatedLifecycleSystemPort) {
  const methods = [
    "createOwnedContainers",
    "startRoleHeld",
    "waitRoleBarrierHeld",
    "bindRoleIdentityAndCgroup",
    "readRoleBaselineCpuUsageUsec",
    "releaseRoleBarrier",
    "revalidateAndReadRoleCpuSample",
    "waitRoleExit",
    "stopOrContainRole",
    "readQuiescentRoleCpuSample",
    "releaseRoleDocker",
    "releaseRoleCgroup",
    "stopController",
    "terminateControllerAfterCleanupTimeout",
  ] as const;
  if (
    typeof system !== "object" ||
    system === null ||
    system.provenance !== "NON_PRIVILEGED_TEST_PORT" ||
    methods.some((name) => typeof system[name] !== "function")
  ) {
    throw new Error("The non-privileged dedicated lifecycle system port is invalid.");
  }
}

function validateContract(contract: PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract) {
  if (
    typeof contract !== "object" ||
    contract === null ||
    contract.schemaVersion !== "1" ||
    contract.finalizedEvidenceIssuanceImplemented !== false ||
    contract.liveEvidenceIssuanceEnabled !== false ||
    contract.passSigningEligible !== false ||
    contract.cleanupFailureSticky !== true ||
    contract.finalizeAfterCleanupRequired !== true ||
    !Array.isArray(contract.successStages) ||
    contract.successStages.length !== LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES.length ||
    contract.successStages.some(
      (stage, index) => stage !== LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES[index],
    )
  ) {
    throw new Error("The dedicated lifecycle contract is invalid or unsafe.");
  }
}

function validUint64(value: bigint) {
  return typeof value === "bigint" && value >= 0n && value <= UINT64_MAX;
}

function pollDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolveDelay, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveDelay();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function shortFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\u0000-\u001f\u007f]+/gu, " ").slice(0, 256);
}

function freezeSamples(samples: readonly DedicatedLifecycleSample[]) {
  return Object.freeze(samples.map((sample) => Object.freeze({ ...sample })));
}

export async function runNonPrivilegedLiveLinuxCgroupCpuDedicatedLifecycleHarness(
  options: RunNonPrivilegedDedicatedLifecycleHarnessOptions,
): Promise<NonPrivilegedDedicatedLifecycleResult> {
  const lifecycleContract = options.lifecycleContract;
  const system = options.system;
  const maximumCumulativeCpuUsec = options.maximumCumulativeCpuUsec;
  const pollIntervalMs = options.pollIntervalMs;
  const executionSignal = options.executionSignal ?? new AbortController().signal;
  validateContract(lifecycleContract);
  validateSystem(system);
  if (!validUint64(maximumCumulativeCpuUsec) || maximumCumulativeCpuUsec < 1n) {
    throw new Error("The dedicated lifecycle cumulative CPU budget is invalid.");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 10_000) {
    throw new Error("The dedicated lifecycle poll interval is invalid.");
  }
  if (!(executionSignal instanceof AbortSignal)) {
    throw new Error("The dedicated lifecycle execution signal is invalid.");
  }

  const completedStages: LiveLinuxCgroupCpuDedicatedSuccessStage[] = [];
  const samples: DedicatedLifecycleSample[] = [];
  const cleanupFailures: string[] = [];
  const startedRoles = new Set<DedicatedLifecycleRole>();
  const activeRoles = new Set<DedicatedLifecycleRole>();
  const dockerReleased = new Set<DedicatedLifecycleRole>();
  const cgroupReleased = new Set<DedicatedLifecycleRole>();
  const baselines = new Map<DedicatedLifecycleRole, bigint>();
  const latestUsage = new Map<DedicatedLifecycleRole, bigint>();
  let lastRawNs: bigint | undefined;
  let cumulativeCpuUsec = 0n;
  let controllerStopped = false;
  let controllerForceTerminated = false;

  function mark(stage: LiveLinuxCgroupCpuDedicatedSuccessStage) {
    const expected = LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES[completedStages.length];
    if (stage !== expected || stage === "EVIDENCE_FINALIZED") {
      throw new LifecycleFailure(
        "LIFECYCLE_OPERATION_FAILED",
        `Dedicated lifecycle stage ${stage} is out of order.`,
      );
    }
    completedStages.push(stage);
  }

  function throwIfExecutionAborted() {
    if (executionSignal.aborted) {
      throw new LifecycleFailure("EXECUTION_ABORTED", "The execution signal was aborted.");
    }
  }

  async function executionOperation<T>(operation: () => Promise<T>) {
    throwIfExecutionAborted();
    const value = await operation();
    throwIfExecutionAborted();
    return value;
  }

  function recomputeCumulative() {
    let total = 0n;
    for (const role of ROLE_ORDER) {
      const baseline = baselines.get(role);
      const latest = latestUsage.get(role);
      if (baseline !== undefined && latest !== undefined) total += latest - baseline;
    }
    if (total > UINT64_MAX) {
      throw new LifecycleFailure("ROLE_CPU_COUNTER_INVALID", "The cumulative CPU counter overflowed.");
    }
    cumulativeCpuUsec = total;
  }

  function recordRoleSample(
    role: DedicatedLifecycleRole,
    sample: DedicatedLifecyclePortSample,
    requireQuiescent: boolean,
  ) {
    if (
      typeof sample !== "object" ||
      sample === null ||
      !validUint64(sample.monotonicRawNs) ||
      !validUint64(sample.usageUsec) ||
      typeof sample.populated !== "boolean" ||
      !Number.isSafeInteger(sample.directProcessCount) ||
      sample.directProcessCount < 0 ||
      sample.directProcessCount > 0xffff_ffff
    ) {
      throw new LifecycleFailure("ROLE_CPU_COUNTER_INVALID", `${role}: sample is invalid.`);
    }
    if (lastRawNs !== undefined && sample.monotonicRawNs <= lastRawNs) {
      throw new LifecycleFailure("RAW_CLOCK_INVALID", "The RAW clock did not advance strictly.");
    }
    if (requireQuiescent && (sample.populated || sample.directProcessCount !== 0)) {
      throw new LifecycleFailure(
        "ROLE_IDENTITY_REVALIDATION_FAILED",
        `${role}: the final cgroup sample is not quiescent.`,
      );
    }
    const baseline = baselines.get(role);
    const previous = latestUsage.get(role);
    if (
      baseline === undefined ||
      sample.usageUsec < baseline ||
      (previous !== undefined && sample.usageUsec < previous)
    ) {
      throw new LifecycleFailure(
        "ROLE_CPU_COUNTER_INVALID",
        `${role}: the CPU counter is invalid or regressed.`,
      );
    }
    lastRawNs = sample.monotonicRawNs;
    latestUsage.set(role, sample.usageUsec);
    recomputeCumulative();
    samples.push({
      sequence: samples.length,
      monotonicRawNs: sample.monotonicRawNs.toString(),
      role,
      usageUsec: sample.usageUsec.toString(),
      cumulativeCpuUsec: cumulativeCpuUsec.toString(),
    });
    if (cumulativeCpuUsec > maximumCumulativeCpuUsec) {
      throw new LifecycleFailure(
        "CPU_BUDGET_EXCEEDED",
        "The aggregate cgroup CPU budget was exceeded.",
      );
    }
  }

  async function sampleActiveRoles() {
    throwIfExecutionAborted();
    for (const role of ROLE_ORDER) {
      if (!activeRoles.has(role)) continue;
      let sample: DedicatedLifecyclePortSample;
      try {
        sample = await executionOperation(() =>
          system.revalidateAndReadRoleCpuSample(role, executionSignal),
        );
      } catch (error) {
        if (error instanceof LifecycleFailure) throw error;
        if (executionSignal.aborted) throwIfExecutionAborted();
        throw new LifecycleFailure(
          "ROLE_IDENTITY_REVALIDATION_FAILED",
          `${role}: ${shortFailure(error)}`,
        );
      }
      recordRoleSample(role, sample, false);
    }
  }

  async function setupRole(
    role: DedicatedLifecycleRole,
    heldStage: LiveLinuxCgroupCpuDedicatedSuccessStage,
    boundStage: LiveLinuxCgroupCpuDedicatedSuccessStage,
    baselineStage: LiveLinuxCgroupCpuDedicatedSuccessStage,
    releasedStage: LiveLinuxCgroupCpuDedicatedSuccessStage,
  ) {
    await executionOperation(() => system.startRoleHeld(role, executionSignal));
    startedRoles.add(role);
    activeRoles.add(role);
    await executionOperation(() => system.waitRoleBarrierHeld(role, executionSignal));
    mark(heldStage);
    await executionOperation(() => system.bindRoleIdentityAndCgroup(role, executionSignal));
    mark(boundStage);
    const baseline = await executionOperation(() =>
      system.readRoleBaselineCpuUsageUsec(role, executionSignal),
    );
    if (!validUint64(baseline)) {
      throw new LifecycleFailure("ROLE_CPU_COUNTER_INVALID", `${role}: baseline is invalid.`);
    }
    baselines.set(role, baseline);
    latestUsage.set(role, baseline);
    mark(baselineStage);
    await executionOperation(() => system.releaseRoleBarrier(role, executionSignal));
    mark(releasedStage);
  }

  async function observeUntilRoleExit(role: DedicatedLifecycleRole) {
    throwIfExecutionAborted();
    const exitOutcome = system.waitRoleExit(role, executionSignal).then(
      () => ({ status: "EXITED" as const }),
      (error: unknown) => ({ status: "FAILED" as const, error }),
    );
    throwIfExecutionAborted();
    await sampleActiveRoles();
    for (;;) {
      const outcome = await Promise.race([
        exitOutcome,
        pollDelay(pollIntervalMs, executionSignal).then(() => ({ status: "POLL" as const })),
      ]).catch((error: unknown) => {
        if (executionSignal.aborted) throwIfExecutionAborted();
        throw error;
      });
      if (outcome.status === "POLL") {
        await sampleActiveRoles();
        continue;
      }
      if (outcome.status === "FAILED") {
        if (executionSignal.aborted) throwIfExecutionAborted();
        throw new LifecycleFailure("ROLE_EXECUTION_FAILED", shortFailure(outcome.error));
      }
      await sampleActiveRoles();
      return;
    }
  }

  async function runIndependentCleanup(
    label: string,
    operation: (signal: AbortSignal) => Promise<void>,
  ) {
    const cleanupController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const operationOutcome = operation(cleanupController.signal).then(
      () => ({ status: "SETTLED" as const }),
      (error: unknown) => ({ status: "FAILED" as const, error }),
    );
    const timeoutOutcome = new Promise<{ status: "TIMED_OUT" }>((resolveTimeout) => {
      timeoutHandle = setTimeout(
        () => resolveTimeout({ status: "TIMED_OUT" }),
        lifecycleContract.cleanupTimeoutMs,
      );
    });
    const first = await Promise.race([operationOutcome, timeoutOutcome]);
    if (first.status === "TIMED_OUT") {
      cleanupController.abort(new Error(`${label} cleanup timed out.`));
      if (!controllerForceTerminated) {
        try {
          await system.terminateControllerAfterCleanupTimeout();
        } catch (error) {
          cleanupFailures.push(`controller forced termination: ${shortFailure(error)}`);
        }
        controllerForceTerminated = true;
      }
      const forcedSettlement = await Promise.race([
        operationOutcome,
        new Promise<{ status: "UNSETTLED" }>((resolveUnsettled) =>
          setTimeout(
            () => resolveUnsettled({ status: "UNSETTLED" }),
            FORCED_TERMINATION_SETTLE_MS,
          ),
        ),
      ]);
      if (forcedSettlement.status === "UNSETTLED") {
        throw new UnsettledCleanupFatal(
          `${label} remained unsettled after forced termination; no lifecycle result may be returned.`,
        );
      }
      cleanupFailures.push(`${label}: cleanup timed out and forced controller termination.`);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      return { success: false as const };
    }
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (first.status === "FAILED") {
      if (first.error instanceof LifecycleFailure) {
        return { success: false as const, lifecycleFailure: first.error };
      }
      cleanupFailures.push(`${label}: ${shortFailure(first.error)}`);
      return { success: false as const };
    }
    return { success: true as const };
  }

  async function cleanupRole(
    role: DedicatedLifecycleRole,
    reason: DedicatedLifecycleContainmentReason,
    recordSuccessStages: boolean,
  ) {
    if (!startedRoles.has(role)) {
      if (!dockerReleased.has(role)) {
        const released = await runIndependentCleanup(`${role} unstarted Docker release`, (signal) =>
          system.releaseRoleDocker(role, signal),
        );
        if (released.success) dockerReleased.add(role);
      }
      return;
    }
    if (!activeRoles.has(role) && dockerReleased.has(role) && cgroupReleased.has(role)) return;
    const stagePrefix = role.toUpperCase();
    let terminalFailure: LifecycleFailure | undefined;
    let finalSampleCompleted = false;
    const stopped = await runIndependentCleanup(`${role} stop-or-contain`, (signal) =>
      system.stopOrContainRole(role, reason, signal),
    );
    if (stopped.success && baselines.has(role)) {
      const finalSample = await runIndependentCleanup(`${role} quiescent final CPU sample`, async (signal) => {
        const sample = await system.readQuiescentRoleCpuSample(role, signal);
        recordRoleSample(role, sample, true);
      });
      terminalFailure = finalSample.lifecycleFailure;
      finalSampleCompleted = finalSample.success;
    }
    const canRecordSuccess =
      stopped.success && finalSampleCompleted && terminalFailure === undefined && recordSuccessStages;
    if (canRecordSuccess) {
      mark(`${stagePrefix}_STOPPED_OR_CONTAINED` as LiveLinuxCgroupCpuDedicatedSuccessStage);
    }
    if (!dockerReleased.has(role)) {
      const released = await runIndependentCleanup(`${role} Docker release`, (signal) =>
        system.releaseRoleDocker(role, signal),
      );
      if (released.success) {
        dockerReleased.add(role);
        if (canRecordSuccess) {
          mark(`${stagePrefix}_DOCKER_RELEASED` as LiveLinuxCgroupCpuDedicatedSuccessStage);
        }
      }
    }
    if (!cgroupReleased.has(role)) {
      const released = await runIndependentCleanup(`${role} cgroup release`, (signal) =>
        system.releaseRoleCgroup(role, signal),
      );
      if (released.success) {
        cgroupReleased.add(role);
        activeRoles.delete(role);
        if (canRecordSuccess) {
          mark(`${stagePrefix}_CGROUP_RELEASED` as LiveLinuxCgroupCpuDedicatedSuccessStage);
        }
      }
    }
    if (terminalFailure !== undefined) throw terminalFailure;
  }

  async function stopController(recordSuccessStage: boolean) {
    if (controllerStopped) return;
    const stopped = await runIndependentCleanup("controller stop", (signal) =>
      system.stopController(signal),
    );
    if (stopped.success) {
      controllerStopped = true;
      if (recordSuccessStage) mark("CONTROLLER_STOPPED");
    }
  }

  mark("REQUEST_VALIDATED");
  mark("PRIVATE_ADAPTER_ADMITTED");
  try {
    await executionOperation(() => system.createOwnedContainers(executionSignal));
    mark("OWNED_CONTAINERS_CREATED");
    await setupRole(
      "egress",
      "EGRESS_START_BARRIER_HELD",
      "EGRESS_CGROUP_BOUND",
      "EGRESS_BASELINE_RECORDED",
      "EGRESS_START_BARRIER_RELEASED",
    );
    await setupRole(
      "worker",
      "WORKER_START_BARRIER_HELD",
      "WORKER_CGROUP_BOUND",
      "WORKER_BASELINE_RECORDED",
      "WORKER_START_BARRIER_RELEASED",
    );
    await observeUntilRoleExit("worker");
    mark("WORKER_EXECUTION_OBSERVED");
    const failuresBeforeWorkerCleanup = cleanupFailures.length;
    await cleanupRole("worker", "NORMAL", true);
    await cleanupRole("egress", "NORMAL", true);
    if (cleanupFailures.length !== failuresBeforeWorkerCleanup) {
      throw new LifecycleFailure("LIFECYCLE_OPERATION_FAILED", "Worker cleanup was incomplete.");
    }
    await setupRole(
      "verifier",
      "VERIFIER_START_BARRIER_HELD",
      "VERIFIER_CGROUP_BOUND",
      "VERIFIER_BASELINE_RECORDED",
      "VERIFIER_START_BARRIER_RELEASED",
    );
    await observeUntilRoleExit("verifier");
    mark("VERIFIER_EXECUTION_OBSERVED");
    const failuresBeforeVerifierCleanup = cleanupFailures.length;
    await cleanupRole("verifier", "NORMAL", true);
    if (cleanupFailures.length !== failuresBeforeVerifierCleanup) {
      throw new LifecycleFailure("LIFECYCLE_OPERATION_FAILED", "Verifier cleanup was incomplete.");
    }
    await stopController(true);
    if (cleanupFailures.length > 0 || !controllerStopped) {
      throw new LifecycleFailure("LIFECYCLE_OPERATION_FAILED", "Controller cleanup was incomplete.");
    }
    return Object.freeze({
      schemaVersion: "1" as const,
      status: "COMPLETED_NOT_FINALIZED" as const,
      harnessProvenance: "NON_PRIVILEGED_TEST_PORT" as const,
      liveClaim: false as const,
      dynamicRuntimeVerified: false as const,
      finalizedEvidenceIssued: false as const,
      passSigningEligible: false as const,
      finalizationBlockedReason: "FINALIZED_EVIDENCE_ISSUER_NOT_IMPLEMENTED" as const,
      cleanupFailureSticky: false as const,
      cleanupFailures: Object.freeze([]) as readonly [],
      completedSuccessStages: Object.freeze([...completedStages]),
      samples: freezeSamples(samples),
      cumulativeCpuUsec: cumulativeCpuUsec.toString(),
    });
  } catch (error) {
    if (error instanceof UnsettledCleanupFatal) throw error;
    let failure =
      error instanceof LifecycleFailure
        ? error
        : new LifecycleFailure(
            executionSignal.aborted ? "EXECUTION_ABORTED" : "LIFECYCLE_OPERATION_FAILED",
            shortFailure(error),
          );
    const reason: DedicatedLifecycleContainmentReason =
      failure.code === "CPU_BUDGET_EXCEEDED" ? "OVER_BUDGET" : "FAILURE";
    for (const role of [...ROLE_ORDER].reverse()) {
      if (activeRoles.has(role) || !dockerReleased.has(role) || (startedRoles.has(role) && !cgroupReleased.has(role))) {
        try {
          await cleanupRole(role, reason, false);
        } catch (cleanupError) {
          if (cleanupError instanceof UnsettledCleanupFatal) throw cleanupError;
          if (
            cleanupError instanceof LifecycleFailure &&
            cleanupError.code === "CPU_BUDGET_EXCEEDED"
          ) {
            if (failure.code === "LIFECYCLE_OPERATION_FAILED") failure = cleanupError;
          } else {
            cleanupFailures.push(`${role} terminal cleanup: ${shortFailure(cleanupError)}`);
          }
        }
      }
    }
    await stopController(false);
    return Object.freeze({
      schemaVersion: "1" as const,
      status: "FAILED_NOT_FINALIZED" as const,
      harnessProvenance: "NON_PRIVILEGED_TEST_PORT" as const,
      liveClaim: false as const,
      dynamicRuntimeVerified: false as const,
      finalizedEvidenceIssued: false as const,
      passSigningEligible: false as const,
      failureCode: failure.code,
      cleanupFailureSticky: cleanupFailures.length > 0,
      cleanupFailures: Object.freeze([...cleanupFailures]),
      completedSuccessStages: Object.freeze([...completedStages]),
      samples: freezeSamples(samples),
      cumulativeCpuUsec: cumulativeCpuUsec.toString(),
    });
  }
}
