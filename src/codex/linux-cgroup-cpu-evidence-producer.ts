import {
  LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES,
  liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256,
  liveLinuxCgroupCpuEvidenceV2DockerBindingSha256,
  liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256,
  liveLinuxCgroupCpuEvidenceV2RoleBindingSha256,
  liveLinuxCgroupCpuEvidenceV2Sha256,
  parseLiveLinuxCgroupCpuEvidenceV2,
  type LiveLinuxCgroupCpuEvidenceV2,
  type LiveLinuxCgroupCpuEvidenceV2Event,
  type LiveLinuxCgroupCpuEvidenceV2FailureCode,
  type LiveLinuxCgroupCpuEvidenceV2FailurePhase,
  type LiveLinuxCgroupCpuEvidenceV2ObservedRole,
  type LiveLinuxCgroupCpuEvidenceV2Role,
  type LiveLinuxCgroupCpuEvidenceV2RoleIdentity,
  type LiveLinuxCgroupCpuEvidenceV2RoleProof,
} from "./live-linux-cgroup-cpu-evidence-v2.js";

export type LinuxCgroupCpuEvidenceV2ProducerProvenance = "SYNTHETIC_CONTRACT";

export interface LinuxCgroupCpuEvidenceV2ProducerBinding {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  acceptedCorpusSha256: string;
  budgetUsec: bigint;
}

export interface LinuxCgroupCpuEvidenceV2DockerObservation {
  role: LiveLinuxCgroupCpuEvidenceV2Role;
  containerId: string;
  pid: number;
  startedAt: string;
}

export interface LinuxCgroupCpuEvidenceV2BoundObservation {
  cgroupIdentitySha256: string;
  usageUsec: bigint;
}

export interface LinuxCgroupCpuEvidenceV2ReapObservation {
  succeeded: boolean;
  remainingProcessCount: number;
}

export interface LinuxCgroupCpuEvidenceV2UsageObservation {
  cgroupIdentitySha256: string;
  usageUsec: bigint;
}

/**
 * Synthetic contract-test port only. It exercises producer ordering and failure semantics but
 * supplies neither Linux/runtime provenance nor signer authorization. A real cgroup adapter must
 * use a separate private-capability factory and independently bounded cleanup lifecycle.
 */
