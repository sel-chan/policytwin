import { createHash } from "node:crypto";

export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES = [
  "egress",
  "worker",
  "verifier",
] as const;
export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLE_BINDING_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Role-Binding-v2" as const;
export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_DOCKER_BINDING_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Docker-Binding-v2" as const;
export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ATTEMPT_BINDING_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Attempt-Binding-v2" as const;
export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_EVENT_TRANSCRIPT_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Global-Event-Transcript-v2" as const;
export const LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_HASH_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Cpu-Evidence-v2" as const;

export type LiveLinuxCgroupCpuEvidenceV2Role =
  (typeof LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES)[number];

export type LiveLinuxCgroupCpuEvidenceV2Outcome =
  | "OBSERVED_WITHIN_BUDGET"
  | "EXECUTION_NON_CPU_FAILURE"
  | "PRE_EXECUTION_REJECTED"
  | "LINUX_CONTROLLER_FAILURE"
  | "OBSERVED_OVER_BUDGET_CONTAINED"
  | "CONTAINMENT_INCOMPLETE";

export type LiveLinuxCgroupCpuEvidenceV2FailurePhase =
  | "ROLE_ADMISSION"
  | "SAMPLING"
  | "CONTAINMENT"
  | "CONTROLLER_STOP"
  | "CGROUP_RELEASE";

export type LiveLinuxCgroupCpuEvidenceV2FailureCode =
  | "CGROUP_BIND_FAILED"
  | "CPU_STAT_READ_FAILED"
  | "CPU_COUNTER_REGRESSION"
  | "ROLE_IDENTITY_DRIFT"
  | "CPU_BUDGET_EXCEEDED"
  | "CONTAINMENT_ACTION_FAILED"
  | "CONTROLLER_STOP_FAILED"
  | "CGROUP_RELEASE_FAILED";

export interface LiveLinuxCgroupCpuEvidenceV2RoleIdentity {
  role: LiveLinuxCgroupCpuEvidenceV2Role;
  containerId: string;
  pid: number;
  startedAt: string;
  cgroupIdentitySha256: string;
  roleBindingSha256: string;
}

export interface LiveLinuxCgroupCpuEvidenceV2RoleProof
  extends LiveLinuxCgroupCpuEvidenceV2RoleIdentity {
  baselineUsageUsec: string;
  finalUsageUsec: string;
  deltaUsageUsec: string;
  sampleCount: number;
  samplesUsec: readonly string[];
  sampleEventSequences: readonly number[];
  cgroupBoundEventSequence: number;
  executionStartedEventSequence: number;
  executionStoppedEventSequence: number;
  cgroupReleasedEventSequence: number;
  released: true;
}

export interface LiveLinuxCgroupCpuEvidenceV2ObservedRole
  extends LiveLinuxCgroupCpuEvidenceV2RoleIdentity {
  baselineUsageUsec: string | null;
  lastUsageUsec: string | null;
  observedDeltaUsageUsec: string | null;
  sampleCount: number;
  released: boolean;
}

export type LiveLinuxCgroupCpuEvidenceV2Event =
  | {
      sequence: number;
      monotonicNs: string;
      eventType: "CONTROLLER_STARTED" | "CONTROLLER_STOPPED";
      controllerIdentitySha256: string;
    }
  | {
      sequence: number;
      monotonicNs: string;
      eventType:
        | "ROLE_CGROUP_BOUND"
        | "ROLE_EXECUTION_STARTED"
        | "ROLE_EXECUTION_STOPPED"
        | "ROLE_CGROUP_RELEASED";
      role: LiveLinuxCgroupCpuEvidenceV2Role;
      roleBindingSha256: string;
    }
  | {
      sequence: number;
      monotonicNs: string;
      eventType: "ROLE_CPU_SAMPLE";
      role: LiveLinuxCgroupCpuEvidenceV2Role;
      roleBindingSha256: string;
      sampleIndex: number;
      usageUsec: string;
    }
  | {
      sequence: number;
      monotonicNs: string;
      eventType: "FAILURE_OBSERVED";
      failurePhase: LiveLinuxCgroupCpuEvidenceV2FailurePhase;
      failureCode: LiveLinuxCgroupCpuEvidenceV2FailureCode;
    }
  | {
      sequence: number;
      monotonicNs: string;
      eventType: "CONTAINMENT_ACTION";
      action: "FREEZE" | "KILL" | "REAP";
      result: "SUCCEEDED" | "FAILED";
    };

interface LiveLinuxCgroupCpuEvidenceV2Base {
  schemaVersion: "2";
  evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2";
  outcome: LiveLinuxCgroupCpuEvidenceV2Outcome;
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  acceptedCorpusSha256: string;
  budgetUsec: string;
  cpuEvidenceSha256: string;
}

export interface LiveLinuxCgroupCpuObservedSuccessEvidenceV2
  extends LiveLinuxCgroupCpuEvidenceV2Base {
  outcome: "OBSERVED_WITHIN_BUDGET";
  dockerBindingSha256: string;
  aggregateUsageUsec: string;
  accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE";
  samplingMode: "LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT";
  clock: "CLOCK_MONOTONIC_RAW_NS";
  controllerIdentitySha256: string;
  eventCount: number;
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[];
  eventTranscriptSha256: string;
  cumulativeAccountingVerified: true;
  failStopEnforcementArmed: true;
  hardLimitEnforced: false;
  overshootBounded: false;
  containmentTriggered: false;
  controllerStopped: true;
  allRoleCgroupsReleased: true;
  remainingProcessCount: 0;
  roles: readonly [
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
    LiveLinuxCgroupCpuEvidenceV2RoleProof,
  ];
}

export interface LiveLinuxCgroupCpuExecutionFailureEvidenceV2
  extends Omit<LiveLinuxCgroupCpuObservedSuccessEvidenceV2, "outcome"> {
  outcome: "EXECUTION_NON_CPU_FAILURE";
  failurePhase: "CODEX_EXECUTION" | "VERIFICATION";
  failureCode: "WORKER_REPORTED_FAILURE" | "VERIFICATION_FAILED";
}

export interface LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2
  extends LiveLinuxCgroupCpuEvidenceV2Base {
  outcome: "PRE_EXECUTION_REJECTED";
  rejectionStage: "SUPERVISOR_ADMISSION" | "CONTROLLER_INITIALIZATION" | "EXECUTOR_START";
  rejectionCode:
    | "SUPERVISOR_FAIL_CLOSED"
    | "REQUEST_REJECTED"
    | "CONTROLLER_UNAVAILABLE"
    | "EXECUTOR_UNAVAILABLE";
  controllerStarted: false;
  executionStarted: false;
  dockerBindingSha256: null;
  containmentStatus: "NOT_APPLICABLE";
  controllerStopStatus: "NOT_STARTED";
  cgroupReleaseStatus: "NOT_APPLICABLE";
  remainingProcessCount: 0;
}

export interface LiveLinuxCgroupCpuContainmentEvidenceV2 {
  status: "NOT_REQUIRED" | "SUCCEEDED" | "INCOMPLETE";
  trigger: "CONTROLLER_FAILURE" | "CPU_BUDGET_EXCEEDED" | "IDENTITY_DRIFT";
  freeze: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED";
  kill: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED";
  reap: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED";
}

export interface LiveLinuxCgroupCpuObservedFailureEvidenceV2
  extends LiveLinuxCgroupCpuEvidenceV2Base {
  outcome:
    | "LINUX_CONTROLLER_FAILURE"
    | "OBSERVED_OVER_BUDGET_CONTAINED"
    | "CONTAINMENT_INCOMPLETE";
  failurePhase: LiveLinuxCgroupCpuEvidenceV2FailurePhase;
  failureCode: LiveLinuxCgroupCpuEvidenceV2FailureCode;
  controllerStarted: true;
  executionStarted: boolean;
  controllerIdentitySha256: string;
  attemptBindingSha256: string;
  dockerBindingSha256: string | null;
  observedAggregateUsageUsec: string;
  overageUsec: string | null;
  clock: "CLOCK_MONOTONIC_RAW_NS";
  eventCount: number;
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[];
  eventTranscriptSha256: string;
  observedRoles: readonly LiveLinuxCgroupCpuEvidenceV2ObservedRole[];
  containment: LiveLinuxCgroupCpuContainmentEvidenceV2;
  controllerStopStatus: "STOPPED" | "STOP_FAILED" | "NOT_ATTEMPTED";
  remainingProcessCount: number;
}

export type LiveLinuxCgroupCpuEvidenceV2 =
  | LiveLinuxCgroupCpuObservedSuccessEvidenceV2
  | LiveLinuxCgroupCpuExecutionFailureEvidenceV2
  | LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2
  | LiveLinuxCgroupCpuObservedFailureEvidenceV2;

