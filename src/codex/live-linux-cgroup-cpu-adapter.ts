import { LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES } from "./live-linux-cgroup-cpu-evidence-v2.js";
import type {
  LiveLinuxCgroupCpuDedicatedSuccessStage,
  PrivateLiveLinuxCgroupCpuAdapter,
  PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract,
  PrivateLiveLinuxCgroupCpuFinalizedEvidence,
} from "./live-linux-cgroup-cpu-adapter-capability.js";

const privateAdapterCapabilities = new WeakSet<object>();

// No issuer exists in this checkpoint. The future concrete Linux lifecycle may add a result only
// after independent cleanup, cgroup release, and controller stop have all completed.
const finalizedEvidenceCapabilities = new WeakSet<object>();

export const LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES = Object.freeze([
  "REQUEST_VALIDATED",
  "PRIVATE_ADAPTER_ADMITTED",
  "OWNED_CONTAINERS_CREATED",
  "EGRESS_START_BARRIER_HELD",
  "EGRESS_CGROUP_BOUND",
  "EGRESS_BASELINE_RECORDED",
  "EGRESS_START_BARRIER_RELEASED",
  "WORKER_START_BARRIER_HELD",
  "WORKER_CGROUP_BOUND",
  "WORKER_BASELINE_RECORDED",
  "WORKER_START_BARRIER_RELEASED",
  "WORKER_EXECUTION_OBSERVED",
  "WORKER_STOPPED_OR_CONTAINED",
  "WORKER_DOCKER_RELEASED",
  "WORKER_CGROUP_RELEASED",
  "EGRESS_STOPPED_OR_CONTAINED",
  "EGRESS_DOCKER_RELEASED",
  "EGRESS_CGROUP_RELEASED",
  "VERIFIER_START_BARRIER_HELD",
  "VERIFIER_CGROUP_BOUND",
  "VERIFIER_BASELINE_RECORDED",
  "VERIFIER_START_BARRIER_RELEASED",
  "VERIFIER_EXECUTION_OBSERVED",
  "VERIFIER_STOPPED_OR_CONTAINED",
  "VERIFIER_DOCKER_RELEASED",
  "VERIFIER_CGROUP_RELEASED",
  "CONTROLLER_STOPPED",
  "EVIDENCE_FINALIZED",
] as const satisfies readonly LiveLinuxCgroupCpuDedicatedSuccessStage[]);

export interface PrivateLiveLinuxCgroupCpuAdapterScaffoldOptions {
  cleanupTimeoutMs: number;
}

export function createPrivateLiveLinuxCgroupCpuAdapterScaffold(
  options: PrivateLiveLinuxCgroupCpuAdapterScaffoldOptions,
): PrivateLiveLinuxCgroupCpuAdapter {
  const cleanupTimeoutMs = options.cleanupTimeoutMs;
  if (
    !Number.isInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < 1_000 ||
    cleanupTimeoutMs > 60_000
  ) {
    throw new Error("The private real-Linux adapter cleanup timeout is invalid.");
  }
  const adapter = Object.freeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_CAPABILITY_SCAFFOLD_ONLY" as const,
    runtimeAvailable: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
    cleanupTimeoutMs,
    requiredClock: "CLOCK_MONOTONIC_RAW_NS" as const,
    roles: Object.freeze([...LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES]) as readonly [
      "egress",
      "worker",
      "verifier",
    ],
  }) as unknown as PrivateLiveLinuxCgroupCpuAdapter;
  privateAdapterCapabilities.add(adapter);
  return adapter;
}

export function assertPrivateLiveLinuxCgroupCpuAdapter(
  value: unknown,
): asserts value is PrivateLiveLinuxCgroupCpuAdapter {
  if (
    typeof value !== "object" ||
    value === null ||
    !privateAdapterCapabilities.has(value)
  ) {
    throw new Error(
      "A live Linux cgroup CPU adapter must be created by the private real-Linux adapter factory.",
    );
  }
}

export function createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract(
  adapter: PrivateLiveLinuxCgroupCpuAdapter,
): PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract {
  assertPrivateLiveLinuxCgroupCpuAdapter(adapter);
  return Object.freeze({
    schemaVersion: "1" as const,
    status: "DEDICATED_LIFECYCLE_CONTRACT_ONLY" as const,
    runtimeImplemented: false as const,
    startBarrierImplemented: false as const,
    finalizedEvidenceIssuanceImplemented: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
    independentCleanupSignalRequired: true as const,
    serialPollingRequired: true as const,
    identityRevalidationEverySampleRequired: true as const,
    cleanupFailureSticky: true as const,
    finalizeAfterCleanupRequired: true as const,
    successStages: Object.freeze([...LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES]),
  });
}

export function assertPrivateLiveLinuxCgroupCpuFinalizedEvidence(
  value: unknown,
): asserts value is PrivateLiveLinuxCgroupCpuFinalizedEvidence {
  if (
    typeof value !== "object" ||
    value === null ||
    !finalizedEvidenceCapabilities.has(value)
  ) {
    throw new Error(
      "Live Linux cgroup CPU evidence must be finalized by the private real-Linux lifecycle.",
    );
  }
}