export interface LinuxCgroupCpuEvidenceV2System {
  readonly provenance: LinuxCgroupCpuEvidenceV2ProducerProvenance;
  readonly controllerIdentitySha256: string;
  monotonicRawNs(signal: AbortSignal): Promise<bigint>;
  bindRole(
    observation: LinuxCgroupCpuEvidenceV2DockerObservation,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2BoundObservation>;
  readUsageUsec(
    identity: LiveLinuxCgroupCpuEvidenceV2RoleIdentity,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2UsageObservation>;
  freezeRoles(
    roles: readonly LiveLinuxCgroupCpuEvidenceV2RoleIdentity[],
    signal: AbortSignal,
  ): Promise<boolean>;
  killRoles(
    roles: readonly LiveLinuxCgroupCpuEvidenceV2RoleIdentity[],
    signal: AbortSignal,
  ): Promise<boolean>;
  reapRoles(
    roles: readonly LiveLinuxCgroupCpuEvidenceV2RoleIdentity[],
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2ReapObservation>;
  roleReleased(
    identity: LiveLinuxCgroupCpuEvidenceV2RoleIdentity,
    signal: AbortSignal,
  ): Promise<boolean>;
  stopController(signal: AbortSignal): Promise<boolean>;
}

export interface LinuxCgroupCpuEvidenceV2Candidate {
  schemaVersion: "1";
  status: "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE";
  sourceProvenance: LinuxCgroupCpuEvidenceV2ProducerProvenance;
  liveClaim: false;
  passSigningEligible: false;
  evidence: LiveLinuxCgroupCpuEvidenceV2;
}

export interface LinuxCgroupCpuEvidenceV2ProducerSession {
  bindRole(
    observation: LinuxCgroupCpuEvidenceV2DockerObservation,
    signal: AbortSignal,
  ): Promise<LiveLinuxCgroupCpuEvidenceV2RoleIdentity>;
  markExecutionStarted(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<void>;
  sampleRole(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null>;
  markExecutionStopped(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null>;
  markRoleReleased(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null>;
  recordControllerFailure(
    phase: LiveLinuxCgroupCpuEvidenceV2FailurePhase,
    code: LiveLinuxCgroupCpuEvidenceV2FailureCode,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate>;
  finalizeSuccess(signal: AbortSignal): Promise<LinuxCgroupCpuEvidenceV2Candidate>;
  finalizeNonCpuFailure(
    phase: "CODEX_EXECUTION" | "VERIFICATION",
    code: "WORKER_REPORTED_FAILURE" | "VERIFICATION_FAILED",
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate>;
}

type RoleStateName = "BOUND" | "RUNNING" | "STOPPED" | "RELEASED";

interface RoleState {
  identity: LiveLinuxCgroupCpuEvidenceV2RoleIdentity;
  state: RoleStateName;
  baselineUsageUsec: bigint;
  lastUsageUsec: bigint;
  samplesUsec: bigint[];
  sampleEventSequences: number[];
  cgroupBoundEventSequence: number;
  executionStartedEventSequence: number | null;
  executionStoppedEventSequence: number | null;
  cgroupReleasedEventSequence: number | null;
}

type ProducerEventInput = LiveLinuxCgroupCpuEvidenceV2Event extends infer Event
  ? Event extends LiveLinuxCgroupCpuEvidenceV2Event
    ? Omit<Event, "sequence" | "monotonicNs">
    : never
  : never;

const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._-]{16,128}$/u;
const DOCKER_ID = /^[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_EVENTS = 4_096;
const MAX_ROLE_SAMPLES = 1_024;

const FAILURE_PHASE_BY_CODE: Readonly<
  Record<LiveLinuxCgroupCpuEvidenceV2FailureCode, LiveLinuxCgroupCpuEvidenceV2FailurePhase>
> = {
  CGROUP_BIND_FAILED: "ROLE_ADMISSION",
  CPU_STAT_READ_FAILED: "SAMPLING",
  CPU_COUNTER_REGRESSION: "SAMPLING",
  ROLE_IDENTITY_DRIFT: "SAMPLING",
  CPU_BUDGET_EXCEEDED: "SAMPLING",
  CONTAINMENT_ACTION_FAILED: "CONTAINMENT",
  CONTROLLER_STOP_FAILED: "CONTROLLER_STOP",
  CGROUP_RELEASE_FAILED: "CGROUP_RELEASE",
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Linux cgroup CPU evidence production was aborted.");
  }
}

function uint64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_UINT64;
}

function strictTimestamp(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,9}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    value.startsWith("0000-") ||
    value.startsWith("0001-")
  ) {
    return false;
  }
  return true;
}

function canonicalRunNonce(value: string): boolean {
  return (
    /^[A-Za-z0-9_-]{43}$/u.test(value) &&
    Buffer.from(value, "base64url").byteLength === 32 &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

function validateBinding(value: LinuxCgroupCpuEvidenceV2ProducerBinding): void {
  if (
    !REQUEST_ID.test(value.requestId) ||
    !canonicalRunNonce(value.runNonce) ||
    !SHA256.test(value.requestSha256) ||
    !SHA256.test(value.executionBindingSha256) ||
    !SAFE_ID.test(value.supervisorRunId) ||
    !IMAGE_DIGEST.test(value.workerImageDigest) ||
    !SHA256.test(value.workerPolicySha256) ||
    !SHA256.test(value.acceptedCorpusSha256) ||
    !uint64(value.budgetUsec) ||
    value.budgetUsec === 0n
  ) {
    throw new Error("Linux cgroup CPU producer binding or budget is invalid.");
  }
}

function validateSystem(value: LinuxCgroupCpuEvidenceV2System): void {
  if (
    !Object.isFrozen(value) ||
    value.provenance !== "SYNTHETIC_CONTRACT" ||
    !SHA256.test(value.controllerIdentitySha256) ||
    typeof value.monotonicRawNs !== "function" ||
    typeof value.bindRole !== "function" ||
    typeof value.readUsageUsec !== "function" ||
    typeof value.freezeRoles !== "function" ||
    typeof value.killRoles !== "function" ||
    typeof value.reapRoles !== "function" ||
    typeof value.roleReleased !== "function" ||
    typeof value.stopController !== "function"
  ) {
    throw new Error("Linux cgroup CPU producer system port is invalid.");
  }
}

function snapshotBinding(
  value: LinuxCgroupCpuEvidenceV2ProducerBinding,
): LinuxCgroupCpuEvidenceV2ProducerBinding {
  return Object.freeze({
    requestId: value.requestId,
    runNonce: value.runNonce,
    requestSha256: value.requestSha256,
    executionBindingSha256: value.executionBindingSha256,
    supervisorRunId: value.supervisorRunId,
    workerImageDigest: value.workerImageDigest,
    workerPolicySha256: value.workerPolicySha256,
    acceptedCorpusSha256: value.acceptedCorpusSha256,
    budgetUsec: value.budgetUsec,
  });
}

function snapshotSystem(
  value: LinuxCgroupCpuEvidenceV2System,
): LinuxCgroupCpuEvidenceV2System {
  if (!Object.isFrozen(value)) {
    throw new Error("Linux cgroup CPU producer system port is invalid.");
  }
  return Object.freeze({
    provenance: value.provenance,
    controllerIdentitySha256: value.controllerIdentitySha256,
    monotonicRawNs: value.monotonicRawNs.bind(value),
    bindRole: value.bindRole.bind(value),
    readUsageUsec: value.readUsageUsec.bind(value),
    freezeRoles: value.freezeRoles.bind(value),
    killRoles: value.killRoles.bind(value),
    reapRoles: value.reapRoles.bind(value),
    roleReleased: value.roleReleased.bind(value),
    stopController: value.stopController.bind(value),
  });
}

function snapshotBoundObservation(
  value: LinuxCgroupCpuEvidenceV2BoundObservation,
): LinuxCgroupCpuEvidenceV2BoundObservation {
  return Object.freeze({
    cgroupIdentitySha256: value.cgroupIdentitySha256,
    usageUsec: value.usageUsec,
  });
}

function snapshotUsageObservation(
  value: LinuxCgroupCpuEvidenceV2UsageObservation,
): LinuxCgroupCpuEvidenceV2UsageObservation {
  return Object.freeze({
    cgroupIdentitySha256: value.cgroupIdentitySha256,
    usageUsec: value.usageUsec,
  });
}

function snapshotReapObservation(
  value: LinuxCgroupCpuEvidenceV2ReapObservation,
): LinuxCgroupCpuEvidenceV2ReapObservation {
  return Object.freeze({
    succeeded: value.succeeded,
    remainingProcessCount: value.remainingProcessCount,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

class ProducerSession implements LinuxCgroupCpuEvidenceV2ProducerSession {
  readonly #binding: LinuxCgroupCpuEvidenceV2ProducerBinding;
  readonly #system: LinuxCgroupCpuEvidenceV2System;
  readonly #roles = new Map<LiveLinuxCgroupCpuEvidenceV2Role, RoleState>();
  readonly #events: LiveLinuxCgroupCpuEvidenceV2Event[] = [];
  #lastMonotonicNs: bigint | null = null;
  #terminal: LinuxCgroupCpuEvidenceV2Candidate | null = null;
  #poisoned = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    binding: LinuxCgroupCpuEvidenceV2ProducerBinding,
    system: LinuxCgroupCpuEvidenceV2System,
  ) {
    this.#binding = binding;
    this.#system = system;
  }

  async initialize(signal: AbortSignal): Promise<void> {
    await this.#appendEvent(
      {
        eventType: "CONTROLLER_STARTED",
        controllerIdentitySha256: this.#system.controllerIdentitySha256,
      },
      signal,
    );
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#queue.then(operation);
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  #assertMutable(): void {
    if (this.#terminal !== null) {
      throw new Error("Linux cgroup CPU producer is finalized after a terminal result.");
    }
    if (this.#poisoned) {
      throw new Error("Linux cgroup CPU producer is poisoned after an unrecordable failure.");
    }
  }

  async #appendEvent(
    event: ProducerEventInput,
    signal: AbortSignal,
  ): Promise<number> {
    if (signal.aborted) {
      this.#poisoned = true;
      throwIfAborted(signal);
    }
    if (this.#events.length >= MAX_EVENTS) {
      this.#poisoned = true;
      throw new Error("Linux cgroup CPU producer exceeded the event limit.");
    }
    let monotonicNs: bigint;
    try {
      monotonicNs = await this.#system.monotonicRawNs(signal);
    } catch (error) {
      this.#poisoned = true;
      throw error;
    }
    if (
      !uint64(monotonicNs) ||
      (this.#lastMonotonicNs !== null && monotonicNs <= this.#lastMonotonicNs)
    ) {
      this.#poisoned = true;
      throw new Error("Linux cgroup CPU producer raw monotonic clock did not advance.");
    }
    this.#lastMonotonicNs = monotonicNs;
    const sequence = this.#events.length + 1;
    this.#events.push({
      sequence,
      monotonicNs: monotonicNs.toString(),
      ...event,
    } as LiveLinuxCgroupCpuEvidenceV2Event);
    return sequence;
  }

  #aggregateUsageUsec(): bigint {
    let total = 0n;
    for (const role of this.#roles.values()) {
      total += role.lastUsageUsec - role.baselineUsageUsec;
      if (total > MAX_UINT64) {
        this.#poisoned = true;
        throw new Error("Linux cgroup CPU producer aggregate usage overflowed uint64.");
      }
    }
    return total;
  }

  #roleState(role: LiveLinuxCgroupCpuEvidenceV2Role): RoleState {
    const state = this.#roles.get(role);
    if (state === undefined) throw new Error(`Linux cgroup CPU role ${role} is not bound.`);
    return state;
  }

  async #recordSample(state: RoleState, usageUsec: bigint, signal: AbortSignal): Promise<void> {
    if (!uint64(usageUsec)) {
      throw new Error("Linux cgroup CPU usage is outside uint64.");
    }
    if (usageUsec < state.lastUsageUsec) {
      throw new Error("Linux cgroup CPU usage counter regressed.");
    }
    if (state.samplesUsec.length >= MAX_ROLE_SAMPLES) {
      this.#poisoned = true;
      throw new Error("Linux cgroup CPU producer exceeded the role sample limit.");
    }
    const sampleIndex = state.samplesUsec.length;
    const sequence = await this.#appendEvent(
      {
        eventType: "ROLE_CPU_SAMPLE",
        role: state.identity.role,
        roleBindingSha256: state.identity.roleBindingSha256,
        sampleIndex,
        usageUsec: usageUsec.toString(),
      },
      signal,
    );
    state.lastUsageUsec = usageUsec;
    state.samplesUsec.push(usageUsec);
    state.sampleEventSequences.push(sequence);
  }

  async bindRole(
    observation: LinuxCgroupCpuEvidenceV2DockerObservation,
    signal: AbortSignal,
  ): Promise<LiveLinuxCgroupCpuEvidenceV2RoleIdentity> {
    const observedDockerIdentity = Object.freeze({ ...observation });
    return await this.#enqueue(async () => {
      this.#assertMutable();
      throwIfAborted(signal);
      const expectedRole = LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES[this.#roles.size];
      if (
        observedDockerIdentity.role !== expectedRole ||
        !DOCKER_ID.test(observedDockerIdentity.containerId) ||
        !Number.isInteger(observedDockerIdentity.pid) ||
        observedDockerIdentity.pid < 1 ||
        observedDockerIdentity.pid > 2_147_483_647 ||
        !strictTimestamp(observedDockerIdentity.startedAt)
      ) {
        throw new Error(`Linux cgroup CPU role admission order or Docker identity is invalid; expected ${expectedRole ?? "none"}.`);
      }
      if (
        observedDockerIdentity.role === "worker" &&
        this.#roles.get("egress")?.state !== "RUNNING"
      ) {
        throw new Error("Linux cgroup CPU worker admission requires running egress.");
      }
      if (
        observedDockerIdentity.role === "verifier" &&
        (this.#roles.get("worker")?.state !== "RELEASED" ||
          this.#roles.get("egress")?.state !== "RELEASED")
      ) {
        throw new Error("Linux cgroup CPU verifier admission requires released worker and egress.");
      }
      let bound: LinuxCgroupCpuEvidenceV2BoundObservation;
      try {
        bound = snapshotBoundObservation(
          await this.#system.bindRole(observedDockerIdentity, signal),
        );
      } catch (error) {
        this.#poisoned = true;
        throw error;
      }
      if (!SHA256.test(bound.cgroupIdentitySha256) || !uint64(bound.usageUsec)) {
        this.#poisoned = true;
        throw new Error("Linux cgroup CPU role binding observation is invalid.");
      }
      const identity: LiveLinuxCgroupCpuEvidenceV2RoleIdentity = {
        ...observedDockerIdentity,
        cgroupIdentitySha256: bound.cgroupIdentitySha256,
        roleBindingSha256: liveLinuxCgroupCpuEvidenceV2RoleBindingSha256({
          requestId: this.#binding.requestId,
          runNonce: this.#binding.runNonce,
          executionBindingSha256: this.#binding.executionBindingSha256,
          supervisorRunId: this.#binding.supervisorRunId,
          ...observedDockerIdentity,
          cgroupIdentitySha256: bound.cgroupIdentitySha256,
        }),
      };
      for (const state of this.#roles.values()) {
        if (
          state.identity.containerId === identity.containerId ||
          state.identity.cgroupIdentitySha256 === identity.cgroupIdentitySha256 ||
          state.identity.roleBindingSha256 === identity.roleBindingSha256
        ) {
          this.#poisoned = true;
          throw new Error("Linux cgroup CPU role identity is duplicate or reused.");
        }
      }
      const cgroupBoundEventSequence = await this.#appendEvent(
        {
          eventType: "ROLE_CGROUP_BOUND",
          role: identity.role,
          roleBindingSha256: identity.roleBindingSha256,
        },
        signal,
      );
      const state: RoleState = {
        identity,
        state: "BOUND",
        baselineUsageUsec: bound.usageUsec,
        lastUsageUsec: bound.usageUsec,
        samplesUsec: [],
        sampleEventSequences: [],
        cgroupBoundEventSequence,
        executionStartedEventSequence: null,
        executionStoppedEventSequence: null,
        cgroupReleasedEventSequence: null,
      };
      this.#roles.set(identity.role, state);
      try {
        await this.#recordSample(state, bound.usageUsec, signal);
      } catch (error) {
        this.#roles.delete(identity.role);
        throw error;
      }
      return { ...identity };
    });
  }

  async markExecutionStarted(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<void> {
    await this.#enqueue(async () => {
      this.#assertMutable();
      const state = this.#roleState(role);
      if (state.state !== "BOUND") {
        throw new Error(`Linux cgroup CPU role ${role} cannot start from ${state.state}.`);
      }
      if (role === "worker" && this.#roles.get("egress")?.state !== "RUNNING") {
        throw new Error("Linux cgroup CPU worker start requires running egress.");
      }
      if (
        role === "verifier" &&
        (this.#roles.get("worker")?.state !== "RELEASED" ||
          this.#roles.get("egress")?.state !== "RELEASED")
      ) {
        throw new Error("Linux cgroup CPU verifier start is out of order.");
      }
      state.executionStartedEventSequence = await this.#appendEvent(
        {
          eventType: "ROLE_EXECUTION_STARTED",
          role,
          roleBindingSha256: state.identity.roleBindingSha256,
        },
        signal,
      );
      state.state = "RUNNING";
    });
  }