export interface ExpectedLiveLinuxCgroupCpuEvidenceV2Binding {
  requestId?: string;
  runNonce?: string;
  requestSha256?: string;
  executionBindingSha256?: string;
  supervisorRunId?: string;
  workerImageDigest?: string;
  workerPolicySha256?: string;
  acceptedCorpusSha256?: string;
  budgetUsec?: bigint;
}

export interface LiveLinuxCgroupCpuEvidenceV2RoleBindingInput {
  requestId: string;
  runNonce: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  role: LiveLinuxCgroupCpuEvidenceV2Role;
  containerId: string;
  pid: number;
  startedAt: string;
  cgroupIdentitySha256: string;
}

export interface LiveLinuxCgroupCpuEvidenceV2DockerBindingInput {
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  roles: ReadonlyArray<LiveLinuxCgroupCpuEvidenceV2RoleIdentity>;
}

export interface LiveLinuxCgroupCpuEvidenceV2AttemptBindingInput {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  controllerIdentitySha256: string;
  observedRoles: ReadonlyArray<LiveLinuxCgroupCpuEvidenceV2RoleIdentity>;
}

export interface LiveLinuxCgroupCpuEvidenceV2EventTranscriptInput {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  controllerIdentitySha256: string;
  clock: "CLOCK_MONOTONIC_RAW_NS";
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[];
}

interface JsonRecord {
  [key: string]: unknown;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REQUEST_ID = /^[0-9a-f]{32}$/u;
const SAFE_ID = /^[A-Za-z0-9._-]{16,128}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_EVENTS = 4_096;
const MAX_ROLE_SAMPLES = 1_024;
const MAX_CANONICAL_STRING_BYTES = 1_024;

const BASE_KEYS = [
  "schemaVersion",
  "evidenceType",
  "outcome",
  "requestId",
  "runNonce",
  "requestSha256",
  "executionBindingSha256",
  "supervisorRunId",
  "workerImageDigest",
  "workerPolicySha256",
  "acceptedCorpusSha256",
  "budgetUsec",
  "cpuEvidenceSha256",
] as const;

const OBSERVED_SUCCESS_KEYS = [
  ...BASE_KEYS,
  "dockerBindingSha256",
  "aggregateUsageUsec",
  "accountingScope",
  "samplingMode",
  "clock",
  "controllerIdentitySha256",
  "eventCount",
  "events",
  "eventTranscriptSha256",
  "cumulativeAccountingVerified",
  "failStopEnforcementArmed",
  "hardLimitEnforced",
  "overshootBounded",
  "containmentTriggered",
  "controllerStopped",
  "allRoleCgroupsReleased",
  "remainingProcessCount",
  "roles",
] as const;

const FAILURE_PHASES = new Set<LiveLinuxCgroupCpuEvidenceV2FailurePhase>([
  "ROLE_ADMISSION",
  "SAMPLING",
  "CONTAINMENT",
  "CONTROLLER_STOP",
  "CGROUP_RELEASE",
]);
const FAILURE_CODES = new Set<LiveLinuxCgroupCpuEvidenceV2FailureCode>([
  "CGROUP_BIND_FAILED",
  "CPU_STAT_READ_FAILED",
  "CPU_COUNTER_REGRESSION",
  "ROLE_IDENTITY_DRIFT",
  "CPU_BUDGET_EXCEEDED",
  "CONTAINMENT_ACTION_FAILED",
  "CONTROLLER_STOP_FAILED",
  "CGROUP_RELEASE_FAILED",
]);
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
const PRE_EXECUTION_CODES_BY_STAGE: Readonly<
  Record<
    LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2["rejectionStage"],
    readonly LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2["rejectionCode"][]
  >
> = {
  SUPERVISOR_ADMISSION: ["SUPERVISOR_FAIL_CLOSED", "REQUEST_REJECTED"],
  CONTROLLER_INITIALIZATION: ["CONTROLLER_UNAVAILABLE"],
  EXECUTOR_START: ["EXECUTOR_UNAVAILABLE"],
};

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must use a plain object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

interface CanonicalState {
  nodes: number;
}

function canonicalValue(value: unknown, depth: number, state: CanonicalState): string {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 50_000) {
    throw new Error("CPU evidence hash input exceeds the structural limit.");
  }
  if (value === null) return "null";
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_CANONICAL_STRING_BYTES) {
      throw new Error("CPU evidence hash input string exceeds the structural limit.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("CPU evidence hash input is invalid.");
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalValue(item, depth + 1, state)).join(",")}]`;
  }
  const object = record(value, "CPU evidence hash object");
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key], depth + 1, state)}`)
    .join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalValue(value, 0, { nodes: 0 }), "utf8")
    .digest("hex");
}

function decimal(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64) throw new Error(`${label} exceeds unsigned 64-bit range.`);
  return parsed;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) {
    throw new Error("CPU evidence v2 worker image digest is invalid.");
  }
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new Error("CPU evidence v2 request ID is invalid.");
  }
  return value;
}

function runNonce(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value) ||
    Buffer.from(value, "base64url").byteLength !== 32 ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  ) {
    throw new Error("CPU evidence v2 run nonce is invalid.");
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function strictTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u.exec(
    value,
  );
  if (matched === null) throw new Error(`${label} is invalid.`);
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1970 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function role(value: unknown, label: string): LiveLinuxCgroupCpuEvidenceV2Role {
  if (!LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.includes(value as never)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as LiveLinuxCgroupCpuEvidenceV2Role;
}

function assertExpected(actual: string, expected: string | undefined, label: string): void {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`CPU evidence v2 ${label} binding is invalid.`);
  }
}

function normalizeRoleIdentity(
  value: Pick<
    LiveLinuxCgroupCpuEvidenceV2RoleIdentity,
    "role" | "containerId" | "pid" | "startedAt" | "cgroupIdentitySha256" | "roleBindingSha256"
  >,
): LiveLinuxCgroupCpuEvidenceV2RoleIdentity {
  return {
    role: role(value.role, "CPU evidence v2 role"),
    containerId:
      typeof value.containerId === "string" && CONTAINER_ID.test(value.containerId)
        ? value.containerId
        : (() => {
            throw new Error("CPU evidence v2 container ID is invalid.");
          })(),
    pid: integer(value.pid, "CPU evidence v2 PID", 1, 2_147_483_647),
    startedAt: strictTimestamp(value.startedAt, "CPU evidence v2 role start timestamp"),
    cgroupIdentitySha256: digest(
      value.cgroupIdentitySha256,
      "CPU evidence v2 cgroup identity",
    ),
    roleBindingSha256: digest(value.roleBindingSha256, "CPU evidence v2 role binding"),
  };
}

export function liveLinuxCgroupCpuEvidenceV2RoleBindingSha256(
  input: LiveLinuxCgroupCpuEvidenceV2RoleBindingInput,
): string {
  const identity = {
    role: role(input.role, "CPU evidence v2 role-binding role"),
    containerId:
      typeof input.containerId === "string" && CONTAINER_ID.test(input.containerId)
        ? input.containerId
        : (() => {
            throw new Error("CPU evidence v2 role-binding container ID is invalid.");
          })(),
    pid: integer(input.pid, "CPU evidence v2 role-binding PID", 1, 2_147_483_647),
    startedAt: strictTimestamp(input.startedAt, "CPU evidence v2 role-binding start timestamp"),
    cgroupIdentitySha256: digest(
      input.cgroupIdentitySha256,
      "CPU evidence v2 role-binding cgroup identity",
    ),
  };
  return hash({
    domain: LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLE_BINDING_DOMAIN,
    requestId: requestId(input.requestId),
    runNonce: runNonce(input.runNonce),
    executionBindingSha256: digest(
      input.executionBindingSha256,
      "CPU evidence v2 role-binding execution digest",
    ),
    supervisorRunId: safeId(input.supervisorRunId, "CPU evidence v2 role-binding run ID"),
    ...identity,
  });
}

function normalizedFixedRoles(
  roles: ReadonlyArray<LiveLinuxCgroupCpuEvidenceV2RoleIdentity>,
): LiveLinuxCgroupCpuEvidenceV2RoleIdentity[] {
  if (roles.length !== LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length) {
    throw new Error("CPU evidence v2 Docker binding requires the exact three roles.");
  }
  return LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.map((expectedRole, index) => {
    const identity = normalizeRoleIdentity(roles[index] as LiveLinuxCgroupCpuEvidenceV2RoleIdentity);
    if (identity.role !== expectedRole) {
      throw new Error("CPU evidence v2 Docker binding role order is invalid.");
    }
    return identity;
  });
}

export function liveLinuxCgroupCpuEvidenceV2DockerBindingSha256(
  input: LiveLinuxCgroupCpuEvidenceV2DockerBindingInput,
): string {
  return hash({
    domain: LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_DOCKER_BINDING_DOMAIN,
    requestSha256: digest(input.requestSha256, "CPU evidence v2 Docker request digest"),
    executionBindingSha256: digest(
      input.executionBindingSha256,
      "CPU evidence v2 Docker execution digest",
    ),
    supervisorRunId: safeId(input.supervisorRunId, "CPU evidence v2 Docker run ID"),
    workerImageDigest: imageDigest(input.workerImageDigest),
    roles: normalizedFixedRoles(input.roles),
  });
}

