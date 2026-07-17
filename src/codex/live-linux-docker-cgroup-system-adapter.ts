import type {
  DedicatedLifecycleContainmentReason,
  DedicatedLifecyclePortSample,
  DedicatedLifecycleRole,
} from "./live-linux-cgroup-cpu-dedicated-lifecycle.js";
import {
  type PrivateLiveLinuxDockerOwner,
  type PrivateLiveLinuxDockerRemovalReceipt,
  type PrivateLiveLinuxOwnedDockerRole,
  assertPrivateLiveLinuxDockerOwner,
  assertPrivateLiveLinuxDockerOwnerBarrierConfiguration,
  createPrivateLiveLinuxOwnedDockerContainers,
  destroyPrivateLiveLinuxDockerOwner,
  finalizePrivateLiveLinuxDockerCleanupReceipt,
  issuePrivateLiveLinuxOwnedDockerRole,
  removePrivateLiveLinuxOwnedDockerNetworks,
  removePrivateLiveLinuxOwnedDockerRole,
  reobservePrivateLiveLinuxOwnedDockerRole,
  settlePrivateLiveLinuxDockerOwnerOperations,
  startPrivateLiveLinuxOwnedDockerRoleHeld,
  stopPrivateLiveLinuxOwnedDockerRole,
  waitPrivateLiveLinuxOwnedDockerRoleExit,
} from "./live-linux-docker-owned-container.js";
import {
  type PrivateLinuxCgroupHelperBoundRole,
  type PrivateLinuxCgroupHelperClient,
  activatePrivateLinuxCgroupHelperRole,
  assertPrivateLinuxCgroupHelperClient,
  bindPrivateLinuxCgroupHelperRole,
  freezePrivateLinuxCgroupHelperRole,
  killPrivateLinuxCgroupHelperRole,
  readQuiescentPrivateLinuxCgroupHelperRole,
  releasePrivateLinuxCgroupHelperRole,
  samplePrivateLinuxCgroupHelperRole,
  stopPrivateLinuxCgroupHelperClient,
  terminatePrivateLinuxCgroupHelperAfterDockerCleanup,
} from "./linux-cgroup-helper-client.js";
import {
  type PrivateLinuxStartBarrierController,
  type PrivatePreparedLinuxStartBarrierRole,
  assertPrivateLinuxStartBarrierController,
  assertPrivatePreparedLinuxStartBarrierRole,
  awaitPrivateLinuxStartBarrierHeld,
  destroyPrivateLinuxStartBarrierController,
  releasePrivateLinuxStartBarrierRole,
} from "./linux-start-barrier.js";

const ROLE_ORDER = Object.freeze(["egress", "worker", "verifier"] as const);
const adapterStates = new WeakMap<object, AdapterState>();

export declare const PRIVATE_LIVE_LINUX_DOCKER_CGROUP_SYSTEM_ADAPTER: unique symbol;