  async sampleRole(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null> {
    return await this.#enqueue(async () => {
      this.#assertMutable();
      const state = this.#roleState(role);
      if (state.state !== "RUNNING") {
        throw new Error(`Linux cgroup CPU role ${role} is not running for sampling.`);
      }
      let usage: LinuxCgroupCpuEvidenceV2UsageObservation;
      try {
        usage = snapshotUsageObservation(
          await this.#system.readUsageUsec({ ...state.identity }, signal),
        );
      } catch {
        return await this.#containFailure("SAMPLING", "CPU_STAT_READ_FAILED", signal);
      }
      if (!SHA256.test(usage.cgroupIdentitySha256) || !uint64(usage.usageUsec)) {
        return await this.#containFailure("SAMPLING", "CPU_STAT_READ_FAILED", signal);
      }
      if (usage.cgroupIdentitySha256 !== state.identity.cgroupIdentitySha256) {
        return await this.#containFailure("SAMPLING", "ROLE_IDENTITY_DRIFT", signal);
      }
      if (usage.usageUsec < state.lastUsageUsec) {
        return await this.#containFailure("SAMPLING", "CPU_COUNTER_REGRESSION", signal);
      }
      await this.#recordSample(state, usage.usageUsec, signal);
      return this.#aggregateUsageUsec() > this.#binding.budgetUsec
        ? await this.#containFailure("SAMPLING", "CPU_BUDGET_EXCEEDED", signal)
        : null;
    });
  }

  async markExecutionStopped(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null> {
    return await this.#enqueue(async () => {
      this.#assertMutable();
      const state = this.#roleState(role);
      if (state.state !== "RUNNING") {
        throw new Error(`Linux cgroup CPU role ${role} cannot stop from ${state.state}.`);
      }
      if (role === "egress" && this.#roles.get("worker")?.state !== "RELEASED") {
        throw new Error("Linux cgroup CPU egress stop requires released worker.");
      }
      state.executionStoppedEventSequence = await this.#appendEvent(
        {
          eventType: "ROLE_EXECUTION_STOPPED",
          role,
          roleBindingSha256: state.identity.roleBindingSha256,
        },
        signal,
      );
      state.state = "STOPPED";
      let usage: LinuxCgroupCpuEvidenceV2UsageObservation;
      try {
        usage = snapshotUsageObservation(
          await this.#system.readUsageUsec({ ...state.identity }, signal),
        );
      } catch {
        return await this.#containFailure("SAMPLING", "CPU_STAT_READ_FAILED", signal);
      }
      if (!SHA256.test(usage.cgroupIdentitySha256) || !uint64(usage.usageUsec)) {
        return await this.#containFailure("SAMPLING", "CPU_STAT_READ_FAILED", signal);
      }
      if (usage.cgroupIdentitySha256 !== state.identity.cgroupIdentitySha256) {
        return await this.#containFailure("SAMPLING", "ROLE_IDENTITY_DRIFT", signal);
      }
      if (usage.usageUsec < state.lastUsageUsec) {
        return await this.#containFailure("SAMPLING", "CPU_COUNTER_REGRESSION", signal);
      }
      await this.#recordSample(state, usage.usageUsec, signal);
      return this.#aggregateUsageUsec() > this.#binding.budgetUsec
        ? await this.#containFailure("SAMPLING", "CPU_BUDGET_EXCEEDED", signal)
        : null;
    });
  }

  async markRoleReleased(
    role: LiveLinuxCgroupCpuEvidenceV2Role,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate | null> {
    return await this.#enqueue(async () => {
      this.#assertMutable();
      const state = this.#roleState(role);
      if (state.state !== "STOPPED") {
        throw new Error(`Linux cgroup CPU role ${role} cannot release from ${state.state}.`);
      }
      let released = false;
      try {
        released = await this.#system.roleReleased({ ...state.identity }, signal);
      } catch {
        released = false;
      }
      if (!released) {
        return await this.#containFailure("CGROUP_RELEASE", "CGROUP_RELEASE_FAILED", signal);
      }
      await this.#markReleased(state, signal);
      return null;
    });
  }

  async #markReleased(state: RoleState, signal: AbortSignal): Promise<void> {
    if (state.state === "RELEASED") return;
    state.cgroupReleasedEventSequence = await this.#appendEvent(
      {
        eventType: "ROLE_CGROUP_RELEASED",
        role: state.identity.role,
        roleBindingSha256: state.identity.roleBindingSha256,
      },
      signal,
    );
    state.state = "RELEASED";
  }

  async recordControllerFailure(
    phase: LiveLinuxCgroupCpuEvidenceV2FailurePhase,
    code: LiveLinuxCgroupCpuEvidenceV2FailureCode,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate> {
    return await this.#enqueue(async () => {
      this.#assertMutable();
      if (FAILURE_PHASE_BY_CODE[code] !== phase) {
        throw new Error("Linux cgroup CPU producer failure phase and code are inconsistent.");
      }
      return await this.#containFailure(phase, code, signal);
    });
  }

  async #safeBoolean(operation: () => Promise<boolean>): Promise<boolean> {
    try {
      return (await operation()) === true;
    } catch {
      return false;
    }
  }

  async #containFailure(
    phase: LiveLinuxCgroupCpuEvidenceV2FailurePhase,
    code: LiveLinuxCgroupCpuEvidenceV2FailureCode,
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate> {
    if (this.#terminal !== null) return this.#terminal;
    if (FAILURE_PHASE_BY_CODE[code] !== phase) {
      throw new Error("Linux cgroup CPU producer failure phase and code are inconsistent.");
    }
    await this.#appendEvent(
      { eventType: "FAILURE_OBSERVED", failurePhase: phase, failureCode: code },
      signal,
    );
    const observed = LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.flatMap((role) => {
      const state = this.#roles.get(role);
      return state === undefined ? [] : [state];
    });
    const unfinished = observed.filter((state) => state.state !== "RELEASED");
    let freeze: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED" = "NOT_ATTEMPTED";
    let kill: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED" = "NOT_ATTEMPTED";
    let reap: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED" = "NOT_ATTEMPTED";
    let remainingProcessCount = 0;
    if (unfinished.length > 0) {
      const identities = unfinished.map((state) => ({ ...state.identity }));
      const froze = await this.#safeBoolean(async () =>
        await this.#system.freezeRoles(identities, signal),
      );
      freeze = froze ? "SUCCEEDED" : "FAILED";
      await this.#appendEvent(
        { eventType: "CONTAINMENT_ACTION", action: "FREEZE", result: freeze },
        signal,
      );
      const killed = await this.#safeBoolean(async () =>
        await this.#system.killRoles(identities, signal),
      );
      kill = killed ? "SUCCEEDED" : "FAILED";
      await this.#appendEvent(
        { eventType: "CONTAINMENT_ACTION", action: "KILL", result: kill },
        signal,
      );
      let reapObservation: LinuxCgroupCpuEvidenceV2ReapObservation;
      try {
        reapObservation = snapshotReapObservation(
          await this.#system.reapRoles(identities, signal),
        );
      } catch {
        reapObservation = { succeeded: false, remainingProcessCount: 1 };
      }
      if (
        typeof reapObservation.succeeded !== "boolean" ||
        !Number.isInteger(reapObservation.remainingProcessCount) ||
        reapObservation.remainingProcessCount < 0 ||
        reapObservation.remainingProcessCount > 1_000_000
      ) {
        reapObservation = { succeeded: false, remainingProcessCount: 1 };
      }
      remainingProcessCount = reapObservation.remainingProcessCount;
      reap = reapObservation.succeeded ? "SUCCEEDED" : "FAILED";
      await this.#appendEvent(
        { eventType: "CONTAINMENT_ACTION", action: "REAP", result: reap },
        signal,
      );
      for (const state of unfinished) {
        if (state.state === "RUNNING") {
          state.executionStoppedEventSequence = await this.#appendEvent(
            {
              eventType: "ROLE_EXECUTION_STOPPED",
              role: state.identity.role,
              roleBindingSha256: state.identity.roleBindingSha256,
            },
            signal,
          );
          state.state = "STOPPED";
        }
        const released = await this.#safeBoolean(async () =>
          await this.#system.roleReleased({ ...state.identity }, signal),
        );
        if (released) await this.#markReleased(state, signal);
      }
    }
    const controllerStopped = await this.#safeBoolean(async () =>
      await this.#system.stopController(signal),
    );
    if (controllerStopped) {
      await this.#appendEvent(
        {
          eventType: "CONTROLLER_STOPPED",
          controllerIdentitySha256: this.#system.controllerIdentitySha256,
        },
        signal,
      );
    }
    const allReleased = observed.every((state) => state.state === "RELEASED");
    const cleanupFailureObserved =
      code === "CONTAINMENT_ACTION_FAILED" ||
      code === "CONTROLLER_STOP_FAILED" ||
      code === "CGROUP_RELEASE_FAILED" ||
      freeze === "FAILED" ||
      kill === "FAILED" ||
      reap === "FAILED";
    const containmentComplete =
      !cleanupFailureObserved &&
      (unfinished.length === 0 ||
        (freeze === "SUCCEEDED" && kill === "SUCCEEDED" && reap === "SUCCEEDED")) &&
      remainingProcessCount === 0 &&
      allReleased &&
      controllerStopped;
    const containmentStatus = containmentComplete
      ? unfinished.length === 0
        ? "NOT_REQUIRED"
        : "SUCCEEDED"
      : "INCOMPLETE";
    const aggregateUsageUsec = this.#aggregateUsageUsec();
    const outcome = containmentComplete
      ? code === "CPU_BUDGET_EXCEEDED"
        ? "OBSERVED_OVER_BUDGET_CONTAINED"
        : "LINUX_CONTROLLER_FAILURE"
      : "CONTAINMENT_INCOMPLETE";
    const observedRoles = this.#observedRoles();
    const attemptBindingSha256 = liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256({
      requestId: this.#binding.requestId,
      runNonce: this.#binding.runNonce,
      requestSha256: this.#binding.requestSha256,
      executionBindingSha256: this.#binding.executionBindingSha256,
      supervisorRunId: this.#binding.supervisorRunId,
      workerImageDigest: this.#binding.workerImageDigest,
      controllerIdentitySha256: this.#system.controllerIdentitySha256,
      observedRoles,
    });
    const dockerBindingSha256 =
      observedRoles.length === LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length
        ? liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
            requestSha256: this.#binding.requestSha256,
            executionBindingSha256: this.#binding.executionBindingSha256,
            supervisorRunId: this.#binding.supervisorRunId,
            workerImageDigest: this.#binding.workerImageDigest,
            roles: observedRoles,
          })
        : null;
    const events = this.#events.map((event) => ({ ...event }));
    const evidence: Record<string, unknown> = {
      ...this.#baseEvidence(outcome),
      failurePhase: phase,
      failureCode: code,
      controllerStarted: true,
      executionStarted: events.some((event) => event.eventType === "ROLE_EXECUTION_STARTED"),
      controllerIdentitySha256: this.#system.controllerIdentitySha256,
      attemptBindingSha256,
      dockerBindingSha256,
      observedAggregateUsageUsec: aggregateUsageUsec.toString(),
      overageUsec:
        code === "CPU_BUDGET_EXCEEDED"
          ? (aggregateUsageUsec - this.#binding.budgetUsec).toString()
          : null,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      eventCount: events.length,
      events,
      eventTranscriptSha256: this.#eventTranscriptSha256(events),
      observedRoles,
      containment: {
        status: containmentStatus,
        trigger:
          code === "CPU_BUDGET_EXCEEDED"
            ? "CPU_BUDGET_EXCEEDED"
            : code === "ROLE_IDENTITY_DRIFT"
              ? "IDENTITY_DRIFT"
              : "CONTROLLER_FAILURE",
        freeze,
        kill,
        reap,
      },
      controllerStopStatus: controllerStopped ? "STOPPED" : "STOP_FAILED",
      remainingProcessCount,
    };
    evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
    return this.#finishCandidate(evidence);
  }

  #observedRoles(): LiveLinuxCgroupCpuEvidenceV2ObservedRole[] {
    return LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.flatMap((role) => {
      const state = this.#roles.get(role);
      if (state === undefined) return [];
      return [
        {
          ...state.identity,
          baselineUsageUsec: state.baselineUsageUsec.toString(),
          lastUsageUsec: state.lastUsageUsec.toString(),
          observedDeltaUsageUsec: (
            state.lastUsageUsec - state.baselineUsageUsec
          ).toString(),
          sampleCount: state.samplesUsec.length,
          released: state.state === "RELEASED",
        },
      ];
    });
  }

  #baseEvidence(outcome: string): Record<string, unknown> {
    return {
      schemaVersion: "2",
      evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
      outcome,
      requestId: this.#binding.requestId,
      runNonce: this.#binding.runNonce,
      requestSha256: this.#binding.requestSha256,
      executionBindingSha256: this.#binding.executionBindingSha256,
      supervisorRunId: this.#binding.supervisorRunId,
      workerImageDigest: this.#binding.workerImageDigest,
      workerPolicySha256: this.#binding.workerPolicySha256,
      acceptedCorpusSha256: this.#binding.acceptedCorpusSha256,
      budgetUsec: this.#binding.budgetUsec.toString(),
    };
  }

  #eventTranscriptSha256(events: readonly LiveLinuxCgroupCpuEvidenceV2Event[]): string {
    return liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: this.#binding.requestId,
      runNonce: this.#binding.runNonce,
      requestSha256: this.#binding.requestSha256,
      executionBindingSha256: this.#binding.executionBindingSha256,
      supervisorRunId: this.#binding.supervisorRunId,
      controllerIdentitySha256: this.#system.controllerIdentitySha256,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      events,
    });
  }

  #roleProofs(): readonly [
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
  ] {
    const proofs = LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.map((role) => {
      const state = this.#roleState(role);
      if (
        state.state !== "RELEASED" ||
        state.executionStartedEventSequence === null ||
        state.executionStoppedEventSequence === null ||
        state.cgroupReleasedEventSequence === null ||
        state.samplesUsec.length < 2
      ) {
        throw new Error("Linux cgroup CPU success evidence is incomplete.");
      }
      return {
        ...state.identity,
        baselineUsageUsec: state.baselineUsageUsec.toString(),
        finalUsageUsec: state.lastUsageUsec.toString(),
        deltaUsageUsec: (state.lastUsageUsec - state.baselineUsageUsec).toString(),
        sampleCount: state.samplesUsec.length,
        samplesUsec: state.samplesUsec.map((sample) => sample.toString()),
        sampleEventSequences: [...state.sampleEventSequences],
        cgroupBoundEventSequence: state.cgroupBoundEventSequence,
        executionStartedEventSequence: state.executionStartedEventSequence,
        executionStoppedEventSequence: state.executionStoppedEventSequence,
        cgroupReleasedEventSequence: state.cgroupReleasedEventSequence,
        released: true,
      } satisfies LiveLinuxCgroupCpuEvidenceV2RoleProof;
    });
    return proofs as unknown as readonly [
      LiveLinuxCgroupCpuEvidenceV2RoleProof,
      LiveLinuxCgroupCpuEvidenceV2RoleProof,
      LiveLinuxCgroupCpuEvidenceV2RoleProof,
    ];
  }

  #hasEgressSampleDuringWorkerExecution(): boolean {
    const egress = this.#roleState("egress");
    const worker = this.#roleState("worker");
    if (
      worker.executionStartedEventSequence === null ||
      worker.executionStoppedEventSequence === null
    ) {
      return false;
    }
    return egress.sampleEventSequences.some(
      (sequence) =>
        sequence > worker.executionStartedEventSequence! &&
        sequence < worker.executionStoppedEventSequence!,
    );
  }

  async #finalizeObserved(
    outcome: "OBSERVED_WITHIN_BUDGET" | "EXECUTION_NON_CPU_FAILURE",
    failure:
      | null
      | {
          phase: "CODEX_EXECUTION" | "VERIFICATION";
          code: "WORKER_REPORTED_FAILURE" | "VERIFICATION_FAILED";
        },
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate> {
    this.#assertMutable();
    const roles = this.#roleProofs();
    if (!this.#hasEgressSampleDuringWorkerExecution()) {
      return await this.#containFailure("SAMPLING", "CPU_STAT_READ_FAILED", signal);
    }
    const aggregateUsageUsec = this.#aggregateUsageUsec();
    if (aggregateUsageUsec > this.#binding.budgetUsec) {
      return await this.#containFailure("SAMPLING", "CPU_BUDGET_EXCEEDED", signal);
    }
    const controllerStopped = await this.#safeBoolean(async () =>
      await this.#system.stopController(signal),
    );
    if (!controllerStopped) {
      return await this.#containFailure("CONTROLLER_STOP", "CONTROLLER_STOP_FAILED", signal);
    }
    await this.#appendEvent(
      {
        eventType: "CONTROLLER_STOPPED",
        controllerIdentitySha256: this.#system.controllerIdentitySha256,
      },
      signal,
    );
    const events = this.#events.map((event) => ({ ...event }));
    const evidence: Record<string, unknown> = {
      ...this.#baseEvidence(outcome),
      dockerBindingSha256: liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
        requestSha256: this.#binding.requestSha256,
        executionBindingSha256: this.#binding.executionBindingSha256,
        supervisorRunId: this.#binding.supervisorRunId,
        workerImageDigest: this.#binding.workerImageDigest,
        roles,
      }),
      aggregateUsageUsec: aggregateUsageUsec.toString(),
      accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
      samplingMode: "LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT",
      clock: "CLOCK_MONOTONIC_RAW_NS",
      controllerIdentitySha256: this.#system.controllerIdentitySha256,
      eventCount: events.length,
      events,
      eventTranscriptSha256: this.#eventTranscriptSha256(events),
      cumulativeAccountingVerified: true,
      failStopEnforcementArmed: true,
      hardLimitEnforced: false,
      overshootBounded: false,
      containmentTriggered: false,
      controllerStopped: true,
      allRoleCgroupsReleased: true,
      remainingProcessCount: 0,
      roles,
      ...(failure === null
        ? {}
        : { failurePhase: failure.phase, failureCode: failure.code }),
    };
    evidence.cpuEvidenceSha256 = liveLinuxCgroupCpuEvidenceV2Sha256(evidence);
    return this.#finishCandidate(evidence);
  }

  #finishCandidate(evidence: unknown): LinuxCgroupCpuEvidenceV2Candidate {
    let parsed: LiveLinuxCgroupCpuEvidenceV2;
    try {
      parsed = parseLiveLinuxCgroupCpuEvidenceV2(evidence, {
        requestId: this.#binding.requestId,
        runNonce: this.#binding.runNonce,
        requestSha256: this.#binding.requestSha256,
        executionBindingSha256: this.#binding.executionBindingSha256,
        supervisorRunId: this.#binding.supervisorRunId,
        workerImageDigest: this.#binding.workerImageDigest,
        workerPolicySha256: this.#binding.workerPolicySha256,
        acceptedCorpusSha256: this.#binding.acceptedCorpusSha256,
        budgetUsec: this.#binding.budgetUsec,
      });
    } catch (error) {
      this.#poisoned = true;
      throw error;
    }
    const candidate = deepFreeze({
      schemaVersion: "1" as const,
      status: "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE" as const,
      sourceProvenance: this.#system.provenance,
      liveClaim: false as const,
      passSigningEligible: false as const,
      evidence: parsed,
    });
    this.#terminal = candidate;
    return candidate;
  }

  async finalizeSuccess(signal: AbortSignal): Promise<LinuxCgroupCpuEvidenceV2Candidate> {
    return await this.#enqueue(async () =>
      await this.#finalizeObserved("OBSERVED_WITHIN_BUDGET", null, signal),
    );
  }

  async finalizeNonCpuFailure(
    phase: "CODEX_EXECUTION" | "VERIFICATION",
    code: "WORKER_REPORTED_FAILURE" | "VERIFICATION_FAILED",
    signal: AbortSignal,
  ): Promise<LinuxCgroupCpuEvidenceV2Candidate> {
    return await this.#enqueue(async () => {
      if (
        !(
          (phase === "CODEX_EXECUTION" && code === "WORKER_REPORTED_FAILURE") ||
          (phase === "VERIFICATION" && code === "VERIFICATION_FAILED")
        )
      ) {
        throw new Error("Linux cgroup CPU non-CPU failure phase and code are inconsistent.");
      }
      return await this.#finalizeObserved(
        "EXECUTION_NON_CPU_FAILURE",
        { phase, code },
        signal,
      );
    });
  }
}

export async function createLinuxCgroupCpuEvidenceV2Producer(
  binding: LinuxCgroupCpuEvidenceV2ProducerBinding,
  system: LinuxCgroupCpuEvidenceV2System,
  signal: AbortSignal,
): Promise<LinuxCgroupCpuEvidenceV2ProducerSession> {
  const bindingSnapshot = snapshotBinding(binding);
  const systemSnapshot = snapshotSystem(system);
  validateBinding(bindingSnapshot);
  validateSystem(systemSnapshot);
  throwIfAborted(signal);
  const session = new ProducerSession(bindingSnapshot, systemSnapshot);
  await session.initialize(signal);
  return session;
}