function normalizedObservedRoles(
  roles: ReadonlyArray<LiveLinuxCgroupCpuEvidenceV2RoleIdentity>,
): LiveLinuxCgroupCpuEvidenceV2RoleIdentity[] {
  if (roles.length > LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length) {
    throw new Error("CPU evidence v2 observed role set is invalid.");
  }
  return roles.map((value, index) => {
    const identity = normalizeRoleIdentity(value);
    if (identity.role !== LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES[index]) {
      throw new Error("CPU evidence v2 observed role order is invalid.");
    }
    return identity;
  });
}

export function liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256(
  input: LiveLinuxCgroupCpuEvidenceV2AttemptBindingInput,
): string {
  return hash({
    domain: LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ATTEMPT_BINDING_DOMAIN,
    requestId: requestId(input.requestId),
    runNonce: runNonce(input.runNonce),
    requestSha256: digest(input.requestSha256, "CPU evidence v2 attempt request digest"),
    executionBindingSha256: digest(
      input.executionBindingSha256,
      "CPU evidence v2 attempt execution digest",
    ),
    supervisorRunId: safeId(input.supervisorRunId, "CPU evidence v2 attempt run ID"),
    workerImageDigest: imageDigest(input.workerImageDigest),
    controllerIdentitySha256: digest(
      input.controllerIdentitySha256,
      "CPU evidence v2 attempt controller identity",
    ),
    observedRoles: normalizedObservedRoles(input.observedRoles),
  });
}

export function liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256(
  input: LiveLinuxCgroupCpuEvidenceV2EventTranscriptInput,
): string {
  if (input.clock !== "CLOCK_MONOTONIC_RAW_NS" || !Array.isArray(input.events)) {
    throw new Error("CPU evidence v2 event transcript input is invalid.");
  }
  return hash({
    domain: LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_EVENT_TRANSCRIPT_DOMAIN,
    requestId: requestId(input.requestId),
    runNonce: runNonce(input.runNonce),
    requestSha256: digest(input.requestSha256, "CPU evidence v2 transcript request digest"),
    executionBindingSha256: digest(
      input.executionBindingSha256,
      "CPU evidence v2 transcript execution digest",
    ),
    supervisorRunId: safeId(input.supervisorRunId, "CPU evidence v2 transcript run ID"),
    controllerIdentitySha256: digest(
      input.controllerIdentitySha256,
      "CPU evidence v2 transcript controller identity",
    ),
    clock: input.clock,
    events: input.events,
  });
}

export function liveLinuxCgroupCpuEvidenceV2Sha256(value: unknown): string {
  const input = record(value, "CPU evidence v2 hash input");
  const { cpuEvidenceSha256: _excluded, ...body } = input;
  return hash({ domain: LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_HASH_DOMAIN, evidence: body });
}

interface ParsedBase {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  acceptedCorpusSha256: string;
  budgetUsec: bigint;
  cpuEvidenceSha256: string;
}

function parseBase(
  value: JsonRecord,
  expected: ExpectedLiveLinuxCgroupCpuEvidenceV2Binding,
): ParsedBase {
  if (
    value.schemaVersion !== "2" ||
    value.evidenceType !== "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2"
  ) {
    throw new Error("CPU evidence v2 profile is invalid.");
  }
  const parsed: ParsedBase = {
    requestId: requestId(value.requestId),
    runNonce: runNonce(value.runNonce),
    requestSha256: digest(value.requestSha256, "CPU evidence v2 request digest"),
    executionBindingSha256: digest(
      value.executionBindingSha256,
      "CPU evidence v2 execution binding",
    ),
    supervisorRunId: safeId(value.supervisorRunId, "CPU evidence v2 supervisor run ID"),
    workerImageDigest: imageDigest(value.workerImageDigest),
    workerPolicySha256: digest(value.workerPolicySha256, "CPU evidence v2 worker policy"),
    acceptedCorpusSha256: digest(value.acceptedCorpusSha256, "CPU evidence v2 corpus"),
    budgetUsec: decimal(value.budgetUsec, "CPU evidence v2 budget"),
    cpuEvidenceSha256: digest(value.cpuEvidenceSha256, "CPU evidence v2 evidence hash"),
  };
  if (parsed.budgetUsec < 1n) throw new Error("CPU evidence v2 budget is invalid.");
  if (parsed.cpuEvidenceSha256 !== liveLinuxCgroupCpuEvidenceV2Sha256(value)) {
    throw new Error("CPU evidence v2 evidence hash is inconsistent.");
  }
  assertExpected(parsed.requestId, expected.requestId, "request ID");
  assertExpected(parsed.runNonce, expected.runNonce, "run nonce");
  assertExpected(parsed.requestSha256, expected.requestSha256, "request digest");
  assertExpected(parsed.executionBindingSha256, expected.executionBindingSha256, "execution");
  assertExpected(parsed.supervisorRunId, expected.supervisorRunId, "supervisor run");
  assertExpected(parsed.workerImageDigest, expected.workerImageDigest, "worker image");
  assertExpected(parsed.workerPolicySha256, expected.workerPolicySha256, "worker policy");
  assertExpected(parsed.acceptedCorpusSha256, expected.acceptedCorpusSha256, "corpus");
  if (expected.budgetUsec !== undefined && parsed.budgetUsec !== expected.budgetUsec) {
    throw new Error("CPU evidence v2 request budget binding is invalid.");
  }
  return parsed;
}

function parseEvent(value: unknown): LiveLinuxCgroupCpuEvidenceV2Event {
  const event = record(value, "CPU evidence v2 event");
  const sequence = integer(event.sequence, "CPU evidence v2 event sequence", 1, MAX_EVENTS);
  const monotonicNs = decimal(event.monotonicNs, "CPU evidence v2 monotonic timestamp").toString();
  if (event.eventType === "CONTROLLER_STARTED" || event.eventType === "CONTROLLER_STOPPED") {
    exactKeys(
      event,
      ["sequence", "monotonicNs", "eventType", "controllerIdentitySha256"],
      "CPU evidence v2 controller event",
    );
    return {
      sequence,
      monotonicNs,
      eventType: event.eventType,
      controllerIdentitySha256: digest(
        event.controllerIdentitySha256,
        "CPU evidence v2 event controller identity",
      ),
    };
  }
  if (
    event.eventType === "ROLE_CGROUP_BOUND" ||
    event.eventType === "ROLE_EXECUTION_STARTED" ||
    event.eventType === "ROLE_EXECUTION_STOPPED" ||
    event.eventType === "ROLE_CGROUP_RELEASED"
  ) {
    exactKeys(
      event,
      ["sequence", "monotonicNs", "eventType", "role", "roleBindingSha256"],
      "CPU evidence v2 role lifecycle event",
    );
    return {
      sequence,
      monotonicNs,
      eventType: event.eventType,
      role: role(event.role, "CPU evidence v2 event role"),
      roleBindingSha256: digest(event.roleBindingSha256, "CPU evidence v2 event role binding"),
    };
  }
  if (event.eventType === "ROLE_CPU_SAMPLE") {
    exactKeys(
      event,
      [
        "sequence",
        "monotonicNs",
        "eventType",
        "role",
        "roleBindingSha256",
        "sampleIndex",
        "usageUsec",
      ],
      "CPU evidence v2 sample event",
    );
    return {
      sequence,
      monotonicNs,
      eventType: "ROLE_CPU_SAMPLE",
      role: role(event.role, "CPU evidence v2 sample role"),
      roleBindingSha256: digest(event.roleBindingSha256, "CPU evidence v2 sample binding"),
      sampleIndex: integer(event.sampleIndex, "CPU evidence v2 sample index", 0, MAX_ROLE_SAMPLES - 1),
      usageUsec: decimal(event.usageUsec, "CPU evidence v2 sample usage").toString(),
    };
  }
  if (event.eventType === "FAILURE_OBSERVED") {
    exactKeys(
      event,
      ["sequence", "monotonicNs", "eventType", "failurePhase", "failureCode"],
      "CPU evidence v2 failure event",
    );
    if (!FAILURE_PHASES.has(event.failurePhase as never) || !FAILURE_CODES.has(event.failureCode as never)) {
      throw new Error("CPU evidence v2 failure event is invalid.");
    }
    return {
      sequence,
      monotonicNs,
      eventType: "FAILURE_OBSERVED",
      failurePhase: event.failurePhase as LiveLinuxCgroupCpuEvidenceV2FailurePhase,
      failureCode: event.failureCode as LiveLinuxCgroupCpuEvidenceV2FailureCode,
    };
  }
  if (event.eventType === "CONTAINMENT_ACTION") {
    exactKeys(
      event,
      ["sequence", "monotonicNs", "eventType", "action", "result"],
      "CPU evidence v2 containment event",
    );
    if (
      !["FREEZE", "KILL", "REAP"].includes(event.action as string) ||
      !["SUCCEEDED", "FAILED"].includes(event.result as string)
    ) {
      throw new Error("CPU evidence v2 containment event is invalid.");
    }
    return {
      sequence,
      monotonicNs,
      eventType: "CONTAINMENT_ACTION",
      action: event.action as "FREEZE" | "KILL" | "REAP",
      result: event.result as "SUCCEEDED" | "FAILED",
    };
  }
  throw new Error("CPU evidence v2 event type is invalid.");
}