export interface PrivateLiveLinuxDockerCgroupSystemAdapter {
  readonly [PRIVATE_LIVE_LINUX_DOCKER_CGROUP_SYSTEM_ADAPTER]: "PRIVATE_LIVE_LINUX_DOCKER_CGROUP_SYSTEM_ADAPTER";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_SYSTEM_ADAPTER_NOT_RUNTIME_VERIFIED";
  readonly provenance: "PRIVATE_LINUX_DOCKER_CGROUP_ADAPTER";
  readonly dynamicRuntimeVerified: false;
  readonly finalizedEvidenceIssued: false;
  readonly passSigningEligible: false;
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

interface AdapterRoleState {
  readonly preparedBarrier: PrivatePreparedLinuxStartBarrierRole;
  heldObserved: boolean;
  ownedRole: PrivateLiveLinuxOwnedDockerRole | undefined;
  boundRole: PrivateLinuxCgroupHelperBoundRole | undefined;
  postBindReobserved: boolean;
  barrierReleased: boolean;
  removalReceipt: PrivateLiveLinuxDockerRemovalReceipt | undefined;
  cgroupReleased: boolean;
}

interface AdapterState {
  readonly adapter: PrivateLiveLinuxDockerCgroupSystemAdapter;
  readonly owner: PrivateLiveLinuxDockerOwner;
  readonly barrierController: PrivateLinuxStartBarrierController;
  readonly helperClient: PrivateLinuxCgroupHelperClient;
  readonly roles: Readonly<Record<DedicatedLifecycleRole, AdapterRoleState>>;
  containersCreated: boolean;
  controllerStopped: boolean;
  forcedTerminationStarted: boolean;
}

function requiredState(adapter: PrivateLiveLinuxDockerCgroupSystemAdapter) {
  const state =
    typeof adapter === "object" && adapter !== null ? adapterStates.get(adapter) : undefined;
  if (state === undefined || state.controllerStopped) {
    throw new Error("The Linux Docker/cgroup adapter is not an active private capability.");
  }
  return state;
}

function roleState(state: AdapterState, role: DedicatedLifecycleRole) {
  const value = state.roles[role];
  if (value === undefined) throw new Error("The Linux Docker/cgroup adapter role is invalid.");
  return value;
}

function sampleView(sample: {
  monotonicRawNs: bigint;
  usageUsec: bigint;
  populated: boolean;
  directProcessCount: number;
}): DedicatedLifecyclePortSample {
  return Object.freeze({
    monotonicRawNs: sample.monotonicRawNs,
    usageUsec: sample.usageUsec,
    populated: sample.populated,
    directProcessCount: sample.directProcessCount,
  });
}

export function createPrivateLiveLinuxDockerCgroupSystemAdapter(options: {
  owner: PrivateLiveLinuxDockerOwner;
  barrierController: PrivateLinuxStartBarrierController;
  helperClient: PrivateLinuxCgroupHelperClient;
  preparedBarriers: Readonly<
    Record<DedicatedLifecycleRole, PrivatePreparedLinuxStartBarrierRole>
  >;
}): PrivateLiveLinuxDockerCgroupSystemAdapter {
  assertPrivateLiveLinuxDockerOwner(options.owner);
  assertPrivateLinuxStartBarrierController(options.barrierController);
  assertPrivateLinuxCgroupHelperClient(options.helperClient);
  assertPrivateLiveLinuxDockerOwnerBarrierConfiguration(
    options.owner,
    options.barrierController,
    options.preparedBarriers,
  );
  if (
    options.owner.runBindingSha256 !== options.barrierController.runBindingSha256 ||
    options.owner.runBindingSha256 !== options.helperClient.runBindingSha256
  ) {
    throw new Error("The private system adapter run bindings do not match.");
  }
  for (const role of ROLE_ORDER) {
    assertPrivatePreparedLinuxStartBarrierRole(
      options.barrierController,
      options.preparedBarriers[role],
    );
    if (
      options.preparedBarriers[role].roleProtocol.role !== role ||
      options.preparedBarriers[role].roleProtocol.runBindingSha256 !==
        options.owner.runBindingSha256
    ) {
      throw new Error("The private system adapter barrier roles are mismatched.");
    }
  }
  let adapter!: PrivateLiveLinuxDockerCgroupSystemAdapter;
  adapter = Object.freeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_SYSTEM_ADAPTER_NOT_RUNTIME_VERIFIED" as const,
    provenance: "PRIVATE_LINUX_DOCKER_CGROUP_ADAPTER" as const,
    dynamicRuntimeVerified: false as const,
    finalizedEvidenceIssued: false as const,
    passSigningEligible: false as const,
    async createOwnedContainers(signal: AbortSignal) {
      const state = requiredState(adapter);
      if (state.containersCreated) throw new Error("The adapter containers were already created.");
      await createPrivateLiveLinuxOwnedDockerContainers(state.owner, signal);
      state.containersCreated = true;
    },
    async startRoleHeld(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      if (!state.containersCreated) throw new Error("The adapter containers are not prepared.");
      await startPrivateLiveLinuxOwnedDockerRoleHeld(state.owner, role, signal);
    },
    async waitRoleBarrierHeld(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      if (signal.aborted) throw signal.reason;
      const current = roleState(state, role);
      await awaitPrivateLinuxStartBarrierHeld(
        state.barrierController,
        current.preparedBarrier,
      );
      if (signal.aborted) throw signal.reason;
      current.heldObserved = true;
    },
    async bindRoleIdentityAndCgroup(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (!current.heldObserved || current.ownedRole !== undefined || current.boundRole !== undefined) {
        throw new Error("The adapter role is not ready for one identity binding.");
      }
      const ownedRole = await issuePrivateLiveLinuxOwnedDockerRole(state.owner, role, signal);
      const beforeBind = await reobservePrivateLiveLinuxOwnedDockerRole(
        state.owner,
        ownedRole,
        signal,
      );
      const boundRole = await bindPrivateLinuxCgroupHelperRole(
        state.helperClient,
        state.owner,
        ownedRole,
        beforeBind,
        signal,
      );
      current.ownedRole = ownedRole;
      current.boundRole = boundRole;
      await reobservePrivateLiveLinuxOwnedDockerRole(state.owner, ownedRole, signal);
      current.postBindReobserved = true;
    },
    async readRoleBaselineCpuUsageUsec(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      if (signal.aborted) throw signal.reason;
      const current = roleState(state, role);
      if (current.boundRole === undefined || !current.postBindReobserved) {
        throw new Error("The adapter role baseline is unavailable before bound reobservation.");
      }
      return current.boundRole.baseline.usageUsec;
    },
    async releaseRoleBarrier(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      if (signal.aborted) throw signal.reason;
      const current = roleState(state, role);
      if (
        current.ownedRole === undefined ||
        current.boundRole === undefined ||
        !current.postBindReobserved ||
        current.barrierReleased
      ) {
        throw new Error("The adapter role cannot release its barrier before baseline binding.");
      }
      await releasePrivateLinuxStartBarrierRole(
        state.barrierController,
        current.preparedBarrier,
      );
      if (signal.aborted) throw signal.reason;
      activatePrivateLinuxCgroupHelperRole(
        state.helperClient,
        state.owner,
        current.ownedRole,
        current.boundRole,
      );
      current.barrierReleased = true;
    },
    async revalidateAndReadRoleCpuSample(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (current.boundRole === undefined || !current.barrierReleased) {
        throw new Error("The adapter role is not active for CPU sampling.");
      }
      return sampleView(
        await samplePrivateLinuxCgroupHelperRole(state.helperClient, current.boundRole, signal),
      );
    },
    async waitRoleExit(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (current.ownedRole === undefined || !current.barrierReleased) {
        throw new Error("The adapter role is not active for Docker wait.");
      }
      await waitPrivateLiveLinuxOwnedDockerRoleExit(state.owner, current.ownedRole, signal);
    },
    async stopOrContainRole(
      role: DedicatedLifecycleRole,
      reason: DedicatedLifecycleContainmentReason,
      signal: AbortSignal,
    ) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (current.ownedRole === undefined) {
        throw new Error("The adapter role lacks an owned Docker capability.");
      }
      if (reason === "NORMAL") {
        await stopPrivateLiveLinuxOwnedDockerRole(state.owner, current.ownedRole, signal);
        return;
      }
      if (current.boundRole === undefined) {
        throw new Error("The adapter role lacks a bound cgroup for containment.");
      }
      await freezePrivateLinuxCgroupHelperRole(state.helperClient, current.boundRole, signal);
      await killPrivateLinuxCgroupHelperRole(state.helperClient, current.boundRole, signal);
    },
    async readQuiescentRoleCpuSample(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (current.boundRole === undefined) {
        throw new Error("The adapter role lacks a bound cgroup for final sampling.");
      }
      return sampleView(
        await readQuiescentPrivateLinuxCgroupHelperRole(
          state.helperClient,
          current.boundRole,
          signal,
        ),
      );
    },
    async releaseRoleDocker(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      current.removalReceipt = await removePrivateLiveLinuxOwnedDockerRole(
        state.owner,
        role,
        signal,
      );
    },
    async releaseRoleCgroup(role: DedicatedLifecycleRole, signal: AbortSignal) {
      const state = requiredState(adapter);
      const current = roleState(state, role);
      if (
        current.boundRole === undefined &&
        current.removalReceipt !== undefined &&
        !current.cgroupReleased
      ) {
        current.cgroupReleased = true;
        return;
      }
      if (
        current.ownedRole === undefined ||
        current.boundRole === undefined ||
        current.removalReceipt === undefined ||
        current.cgroupReleased
      ) {
        throw new Error("The adapter role cannot release its cgroup before Docker absence.");
      }
      await releasePrivateLinuxCgroupHelperRole(
        state.helperClient,
        state.owner,
        current.ownedRole,
        current.removalReceipt,
        current.boundRole,
        signal,
      );
      current.cgroupReleased = true;
    },
    async stopController(signal: AbortSignal) {
      const state = requiredState(adapter);
      if (
        ROLE_ORDER.some((role) => {
          const current = roleState(state, role);
          return current.boundRole !== undefined && !current.cgroupReleased;
        })
      ) {
        throw new Error("The adapter controller cannot stop before every cgroup release.");
      }
      let firstFailure: unknown;
      try {
        await stopPrivateLinuxCgroupHelperClient(state.helperClient, signal);
      } catch (error) {
        firstFailure = error;
        try {
          const cleanupReceipt = await finalizePrivateLiveLinuxDockerCleanupReceipt(
            state.owner,
            signal,
          );
          await terminatePrivateLinuxCgroupHelperAfterDockerCleanup(
            state.helperClient,
            state.owner,
            cleanupReceipt,
          );
        } catch (terminationError) {
          firstFailure = new AggregateError(
            [error, terminationError],
            "The helper failed normal stop and verified emergency termination.",
          );
        }
      }
      try {
        await removePrivateLiveLinuxOwnedDockerNetworks(state.owner, signal);
      } catch (error) {
        firstFailure ??= error;
      }
      try {
        await destroyPrivateLinuxStartBarrierController(state.barrierController);
      } catch (error) {
        firstFailure ??= error;
      }
      try {
        destroyPrivateLiveLinuxDockerOwner(state.owner);
      } catch (error) {
        firstFailure ??= error;
      }
      state.controllerStopped = firstFailure === undefined;
      if (firstFailure !== undefined) throw firstFailure;
    },
    async terminateControllerAfterCleanupTimeout() {
      const state = requiredState(adapter);
      if (state.forcedTerminationStarted) return;
      state.forcedTerminationStarted = true;
      const signal = AbortSignal.timeout(30_000);
      await settlePrivateLiveLinuxDockerOwnerOperations(state.owner);
      for (const role of ROLE_ORDER) {
        roleState(state, role).removalReceipt = await removePrivateLiveLinuxOwnedDockerRole(
          state.owner,
          role,
          signal,
        );
      }
      const cleanupReceipt = await finalizePrivateLiveLinuxDockerCleanupReceipt(
        state.owner,
        signal,
      );
      await terminatePrivateLinuxCgroupHelperAfterDockerCleanup(
        state.helperClient,
        state.owner,
        cleanupReceipt,
      );
      await destroyPrivateLinuxStartBarrierController(state.barrierController);
      destroyPrivateLiveLinuxDockerOwner(state.owner);
      state.controllerStopped = true;
    },
  }) as unknown as PrivateLiveLinuxDockerCgroupSystemAdapter;
  const roles = Object.freeze({
    egress: {
      preparedBarrier: options.preparedBarriers.egress,
      heldObserved: false,
      ownedRole: undefined,
      boundRole: undefined,
      postBindReobserved: false,
      barrierReleased: false,
      removalReceipt: undefined,
      cgroupReleased: false,
    },
    worker: {
      preparedBarrier: options.preparedBarriers.worker,
      heldObserved: false,
      ownedRole: undefined,
      boundRole: undefined,
      postBindReobserved: false,
      barrierReleased: false,
      removalReceipt: undefined,
      cgroupReleased: false,
    },
    verifier: {
      preparedBarrier: options.preparedBarriers.verifier,
      heldObserved: false,
      ownedRole: undefined,
      boundRole: undefined,
      postBindReobserved: false,
      barrierReleased: false,
      removalReceipt: undefined,
      cgroupReleased: false,
    },
  });
  adapterStates.set(adapter, {
    adapter,
    owner: options.owner,
    barrierController: options.barrierController,
    helperClient: options.helperClient,
    roles,
    containersCreated: false,
    controllerStopped: false,
    forcedTerminationStarted: false,
  });
  return adapter;
}

export function assertPrivateLiveLinuxDockerCgroupSystemAdapter(
  value: unknown,
): asserts value is PrivateLiveLinuxDockerCgroupSystemAdapter {
  requiredState(value as PrivateLiveLinuxDockerCgroupSystemAdapter);
}
