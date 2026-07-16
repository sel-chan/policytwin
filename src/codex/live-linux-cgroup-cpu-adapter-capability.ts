import type { LiveLinuxCgroupCpuEvidenceV2 } from "./live-linux-cgroup-cpu-evidence-v2.js";

/** Compile-time brands only. Runtime authority is module-private object identity. */
export declare const PRIVATE_LIVE_LINUX_CGROUP_CPU_ADAPTER: unique symbol;
export declare const PRIVATE_LIVE_LINUX_CGROUP_CPU_FINALIZED_EVIDENCE: unique symbol;

export type LiveLinuxCgroupCpuDedicatedSuccessStage =
  | "REQUEST_VALIDATED"
  | "PRIVATE_ADAPTER_ADMITTED"
  | "OWNED_CONTAINERS_CREATED"
  | "EGRESS_START_BARRIER_HELD"
  | "EGRESS_CGROUP_BOUND"
  | "EGRESS_BASELINE_RECORDED"
  | "EGRESS_START_BARRIER_RELEASED"
  | "WORKER_START_BARRIER_HELD"
  | "WORKER_CGROUP_BOUND"
  | "WORKER_BASELINE_RECORDED"
  | "WORKER_START_BARRIER_RELEASED"
  | "WORKER_EXECUTION_OBSERVED"
  | "WORKER_STOPPED_OR_CONTAINED"
  | "WORKER_DOCKER_RELEASED"
  | "WORKER_CGROUP_RELEASED"
  | "EGRESS_STOPPED_OR_CONTAINED"
  | "EGRESS_DOCKER_RELEASED"
  | "EGRESS_CGROUP_RELEASED"
  | "VERIFIER_START_BARRIER_HELD"
  | "VERIFIER_CGROUP_BOUND"
  | "VERIFIER_BASELINE_RECORDED"
  | "VERIFIER_START_BARRIER_RELEASED"
  | "VERIFIER_EXECUTION_OBSERVED"
  | "VERIFIER_STOPPED_OR_CONTAINED"
  | "VERIFIER_DOCKER_RELEASED"
  | "VERIFIER_CGROUP_RELEASED"
  | "CONTROLLER_STOPPED"
  | "EVIDENCE_FINALIZED";

export interface PrivateLiveLinuxCgroupCpuAdapter {
  readonly [PRIVATE_LIVE_LINUX_CGROUP_CPU_ADAPTER]: "PRIVATE_REAL_LINUX_ADAPTER";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_CAPABILITY_SCAFFOLD_ONLY";
  readonly runtimeAvailable: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
  readonly cleanupTimeoutMs: number;
  readonly requiredClock: "CLOCK_MONOTONIC_RAW_NS";
  readonly roles: readonly ["egress", "worker", "verifier"];
}

export interface PrivateLiveLinuxCgroupCpuDedicatedLifecycleContract {
  readonly schemaVersion: "1";
  readonly status: "DEDICATED_LIFECYCLE_CONTRACT_ONLY";
  readonly runtimeImplemented: false;
  readonly startBarrierImplemented: false;
  readonly startBarrierProtocolImplemented: true;
  readonly startBarrierHostOwnedReceiptSlotsImplemented: true;
  readonly startBarrierReceiptCommitBindingImplemented: true;
  readonly startBarrierConcurrentReleaseGuardImplemented: true;
  readonly nonPrivilegedLifecycleHarnessImplemented: true;
  readonly nativeHelperBoundaryPrepared: true;
  readonly nativeHelperBuildVerified: false;
  readonly nativeHelperRuntimeVerified: false;
  readonly finalizedEvidenceIssuanceImplemented: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
  readonly cleanupTimeoutMs: number;
  readonly independentCleanupSignalRequired: true;
  readonly serialPollingRequired: true;
  readonly identityRevalidationEverySampleRequired: true;
  readonly cleanupFailureSticky: true;
  readonly finalizeAfterCleanupRequired: true;
  readonly successStages: readonly LiveLinuxCgroupCpuDedicatedSuccessStage[];
}

export interface PrivateLiveLinuxCgroupCpuFinalizedEvidence {
  readonly [PRIVATE_LIVE_LINUX_CGROUP_CPU_FINALIZED_EVIDENCE]: "PRIVATE_FINALIZED_EVIDENCE";
  readonly evidence: LiveLinuxCgroupCpuEvidenceV2;
}