function parseEvents(value: unknown): LiveLinuxCgroupCpuEvidenceV2Event[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_EVENTS) {
    throw new Error("CPU evidence v2 event transcript is invalid.");
  }
  const events = value.map(parseEvent);
  let previousTimestamp = -1n;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as LiveLinuxCgroupCpuEvidenceV2Event;
    const timestamp = BigInt(event.monotonicNs);
    if (event.sequence !== index + 1) {
      throw new Error("CPU evidence v2 event sequence is not contiguous.");
    }
    if (timestamp <= previousTimestamp) {
      throw new Error("CPU evidence v2 global monotonic timestamps are not strictly increasing.");
    }
    previousTimestamp = timestamp;
  }
  return events;
}

function parseRoleProof(
  value: unknown,
  expectedRole: LiveLinuxCgroupCpuEvidenceV2Role,
  base: ParsedBase,
): LiveLinuxCgroupCpuEvidenceV2RoleProof {
  const input = record(value, `CPU evidence v2 ${expectedRole} role proof`);
  exactKeys(
    input,
    [
      "role",
      "containerId",
      "pid",
      "startedAt",
      "cgroupIdentitySha256",
      "roleBindingSha256",
      "baselineUsageUsec",
      "finalUsageUsec",
      "deltaUsageUsec",
      "sampleCount",
      "samplesUsec",
      "sampleEventSequences",
      "cgroupBoundEventSequence",
      "executionStartedEventSequence",
      "executionStoppedEventSequence",
      "cgroupReleasedEventSequence",
      "released",
    ],
    `CPU evidence v2 ${expectedRole} role proof`,
  );
  const identity = normalizeRoleIdentity(input as unknown as LiveLinuxCgroupCpuEvidenceV2RoleIdentity);
  if (identity.role !== expectedRole || input.released !== true) {
    throw new Error(`CPU evidence v2 ${expectedRole} role profile is invalid.`);
  }
  const expectedBinding = liveLinuxCgroupCpuEvidenceV2RoleBindingSha256({
    requestId: base.requestId,
    runNonce: base.runNonce,
    executionBindingSha256: base.executionBindingSha256,
    supervisorRunId: base.supervisorRunId,
    ...identity,
  });
  if (identity.roleBindingSha256 !== expectedBinding) {
    throw new Error(`CPU evidence v2 ${expectedRole} role binding is inconsistent.`);
  }
  if (!Array.isArray(input.samplesUsec) || !Array.isArray(input.sampleEventSequences)) {
    throw new Error(`CPU evidence v2 ${expectedRole} samples are invalid.`);
  }
  const samples = input.samplesUsec.map((sample, index) =>
    decimal(sample, `CPU evidence v2 ${expectedRole} sample ${index}`),
  );
  if (samples.length < 2 || samples.length > MAX_ROLE_SAMPLES) {
    throw new Error(`CPU evidence v2 ${expectedRole} sample count is invalid.`);
  }
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index] as bigint) < (samples[index - 1] as bigint)) {
      throw new Error(`CPU evidence v2 ${expectedRole} samples are non-monotonic.`);
    }
  }
  const sampleSequences = input.sampleEventSequences.map((sequence, index) =>
    integer(sequence, `CPU evidence v2 ${expectedRole} sample event ${index}`, 1, MAX_EVENTS),
  );
  const baseline = decimal(input.baselineUsageUsec, `CPU evidence v2 ${expectedRole} baseline`);
  const final = decimal(input.finalUsageUsec, `CPU evidence v2 ${expectedRole} final usage`);
  const delta = decimal(input.deltaUsageUsec, `CPU evidence v2 ${expectedRole} delta`);
  if (
    input.sampleCount !== samples.length ||
    sampleSequences.length !== samples.length ||
    sampleSequences.some(
      (sequence, index) => index > 0 && sequence <= (sampleSequences[index - 1] as number),
    ) ||
    samples[0] !== baseline ||
    samples.at(-1) !== final ||
    final < baseline ||
    final - baseline !== delta
  ) {
    throw new Error(`CPU evidence v2 ${expectedRole} samples or arithmetic are inconsistent.`);
  }
  return {
    ...identity,
    baselineUsageUsec: baseline.toString(),
    finalUsageUsec: final.toString(),
    deltaUsageUsec: delta.toString(),
    sampleCount: samples.length,
    samplesUsec: samples.map((sample) => sample.toString()),
    sampleEventSequences: sampleSequences,
    cgroupBoundEventSequence: integer(
      input.cgroupBoundEventSequence,
      `CPU evidence v2 ${expectedRole} cgroup-bound event`,
      1,
      MAX_EVENTS,
    ),
    executionStartedEventSequence: integer(
      input.executionStartedEventSequence,
      `CPU evidence v2 ${expectedRole} execution-start event`,
      1,
      MAX_EVENTS,
    ),
    executionStoppedEventSequence: integer(
      input.executionStoppedEventSequence,
      `CPU evidence v2 ${expectedRole} execution-stop event`,
      1,
      MAX_EVENTS,
    ),
    cgroupReleasedEventSequence: integer(
      input.cgroupReleasedEventSequence,
      `CPU evidence v2 ${expectedRole} release event`,
      1,
      MAX_EVENTS,
    ),
    released: true,
  };
}

function eventAt(
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[],
  sequence: number,
): LiveLinuxCgroupCpuEvidenceV2Event {
  const event = events[sequence - 1];
  if (event === undefined) throw new Error("CPU evidence v2 role event sequence is missing.");
  return event;
}

function requireRoleEvent(
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[],
  sequence: number,
  roleValue: LiveLinuxCgroupCpuEvidenceV2Role,
  roleBindingSha256: string,
  eventType:
    | "ROLE_CGROUP_BOUND"
    | "ROLE_EXECUTION_STARTED"
    | "ROLE_EXECUTION_STOPPED"
    | "ROLE_CGROUP_RELEASED",
): LiveLinuxCgroupCpuEvidenceV2Event {
  const event = eventAt(events, sequence);
  if (
    event.eventType !== eventType ||
    !("role" in event) ||
    event.role !== roleValue ||
    event.roleBindingSha256 !== roleBindingSha256
  ) {
    throw new Error(`CPU evidence v2 ${roleValue} ${eventType} linkage is invalid.`);
  }
  return event;
}

function verifySuccessRoleEvents(
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[],
  roleProof: LiveLinuxCgroupCpuEvidenceV2RoleProof,
): { start: bigint; stop: bigint } {
  const bound = requireRoleEvent(
    events,
    roleProof.cgroupBoundEventSequence,
    roleProof.role,
    roleProof.roleBindingSha256,
    "ROLE_CGROUP_BOUND",
  );
  const start = requireRoleEvent(
    events,
    roleProof.executionStartedEventSequence,
    roleProof.role,
    roleProof.roleBindingSha256,
    "ROLE_EXECUTION_STARTED",
  );
  const stop = requireRoleEvent(
    events,
    roleProof.executionStoppedEventSequence,
    roleProof.role,
    roleProof.roleBindingSha256,
    "ROLE_EXECUTION_STOPPED",
  );
  const released = requireRoleEvent(
    events,
    roleProof.cgroupReleasedEventSequence,
    roleProof.role,
    roleProof.roleBindingSha256,
    "ROLE_CGROUP_RELEASED",
  );
  if (
    !(bound.sequence < start.sequence && start.sequence < stop.sequence && stop.sequence < released.sequence)
  ) {
    throw new Error(`CPU evidence v2 ${roleProof.role} lifecycle sequence is invalid.`);
  }
  const samples = roleProof.sampleEventSequences.map((sequence, index) => {
    const event = eventAt(events, sequence);
    if (
      event.eventType !== "ROLE_CPU_SAMPLE" ||
      event.role !== roleProof.role ||
      event.roleBindingSha256 !== roleProof.roleBindingSha256 ||
      event.sampleIndex !== index ||
      event.usageUsec !== roleProof.samplesUsec[index]
    ) {
      throw new Error(`CPU evidence v2 ${roleProof.role} sample linkage is invalid.`);
    }
    return event;
  });
  if (
    (samples[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence <= bound.sequence ||
    (samples[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence >= start.sequence ||
    (samples.at(-1) as LiveLinuxCgroupCpuEvidenceV2Event).sequence <= stop.sequence ||
    (samples.at(-1) as LiveLinuxCgroupCpuEvidenceV2Event).sequence >= released.sequence ||
    samples.slice(1, -1).some((sample) => sample.sequence <= start.sequence || sample.sequence >= stop.sequence)
  ) {
    throw new Error(`CPU evidence v2 ${roleProof.role} samples do not bracket execution.`);
  }
  return { start: BigInt(start.monotonicNs), stop: BigInt(stop.monotonicNs) };
}

function parseObservedSuccess(
  value: JsonRecord,
  expected: ExpectedLiveLinuxCgroupCpuEvidenceV2Binding,
): LiveLinuxCgroupCpuObservedSuccessEvidenceV2 | LiveLinuxCgroupCpuExecutionFailureEvidenceV2 {
  const nonCpuFailure = value.outcome === "EXECUTION_NON_CPU_FAILURE";
  exactKeys(
    value,
    nonCpuFailure
      ? [...OBSERVED_SUCCESS_KEYS, "failurePhase", "failureCode"]
      : OBSERVED_SUCCESS_KEYS,
    "CPU evidence v2 observed result",
  );
  if (value.outcome !== "OBSERVED_WITHIN_BUDGET" && !nonCpuFailure) {
    throw new Error("CPU evidence v2 observed outcome is invalid.");
  }
  const base = parseBase(value, expected);
  if (
    value.accountingScope !== "POST_BASELINE_THREE_ROLE_AGGREGATE" ||
    value.samplingMode !== "LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT" ||
    value.clock !== "CLOCK_MONOTONIC_RAW_NS" ||
    value.cumulativeAccountingVerified !== true ||
    value.failStopEnforcementArmed !== true ||
    value.hardLimitEnforced !== false ||
    value.overshootBounded !== false ||
    value.containmentTriggered !== false ||
    value.controllerStopped !== true ||
    value.allRoleCgroupsReleased !== true ||
    value.remainingProcessCount !== 0 ||
    !Array.isArray(value.roles) ||
    value.roles.length !== LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length
  ) {
    throw new Error("CPU evidence v2 observed success profile is invalid.");
  }
  if (
    nonCpuFailure &&
    !(
      (value.failurePhase === "CODEX_EXECUTION" && value.failureCode === "WORKER_REPORTED_FAILURE") ||
      (value.failurePhase === "VERIFICATION" && value.failureCode === "VERIFICATION_FAILED")
    )
  ) {
    throw new Error("CPU evidence v2 non-CPU failure profile is invalid.");
  }
  const controllerIdentitySha256 = digest(
    value.controllerIdentitySha256,
    "CPU evidence v2 controller identity",
  );
  const events = parseEvents(value.events);
  if (
    value.eventCount !== events.length ||
    events[0]?.eventType !== "CONTROLLER_STARTED" ||
    events.at(-1)?.eventType !== "CONTROLLER_STOPPED" ||
    !("controllerIdentitySha256" in (events[0] as LiveLinuxCgroupCpuEvidenceV2Event)) ||
    (events[0] as { controllerIdentitySha256: string }).controllerIdentitySha256 !==
      controllerIdentitySha256 ||
    !("controllerIdentitySha256" in (events.at(-1) as LiveLinuxCgroupCpuEvidenceV2Event)) ||
    (events.at(-1) as { controllerIdentitySha256: string }).controllerIdentitySha256 !==
      controllerIdentitySha256
  ) {
    throw new Error("CPU evidence v2 controller event transcript is invalid.");
  }
  const eventTranscriptSha256 = digest(
    value.eventTranscriptSha256,
    "CPU evidence v2 event transcript hash",
  );
  if (
    eventTranscriptSha256 !==
    liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: base.requestId,
      runNonce: base.runNonce,
      requestSha256: base.requestSha256,
      executionBindingSha256: base.executionBindingSha256,
      supervisorRunId: base.supervisorRunId,
      controllerIdentitySha256,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      events,
    })
  ) {
    throw new Error("CPU evidence v2 event transcript hash is inconsistent.");
  }
  const roleValues = value.roles as unknown[];
  const roles = LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.map((expectedRole, index) =>
    parseRoleProof(roleValues[index], expectedRole, base),
  ) as unknown as LiveLinuxCgroupCpuObservedSuccessEvidenceV2["roles"];
  if (
    new Set(roles.map((entry) => entry.containerId)).size !== roles.length ||
    new Set(roles.map((entry) => entry.cgroupIdentitySha256)).size !== roles.length ||
    new Set(roles.map((entry) => entry.roleBindingSha256)).size !== roles.length
  ) {
    throw new Error("CPU evidence v2 role identities must be unique.");
  }
  const intervals = roles.map((entry) => verifySuccessRoleEvents(events, entry));
  const [egress, worker, verifier] = intervals;
  const expectedEventSequences = new Set<number>([1, events.length]);
  for (const entry of roles) {
    expectedEventSequences.add(entry.cgroupBoundEventSequence);
    expectedEventSequences.add(entry.executionStartedEventSequence);
    expectedEventSequences.add(entry.executionStoppedEventSequence);
    expectedEventSequences.add(entry.cgroupReleasedEventSequence);
    for (const sequence of entry.sampleEventSequences) expectedEventSequences.add(sequence);
  }
  if (
    expectedEventSequences.size !== events.length ||
    events.some((event) => !expectedEventSequences.has(event.sequence))
  ) {
    throw new Error("CPU evidence v2 success transcript contains an unlinked or duplicate event.");
  }
  if (
    egress === undefined ||
    worker === undefined ||
    verifier === undefined ||
    !(egress.start < worker.start && worker.start < worker.stop && worker.stop < egress.stop) ||
    !(egress.stop < verifier.start && verifier.start < verifier.stop)
  ) {
    throw new Error("CPU evidence v2 egress-worker overlap or verifier ordering is invalid.");
  }
  const egressObservedDuringWorker = roles[0].sampleEventSequences.some((sequence) => {
    const timestamp = BigInt(eventAt(events, sequence).monotonicNs);
    return timestamp > worker.start && timestamp < worker.stop;
  });
  if (!egressObservedDuringWorker) {
    throw new Error("CPU evidence v2 lacks an egress sample during worker execution.");
  }
  const aggregate = decimal(value.aggregateUsageUsec, "CPU evidence v2 aggregate usage");
  const calculated = roles.reduce((total, entry) => total + BigInt(entry.deltaUsageUsec), 0n);
  if (aggregate !== calculated || aggregate > base.budgetUsec) {
    throw new Error("CPU evidence v2 aggregate usage or budget is inconsistent.");
  }
  const dockerBindingSha256 = digest(value.dockerBindingSha256, "CPU evidence v2 Docker binding");
  if (
    dockerBindingSha256 !==
    liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
      requestSha256: base.requestSha256,
      executionBindingSha256: base.executionBindingSha256,
      supervisorRunId: base.supervisorRunId,
      workerImageDigest: base.workerImageDigest,
      roles,
    })
  ) {
    throw new Error("CPU evidence v2 Docker binding is inconsistent.");
  }
  const common = {
    schemaVersion: "2" as const,
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2" as const,
    requestId: base.requestId,
    runNonce: base.runNonce,
    requestSha256: base.requestSha256,
    executionBindingSha256: base.executionBindingSha256,
    supervisorRunId: base.supervisorRunId,
    workerImageDigest: base.workerImageDigest,
    workerPolicySha256: base.workerPolicySha256,
    acceptedCorpusSha256: base.acceptedCorpusSha256,
    budgetUsec: base.budgetUsec.toString(),
    cpuEvidenceSha256: base.cpuEvidenceSha256,
    dockerBindingSha256,
    aggregateUsageUsec: aggregate.toString(),
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE" as const,
    samplingMode: "LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT" as const,
    clock: "CLOCK_MONOTONIC_RAW_NS" as const,
    controllerIdentitySha256,
    eventCount: events.length,
    events,
    eventTranscriptSha256,
    cumulativeAccountingVerified: true as const,
    failStopEnforcementArmed: true as const,
    hardLimitEnforced: false as const,
    overshootBounded: false as const,
    containmentTriggered: false as const,
    controllerStopped: true as const,
    allRoleCgroupsReleased: true as const,
    remainingProcessCount: 0 as const,
    roles,
  };
  return nonCpuFailure
    ? {
        ...common,
        outcome: "EXECUTION_NON_CPU_FAILURE",
        failurePhase: value.failurePhase as "CODEX_EXECUTION" | "VERIFICATION",
        failureCode: value.failureCode as "WORKER_REPORTED_FAILURE" | "VERIFICATION_FAILED",
      }
    : { ...common, outcome: "OBSERVED_WITHIN_BUDGET" };
}

function parsePreExecutionFailure(
  value: JsonRecord,
  expected: ExpectedLiveLinuxCgroupCpuEvidenceV2Binding,
): LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2 {
  exactKeys(
    value,
    [
      ...BASE_KEYS,
      "rejectionStage",
      "rejectionCode",
      "controllerStarted",
      "executionStarted",
      "dockerBindingSha256",
      "containmentStatus",
      "controllerStopStatus",
      "cgroupReleaseStatus",
      "remainingProcessCount",
    ],
    "CPU evidence v2 pre-execution failure",
  );
  const base = parseBase(value, expected);
  const rejectionStage =
    value.rejectionStage as LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2["rejectionStage"];
  const rejectionCode =
    value.rejectionCode as LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2["rejectionCode"];
  const allowedCodes = PRE_EXECUTION_CODES_BY_STAGE[rejectionStage] as
    | readonly LiveLinuxCgroupCpuPreExecutionFailureEvidenceV2["rejectionCode"][]
    | undefined;
  if (
    value.outcome !== "PRE_EXECUTION_REJECTED" ||
    allowedCodes === undefined ||
    !allowedCodes.includes(rejectionCode) ||
    value.controllerStarted !== false ||
    value.executionStarted !== false ||
    value.dockerBindingSha256 !== null ||
    value.containmentStatus !== "NOT_APPLICABLE" ||
    value.controllerStopStatus !== "NOT_STARTED" ||
    value.cgroupReleaseStatus !== "NOT_APPLICABLE" ||
    value.remainingProcessCount !== 0
  ) {
    throw new Error("CPU evidence v2 pre-execution failure profile is invalid.");
  }
  return {
    schemaVersion: "2",
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
    outcome: "PRE_EXECUTION_REJECTED",
    requestId: base.requestId,
    runNonce: base.runNonce,
    requestSha256: base.requestSha256,
    executionBindingSha256: base.executionBindingSha256,
    supervisorRunId: base.supervisorRunId,
    workerImageDigest: base.workerImageDigest,
    workerPolicySha256: base.workerPolicySha256,
    acceptedCorpusSha256: base.acceptedCorpusSha256,
    budgetUsec: base.budgetUsec.toString(),
    cpuEvidenceSha256: base.cpuEvidenceSha256,
    rejectionStage,
    rejectionCode,
    controllerStarted: false,
    executionStarted: false,
    dockerBindingSha256: null,
    containmentStatus: "NOT_APPLICABLE",
    controllerStopStatus: "NOT_STARTED",
    cgroupReleaseStatus: "NOT_APPLICABLE",
    remainingProcessCount: 0,
  };
}

function parseObservedRole(
  value: unknown,
  expectedRole: LiveLinuxCgroupCpuEvidenceV2Role,
  base: ParsedBase,
): LiveLinuxCgroupCpuEvidenceV2ObservedRole {
  const input = record(value, `CPU evidence v2 observed ${expectedRole} role`);
  exactKeys(
    input,
    [
      "role",
      "containerId",
      "pid",
      "startedAt",
      "cgroupIdentitySha256",
      "roleBindingSha256",
      "baselineUsageUsec",
      "lastUsageUsec",
      "observedDeltaUsageUsec",
      "sampleCount",
      "released",
    ],
    `CPU evidence v2 observed ${expectedRole} role`,
  );
  const identity = normalizeRoleIdentity(input as unknown as LiveLinuxCgroupCpuEvidenceV2RoleIdentity);
  if (identity.role !== expectedRole || typeof input.released !== "boolean") {
    throw new Error(`CPU evidence v2 observed ${expectedRole} role profile is invalid.`);
  }
  if (
    identity.roleBindingSha256 !==
    liveLinuxCgroupCpuEvidenceV2RoleBindingSha256({
      requestId: base.requestId,
      runNonce: base.runNonce,
      executionBindingSha256: base.executionBindingSha256,
      supervisorRunId: base.supervisorRunId,
      ...identity,
    })
  ) {
    throw new Error(`CPU evidence v2 observed ${expectedRole} role binding is inconsistent.`);
  }
  const sampleCount = integer(
    input.sampleCount,
    `CPU evidence v2 observed ${expectedRole} sample count`,
    0,
    MAX_ROLE_SAMPLES,
  );
  const nullable = [input.baselineUsageUsec, input.lastUsageUsec, input.observedDeltaUsageUsec];
  if (sampleCount === 0) {
    if (nullable.some((entry) => entry !== null)) {
      throw new Error(`CPU evidence v2 observed ${expectedRole} empty samples are inconsistent.`);
    }
    return {
      ...identity,
      baselineUsageUsec: null,
      lastUsageUsec: null,
      observedDeltaUsageUsec: null,
      sampleCount: 0,
      released: input.released,
    };
  }
  if (nullable.some((entry) => entry === null)) {
    throw new Error(`CPU evidence v2 observed ${expectedRole} samples are incomplete.`);
  }
  const baseline = decimal(input.baselineUsageUsec, `CPU evidence v2 observed ${expectedRole} baseline`);
  const last = decimal(input.lastUsageUsec, `CPU evidence v2 observed ${expectedRole} last usage`);
  const delta = decimal(
    input.observedDeltaUsageUsec,
    `CPU evidence v2 observed ${expectedRole} delta`,
  );
  if (last < baseline || last - baseline !== delta) {
    throw new Error(`CPU evidence v2 observed ${expectedRole} arithmetic is inconsistent.`);
  }
  return {
    ...identity,
    baselineUsageUsec: baseline.toString(),
    lastUsageUsec: last.toString(),
    observedDeltaUsageUsec: delta.toString(),
    sampleCount,
    released: input.released,
  };
}

function parseContainment(value: unknown): LiveLinuxCgroupCpuContainmentEvidenceV2 {
  const input = record(value, "CPU evidence v2 containment");
  exactKeys(input, ["status", "trigger", "freeze", "kill", "reap"], "CPU evidence v2 containment");
  if (
    !["NOT_REQUIRED", "SUCCEEDED", "INCOMPLETE"].includes(input.status as string) ||
    !["CONTROLLER_FAILURE", "CPU_BUDGET_EXCEEDED", "IDENTITY_DRIFT"].includes(
      input.trigger as string,
    ) ||
    !["NOT_ATTEMPTED", "SUCCEEDED", "FAILED"].includes(input.freeze as string) ||
    !["NOT_ATTEMPTED", "SUCCEEDED", "FAILED"].includes(input.kill as string) ||
    !["NOT_ATTEMPTED", "SUCCEEDED", "FAILED"].includes(input.reap as string)
  ) {
    throw new Error("CPU evidence v2 containment profile is invalid.");
  }
  const parsed = input as unknown as LiveLinuxCgroupCpuContainmentEvidenceV2;
  if (
    (parsed.status === "NOT_REQUIRED" &&
      [parsed.freeze, parsed.kill, parsed.reap].some((entry) => entry !== "NOT_ATTEMPTED")) ||
    (parsed.status === "SUCCEEDED" &&
      [parsed.freeze, parsed.kill, parsed.reap].some((entry) => entry !== "SUCCEEDED")) ||
    (parsed.status === "INCOMPLETE" &&
      [parsed.freeze, parsed.kill, parsed.reap].every((entry) => entry === "SUCCEEDED"))
  ) {
    throw new Error("CPU evidence v2 containment state is contradictory.");
  }
  return { ...parsed };
}

function verifyObservedFailureEvents(
  events: readonly LiveLinuxCgroupCpuEvidenceV2Event[],
  roles: readonly LiveLinuxCgroupCpuEvidenceV2ObservedRole[],
  controllerIdentitySha256: string,
  failurePhase: LiveLinuxCgroupCpuEvidenceV2FailurePhase,
  failureCode: LiveLinuxCgroupCpuEvidenceV2FailureCode,
  containment: LiveLinuxCgroupCpuContainmentEvidenceV2,
  controllerStopStatus: LiveLinuxCgroupCpuObservedFailureEvidenceV2["controllerStopStatus"],
): { executionStarted: boolean; activeExecutionAtFailure: boolean } {
  const failureEvents = events.filter((event) => event.eventType === "FAILURE_OBSERVED");
  if (
    failureEvents.length !== 1 ||
    (failureEvents[0] as Extract<LiveLinuxCgroupCpuEvidenceV2Event, { eventType: "FAILURE_OBSERVED" }>).failurePhase !== failurePhase ||
    (failureEvents[0] as Extract<LiveLinuxCgroupCpuEvidenceV2Event, { eventType: "FAILURE_OBSERVED" }>).failureCode !== failureCode
  ) {
    throw new Error("CPU evidence v2 failure event does not match the failure profile.");
  }
  const failureEvent = failureEvents[0] as Extract<
    LiveLinuxCgroupCpuEvidenceV2Event,
    { eventType: "FAILURE_OBSERVED" }
  >;
  const controllerStarts = events.filter((event) => event.eventType === "CONTROLLER_STARTED");
  if (
    controllerStarts.length !== 1 ||
    controllerStarts[0] !== events[0] ||
    (controllerStarts[0] as { controllerIdentitySha256?: string } | undefined)
      ?.controllerIdentitySha256 !== controllerIdentitySha256
  ) {
    throw new Error("CPU evidence v2 failure controller start transcript is invalid.");
  }
  if (
    events
      .slice(failureEvent.sequence)
      .some(
        (event) =>
          event.eventType === "ROLE_CGROUP_BOUND" ||
          event.eventType === "ROLE_EXECUTION_STARTED",
      )
  ) {
    throw new Error("CPU evidence v2 role admission or execution starts after the observed failure.");
  }
  const roleMap = new Map(roles.map((entry) => [entry.role, entry]));
  let activeExecutionAtFailure = false;
  for (const event of events) {
    if (!("role" in event)) continue;
    const observed = roleMap.get(event.role);
    if (observed === undefined || event.roleBindingSha256 !== observed.roleBindingSha256) {
      throw new Error("CPU evidence v2 failure event role binding is invalid.");
    }
  }
  for (const observed of roles) {
    const bound = events.filter(
      (event) => event.eventType === "ROLE_CGROUP_BOUND" && event.role === observed.role,
    );
    if (bound.length !== 1) {
      throw new Error("CPU evidence v2 observed role lacks one cgroup-bound event.");
    }
    const samples = events.filter(
      (event): event is Extract<LiveLinuxCgroupCpuEvidenceV2Event, { eventType: "ROLE_CPU_SAMPLE" }> =>
        event.eventType === "ROLE_CPU_SAMPLE" && event.role === observed.role,
    );
    if (
      samples.length !== observed.sampleCount ||
      samples.some((event, index) => event.sampleIndex !== index) ||
      samples.some(
        (event, index) =>
          index > 0 && BigInt(event.usageUsec) < BigInt(samples[index - 1]?.usageUsec ?? "0"),
      ) ||
      (samples.length === 0 && observed.baselineUsageUsec !== null) ||
      (samples.length > 0 &&
        (samples[0]?.usageUsec !== observed.baselineUsageUsec ||
          samples.at(-1)?.usageUsec !== observed.lastUsageUsec))
    ) {
      throw new Error("CPU evidence v2 observed role sample linkage is inconsistent.");
    }
    const starts = events.filter(
      (event) => event.eventType === "ROLE_EXECUTION_STARTED" && event.role === observed.role,
    );
    const stops = events.filter(
      (event) => event.eventType === "ROLE_EXECUTION_STOPPED" && event.role === observed.role,
    );
    const releases = events.filter(
      (event) => event.eventType === "ROLE_CGROUP_RELEASED" && event.role === observed.role,
    );
    if (
      starts.length > 1 ||
      stops.length > 1 ||
      releases.length > 1 ||
      (starts.length === 1 &&
        (starts[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence <=
          (bound[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence) ||
      (stops.length === 1 &&
        (starts.length !== 1 || (starts[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence >= (stops[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence)) ||
      samples.some((event) => event.sequence <= (bound[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence) ||
      (releases.length === 1 &&
        (samples.some((event) => event.sequence >= (releases[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence) ||
          (starts.length === 1 &&
            (stops.length !== 1 ||
              (stops[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence >=
                (releases[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence)) ||
          (starts.length === 0 &&
            (bound[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence >=
              (releases[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence))) ||
      (releases.length === 1) !== observed.released
    ) {
      throw new Error("CPU evidence v2 observed role release linkage is inconsistent.");
    }
    if (
      starts.length === 1 &&
      (starts[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence < failureEvent.sequence &&
      (stops.length === 0 ||
        (stops[0] as LiveLinuxCgroupCpuEvidenceV2Event).sequence > failureEvent.sequence)
    ) {
      activeExecutionAtFailure = true;
    }
  }
  const actions = events.filter(
    (event): event is Extract<LiveLinuxCgroupCpuEvidenceV2Event, { eventType: "CONTAINMENT_ACTION" }> =>
      event.eventType === "CONTAINMENT_ACTION",
  );
  const expectedActions = [
    ["FREEZE", containment.freeze],
    ["KILL", containment.kill],
    ["REAP", containment.reap],
  ] as const;
  if (actions.some((event) => event.sequence <= failureEvent.sequence)) {
    throw new Error("CPU evidence v2 containment action precedes the observed failure.");
  }
  for (const [action, status] of expectedActions) {
    const matching = actions.filter((event) => event.action === action);
    if (
      (status === "NOT_ATTEMPTED" && matching.length !== 0) ||
      (status !== "NOT_ATTEMPTED" &&
        (matching.length !== 1 || matching[0]?.result !== status))
    ) {
      throw new Error("CPU evidence v2 containment action transcript is inconsistent.");
    }
  }
  const actionOrder = actions.map((event) => event.action).join(",");
  if (!["", "FREEZE", "FREEZE,KILL", "FREEZE,KILL,REAP"].includes(actionOrder)) {
    throw new Error("CPU evidence v2 containment action order is invalid.");
  }
  const stoppedEvents = events.filter((event) => event.eventType === "CONTROLLER_STOPPED");
  if (
    (controllerStopStatus === "STOPPED" &&
      (stoppedEvents.length !== 1 ||
        events.at(-1)?.eventType !== "CONTROLLER_STOPPED" ||
        (stoppedEvents[0] as { controllerIdentitySha256?: string } | undefined)
          ?.controllerIdentitySha256 !== controllerIdentitySha256)) ||
    (controllerStopStatus !== "STOPPED" && stoppedEvents.length !== 0)
  ) {
    throw new Error("CPU evidence v2 controller stop transcript is inconsistent.");
  }
  if (activeExecutionAtFailure && containment.status === "NOT_REQUIRED") {
    throw new Error("CPU evidence v2 active execution failure lacks fail-stop containment evidence.");
  }
  return {
    executionStarted: events.some((event) => event.eventType === "ROLE_EXECUTION_STARTED"),
    activeExecutionAtFailure,
  };
}

function parseObservedFailure(
  value: JsonRecord,
  expected: ExpectedLiveLinuxCgroupCpuEvidenceV2Binding,
): LiveLinuxCgroupCpuObservedFailureEvidenceV2 {
  exactKeys(
    value,
    [
      ...BASE_KEYS,
      "failurePhase",
      "failureCode",
      "controllerStarted",
      "executionStarted",
      "controllerIdentitySha256",
      "attemptBindingSha256",
      "dockerBindingSha256",
      "observedAggregateUsageUsec",
      "overageUsec",
      "clock",
      "eventCount",
      "events",
      "eventTranscriptSha256",
      "observedRoles",
      "containment",
      "controllerStopStatus",
      "remainingProcessCount",
    ],
    "CPU evidence v2 observed failure",
  );
  if (
    ![
      "LINUX_CONTROLLER_FAILURE",
      "OBSERVED_OVER_BUDGET_CONTAINED",
      "CONTAINMENT_INCOMPLETE",
    ].includes(value.outcome as string) ||
    value.controllerStarted !== true ||
    typeof value.executionStarted !== "boolean" ||
    value.clock !== "CLOCK_MONOTONIC_RAW_NS" ||
    !FAILURE_PHASES.has(value.failurePhase as never) ||
    !FAILURE_CODES.has(value.failureCode as never) ||
    !["STOPPED", "STOP_FAILED", "NOT_ATTEMPTED"].includes(value.controllerStopStatus as string) ||
    !Array.isArray(value.observedRoles)
  ) {
    throw new Error("CPU evidence v2 observed failure profile is invalid.");
  }
  const base = parseBase(value, expected);
  const controllerIdentitySha256 = digest(
    value.controllerIdentitySha256,
    "CPU evidence v2 failure controller identity",
  );
  if (value.observedRoles.length > LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length) {
    throw new Error("CPU evidence v2 observed failure has too many roles.");
  }
  const observedRoles = value.observedRoles.map((entry, index) =>
    parseObservedRole(entry, LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES[index] as LiveLinuxCgroupCpuEvidenceV2Role, base),
  );
  if (
    new Set(observedRoles.map((entry) => entry.containerId)).size !== observedRoles.length ||
    new Set(observedRoles.map((entry) => entry.cgroupIdentitySha256)).size !== observedRoles.length
  ) {
    throw new Error("CPU evidence v2 observed failure role identities must be unique.");
  }
  const attemptBindingSha256 = digest(
    value.attemptBindingSha256,
    "CPU evidence v2 attempt binding",
  );
  if (
    attemptBindingSha256 !==
    liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256({
      requestId: base.requestId,
      runNonce: base.runNonce,
      requestSha256: base.requestSha256,
      executionBindingSha256: base.executionBindingSha256,
      supervisorRunId: base.supervisorRunId,
      workerImageDigest: base.workerImageDigest,
      controllerIdentitySha256,
      observedRoles,
    })
  ) {
    throw new Error("CPU evidence v2 attempt binding is inconsistent.");
  }
  let dockerBindingSha256: string | null = null;
  if (observedRoles.length === LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES.length) {
    dockerBindingSha256 = digest(
      value.dockerBindingSha256,
      "CPU evidence v2 failure Docker binding",
    );
    if (
      dockerBindingSha256 !==
      liveLinuxCgroupCpuEvidenceV2DockerBindingSha256({
        requestSha256: base.requestSha256,
        executionBindingSha256: base.executionBindingSha256,
        supervisorRunId: base.supervisorRunId,
        workerImageDigest: base.workerImageDigest,
        roles: observedRoles,
      })
    ) {
      throw new Error("CPU evidence v2 failure Docker binding is inconsistent.");
    }
  } else if (value.dockerBindingSha256 !== null) {
    throw new Error("CPU evidence v2 partial failure cannot claim a complete Docker binding.");
  }
  const observedAggregate = decimal(
    value.observedAggregateUsageUsec,
    "CPU evidence v2 observed aggregate usage",
  );
  const calculated = observedRoles.reduce(
    (total, entry) => total + BigInt(entry.observedDeltaUsageUsec ?? "0"),
    0n,
  );
  if (observedAggregate !== calculated) {
    throw new Error("CPU evidence v2 observed aggregate arithmetic is inconsistent.");
  }
  const overage = value.overageUsec === null ? null : decimal(value.overageUsec, "CPU evidence v2 overage");
  const failurePhase = value.failurePhase as LiveLinuxCgroupCpuEvidenceV2FailurePhase;
  const failureCode = value.failureCode as LiveLinuxCgroupCpuEvidenceV2FailureCode;
  if (FAILURE_PHASE_BY_CODE[failureCode] !== failurePhase) {
    throw new Error("CPU evidence v2 failure phase and code are inconsistent.");
  }
  const containment = parseContainment(value.containment);
  const controllerStopStatus = value.controllerStopStatus as LiveLinuxCgroupCpuObservedFailureEvidenceV2["controllerStopStatus"];
  const remainingProcessCount = integer(
    value.remainingProcessCount,
    "CPU evidence v2 remaining process count",
    0,
    1_000_000,
  );
  const events = parseEvents(value.events);
  if (
    value.eventCount !== events.length ||
    events[0]?.eventType !== "CONTROLLER_STARTED" ||
    !("controllerIdentitySha256" in (events[0] as LiveLinuxCgroupCpuEvidenceV2Event)) ||
    (events[0] as { controllerIdentitySha256: string }).controllerIdentitySha256 !==
      controllerIdentitySha256
  ) {
    throw new Error("CPU evidence v2 failure controller transcript is invalid.");
  }
  const eventTranscriptSha256 = digest(
    value.eventTranscriptSha256,
    "CPU evidence v2 failure transcript hash",
  );
  if (
    eventTranscriptSha256 !==
    liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256({
      requestId: base.requestId,
      runNonce: base.runNonce,
      requestSha256: base.requestSha256,
      executionBindingSha256: base.executionBindingSha256,
      supervisorRunId: base.supervisorRunId,
      controllerIdentitySha256,
      clock: "CLOCK_MONOTONIC_RAW_NS",
      events,
    })
  ) {
    throw new Error("CPU evidence v2 failure transcript hash is inconsistent.");
  }
  const eventFacts = verifyObservedFailureEvents(
    events,
    observedRoles,
    controllerIdentitySha256,
    failurePhase,
    failureCode,
    containment,
    controllerStopStatus,
  );
  if (eventFacts.executionStarted !== value.executionStarted) {
    throw new Error("CPU evidence v2 execution-start state is inconsistent with the transcript.");
  }
  if (
    (failureCode === "CONTAINMENT_ACTION_FAILED" &&
      ![containment.freeze, containment.kill, containment.reap].includes("FAILED")) ||
    (failureCode === "CONTROLLER_STOP_FAILED" && controllerStopStatus !== "STOP_FAILED") ||
    (failureCode === "CGROUP_RELEASE_FAILED" &&
      !observedRoles.some((entry) => !entry.released))
  ) {
    throw new Error("CPU evidence v2 failure code contradicts the observed cleanup state.");
  }
  const expectedContainmentTrigger =
    failureCode === "CPU_BUDGET_EXCEEDED"
      ? "CPU_BUDGET_EXCEEDED"
      : failureCode === "ROLE_IDENTITY_DRIFT"
        ? "IDENTITY_DRIFT"
        : "CONTROLLER_FAILURE";
  if (containment.trigger !== expectedContainmentTrigger) {
    throw new Error("CPU evidence v2 containment trigger contradicts the failure code.");
  }
  if (value.outcome === "OBSERVED_OVER_BUDGET_CONTAINED") {
    if (
      failurePhase !== "SAMPLING" ||
      failureCode !== "CPU_BUDGET_EXCEEDED" ||
      observedAggregate <= base.budgetUsec ||
      overage !== observedAggregate - base.budgetUsec ||
      containment.status !== "SUCCEEDED" ||
      containment.trigger !== "CPU_BUDGET_EXCEEDED" ||
      controllerStopStatus !== "STOPPED" ||
      remainingProcessCount !== 0 ||
      observedRoles.some((entry) => !entry.released)
    ) {
      throw new Error("CPU evidence v2 over-budget containment result is inconsistent.");
    }
  } else if (value.outcome === "CONTAINMENT_INCOMPLETE") {
    if (
      containment.status !== "INCOMPLETE" ||
      (remainingProcessCount === 0 &&
        observedRoles.every((entry) => entry.released) &&
        controllerStopStatus === "STOPPED") ||
      (failureCode === "CPU_BUDGET_EXCEEDED"
        ? observedAggregate <= base.budgetUsec || overage !== observedAggregate - base.budgetUsec
        : observedAggregate > base.budgetUsec || overage !== null)
    ) {
      throw new Error("CPU evidence v2 incomplete containment result is inconsistent.");
    }
  } else if (
    value.outcome !== "LINUX_CONTROLLER_FAILURE" ||
    failureCode === "CPU_BUDGET_EXCEEDED" ||
    observedAggregate > base.budgetUsec ||
    overage !== null ||
    containment.status === "INCOMPLETE" ||
    remainingProcessCount !== 0 ||
    observedRoles.some((entry) => !entry.released) ||
    controllerStopStatus !== "STOPPED"
  ) {
    throw new Error("CPU evidence v2 controller failure containment is inconsistent.");
  }
  return {
    schemaVersion: "2",
    evidenceType: "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2",
    outcome: value.outcome as LiveLinuxCgroupCpuObservedFailureEvidenceV2["outcome"],
    requestId: base.requestId,
    runNonce: base.runNonce,
    requestSha256: base.requestSha256,
    executionBindingSha256: base.executionBindingSha256,
    supervisorRunId: base.supervisorRunId,
    workerImageDigest: base.workerImageDigest,
    workerPolicySha256: base.workerPolicySha256,
    acceptedCorpusSha256: base.acceptedCorpusSha256,
    budgetUsec: base.budgetUsec.toString(),
    cpuEvidenceSha256: base.cpuEvidenceSha256,
    failurePhase,
    failureCode,
    controllerStarted: true,
    executionStarted: value.executionStarted,
    controllerIdentitySha256,
    attemptBindingSha256,
    dockerBindingSha256,
    observedAggregateUsageUsec: observedAggregate.toString(),
    overageUsec: overage?.toString() ?? null,
    clock: "CLOCK_MONOTONIC_RAW_NS",
    eventCount: events.length,
    events,
    eventTranscriptSha256,
    observedRoles,
    containment,
    controllerStopStatus,
    remainingProcessCount,
  };
}

export function parseLiveLinuxCgroupCpuEvidenceV2(
  value: unknown,
  expected: ExpectedLiveLinuxCgroupCpuEvidenceV2Binding = {},
): LiveLinuxCgroupCpuEvidenceV2 {
  const input = record(value, "CPU evidence v2");
  switch (input.outcome) {
    case "OBSERVED_WITHIN_BUDGET":
    case "EXECUTION_NON_CPU_FAILURE":
      return parseObservedSuccess(input, expected);
    case "PRE_EXECUTION_REJECTED":
      return parsePreExecutionFailure(input, expected);
    case "LINUX_CONTROLLER_FAILURE":
    case "OBSERVED_OVER_BUDGET_CONTAINED":
    case "CONTAINMENT_INCOMPLETE":
      return parseObservedFailure(input, expected);
    default:
      throw new Error("CPU evidence v2 outcome profile is invalid.");
  }
}
