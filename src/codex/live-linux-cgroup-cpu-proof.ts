import { createHash } from "node:crypto";

export const LIVE_LINUX_CGROUP_CPU_ROLES = ["egress", "worker", "verifier"] as const;
export const LIVE_LINUX_CGROUP_DOCKER_BINDING_DOMAIN =
  "PolicyTwin-Live-Linux-Cgroup-Docker-Binding-v1" as const;

export type LiveLinuxCgroupCpuRole = (typeof LIVE_LINUX_CGROUP_CPU_ROLES)[number];

export interface LiveLinuxCgroupCpuRoleProof {
  role: LiveLinuxCgroupCpuRole;
  containerId: string;
  pid: number;
  startedAt: string;
  cgroupIdentitySha256: string;
  baselineUsageUsec: string;
  finalUsageUsec: string;
  deltaUsageUsec: string;
  sampleCount: number;
  samplesUsec: readonly string[];
  sampleTranscriptSha256: string;
  released: true;
}

export interface LiveLinuxCgroupCpuProof {
  schemaVersion: "1";
  proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE";
  status: "OBSERVED_WITHIN_BUDGET";
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  dockerBindingSha256: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  acceptedCorpusSha256: string;
  budgetUsec: string;
  aggregateUsageUsec: string;
  accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE";
  samplingMode: "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES";
  cumulativeAccountingVerified: true;
  failStopEnforcementArmed: true;
  hardLimitEnforced: false;
  overshootBounded: false;
  containmentTriggered: false;
  controllerStopped: true;
  allRoleCgroupsReleased: true;
  roles: readonly [
    LiveLinuxCgroupCpuRoleProof,
    LiveLinuxCgroupCpuRoleProof,
    LiveLinuxCgroupCpuRoleProof,
  ];
}

export interface ExpectedLiveLinuxCgroupCpuProofBinding {
  requestId?: string;
  runNonce?: string;
  requestSha256?: string;
  executionBindingSha256?: string;
  supervisorRunId?: string;
  dockerBindingSha256?: string;
  workerImageDigest?: string;
  workerPolicySha256?: string;
  acceptedCorpusSha256?: string;
  budgetUsec?: bigint;
}

export interface LiveLinuxCgroupDockerBindingInput {
  requestSha256: string;
  executionBindingSha256: string;
  supervisorRunId: string;
  workerImageDigest: string;
  roles: ReadonlyArray<
    Pick<
      LiveLinuxCgroupCpuRoleProof,
      "role" | "containerId" | "pid" | "startedAt" | "cgroupIdentitySha256"
    >
  >;
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
const MAX_ROLE_SAMPLES = 20_000;

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
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== "string" || !IMAGE_DIGEST.test(value)) {
    throw new Error("Live CPU proof worker image digest is invalid.");
  }
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new Error("Live CPU proof request ID is invalid.");
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
    throw new Error("Live CPU proof run nonce is invalid.");
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
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

function transcriptSha256(samples: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(samples), "utf8").digest("hex");
}

function parseRole(
  value: unknown,
  expectedRole: LiveLinuxCgroupCpuRole,
): LiveLinuxCgroupCpuRoleProof {
  const result = record(value, `live CPU ${expectedRole} role proof`);
  exactKeys(
    result,
    [
      "role",
      "containerId",
      "pid",
      "startedAt",
      "cgroupIdentitySha256",
      "baselineUsageUsec",
      "finalUsageUsec",
      "deltaUsageUsec",
      "sampleCount",
      "samplesUsec",
      "sampleTranscriptSha256",
      "released",
    ],
    `live CPU ${expectedRole} role proof`,
  );
  if (
    result.role !== expectedRole ||
    typeof result.containerId !== "string" ||
    !CONTAINER_ID.test(result.containerId) ||
    result.released !== true ||
    !Array.isArray(result.samplesUsec) ||
    result.samplesUsec.length < 2 ||
    result.samplesUsec.length > MAX_ROLE_SAMPLES
  ) {
    throw new Error(`Live CPU ${expectedRole} role proof is invalid.`);
  }
  const samples = result.samplesUsec.map((sample, index) =>
    decimal(sample, `live CPU ${expectedRole} sample ${index}`),
  );
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index] as bigint) < (samples[index - 1] as bigint)) {
      throw new Error(`Live CPU ${expectedRole} samples are non-monotonic.`);
    }
  }
  const baseline = decimal(result.baselineUsageUsec, `live CPU ${expectedRole} baseline`);
  const final = decimal(result.finalUsageUsec, `live CPU ${expectedRole} final usage`);
  const delta = decimal(result.deltaUsageUsec, `live CPU ${expectedRole} delta`);
  if (
    samples[0] !== baseline ||
    samples.at(-1) !== final ||
    final < baseline ||
    final - baseline !== delta ||
    result.sampleCount !== samples.length ||
    result.sampleTranscriptSha256 !== transcriptSha256(result.samplesUsec as string[])
  ) {
    throw new Error(`Live CPU ${expectedRole} samples or arithmetic are inconsistent.`);
  }
  return {
    role: expectedRole,
    containerId: result.containerId,
    pid: integer(result.pid, `live CPU ${expectedRole} PID`, 1, 2_147_483_647),
    startedAt: strictTimestamp(result.startedAt, `live CPU ${expectedRole} start timestamp`),
    cgroupIdentitySha256: digest(
      result.cgroupIdentitySha256,
      `live CPU ${expectedRole} cgroup identity`,
    ),
    baselineUsageUsec: baseline.toString(),
    finalUsageUsec: final.toString(),
    deltaUsageUsec: delta.toString(),
    sampleCount: samples.length,
    samplesUsec: samples.map((sample) => sample.toString()),
    sampleTranscriptSha256: result.sampleTranscriptSha256 as string,
    released: true,
  };
}

function assertExpected(
  actual: string,
  expected: string | undefined,
  label: string,
): void {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`Live CPU proof ${label} binding is invalid.`);
  }
}

export function liveLinuxCgroupDockerBindingSha256(
  input: LiveLinuxCgroupDockerBindingInput,
): string {
  if (!Array.isArray(input.roles) || input.roles.length !== LIVE_LINUX_CGROUP_CPU_ROLES.length) {
    throw new Error("Live CPU Docker binding requires the exact three roles.");
  }
  const roles = LIVE_LINUX_CGROUP_CPU_ROLES.map((expectedRole, index) => {
    const role = input.roles[index];
    if (
      role === undefined ||
      role.role !== expectedRole ||
      typeof role.containerId !== "string" ||
      !CONTAINER_ID.test(role.containerId)
    ) {
      throw new Error("Live CPU Docker binding role identity is invalid.");
    }
    return {
      role: expectedRole,
      containerId: role.containerId,
      pid: integer(role.pid, `live CPU ${expectedRole} Docker-binding PID`, 1, 2_147_483_647),
      startedAt: strictTimestamp(
        role.startedAt,
        `live CPU ${expectedRole} Docker-binding start timestamp`,
      ),
      cgroupIdentitySha256: digest(
        role.cgroupIdentitySha256,
        `live CPU ${expectedRole} Docker-binding cgroup identity`,
      ),
    };
  });
  return createHash("sha256")
    .update(
      JSON.stringify({
        domain: LIVE_LINUX_CGROUP_DOCKER_BINDING_DOMAIN,
        requestSha256: digest(input.requestSha256, "live CPU Docker-binding request digest"),
        executionBindingSha256: digest(
          input.executionBindingSha256,
          "live CPU Docker-binding execution digest",
        ),
        supervisorRunId: safeId(input.supervisorRunId, "Live CPU Docker-binding run ID"),
        workerImageDigest: imageDigest(input.workerImageDigest),
        roles,
      }),
      "utf8",
    )
    .digest("hex");
}

export function parseLiveLinuxCgroupCpuProof(
  value: unknown,
  expected: ExpectedLiveLinuxCgroupCpuProofBinding = {},
): LiveLinuxCgroupCpuProof {
  const result = record(value, "live Linux cgroup CPU proof");
  const roleValues = result.roles;
  exactKeys(
    result,
    [
      "schemaVersion",
      "proofType",
      "status",
      "requestId",
      "runNonce",
      "requestSha256",
      "executionBindingSha256",
      "supervisorRunId",
      "dockerBindingSha256",
      "workerImageDigest",
      "workerPolicySha256",
      "acceptedCorpusSha256",
      "budgetUsec",
      "aggregateUsageUsec",
      "accountingScope",
      "samplingMode",
      "cumulativeAccountingVerified",
      "failStopEnforcementArmed",
      "hardLimitEnforced",
      "overshootBounded",
      "containmentTriggered",
      "controllerStopped",
      "allRoleCgroupsReleased",
      "roles",
    ],
    "live Linux cgroup CPU proof",
  );
  if (
    result.schemaVersion !== "1" ||
    result.proofType !== "LIVE_LINUX_CGROUP_V2_THREE_ROLE" ||
    result.status !== "OBSERVED_WITHIN_BUDGET" ||
    result.accountingScope !== "POST_BASELINE_THREE_ROLE_AGGREGATE" ||
    result.samplingMode !== "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES" ||
    result.cumulativeAccountingVerified !== true ||
    result.failStopEnforcementArmed !== true ||
    result.hardLimitEnforced !== false ||
    result.overshootBounded !== false ||
    result.containmentTriggered !== false ||
    result.controllerStopped !== true ||
    result.allRoleCgroupsReleased !== true ||
    !Array.isArray(roleValues) ||
    roleValues.length !== LIVE_LINUX_CGROUP_CPU_ROLES.length
  ) {
    throw new Error("Live Linux cgroup CPU proof is not an admitted within-budget result.");
  }
  const parsedRequestId = requestId(result.requestId);
  const parsedRunNonce = runNonce(result.runNonce);
  const parsedRequestSha256 = digest(result.requestSha256, "live CPU request digest");
  const executionBindingSha256 = digest(
    result.executionBindingSha256,
    "live CPU execution binding",
  );
  const supervisorRunId = safeId(result.supervisorRunId, "Live CPU supervisor run ID");
  const dockerBindingSha256 = digest(result.dockerBindingSha256, "live CPU Docker binding");
  const parsedWorkerImageDigest = imageDigest(result.workerImageDigest);
  const workerPolicySha256 = digest(result.workerPolicySha256, "live CPU worker policy");
  const acceptedCorpusSha256 = digest(result.acceptedCorpusSha256, "live CPU corpus");
  const budget = decimal(result.budgetUsec, "live CPU budget");
  const aggregate = decimal(result.aggregateUsageUsec, "live CPU aggregate usage");
  if (budget < 1n || aggregate > budget) {
    throw new Error("Live CPU aggregate exceeds or invalidates the request budget.");
  }
  const roles = LIVE_LINUX_CGROUP_CPU_ROLES.map((role, index) =>
    parseRole(roleValues[index], role),
  ) as unknown as LiveLinuxCgroupCpuProof["roles"];
  const calculated = roles.reduce((total, role) => total + BigInt(role.deltaUsageUsec), 0n);
  if (calculated !== aggregate) {
    throw new Error("Live CPU aggregate does not match the three role deltas.");
  }
  if (
    new Set(roles.map((role) => role.containerId)).size !== roles.length ||
    new Set(roles.map((role) => role.cgroupIdentitySha256)).size !== roles.length
  ) {
    throw new Error("Live CPU role identities must be unique.");
  }
  if (
    dockerBindingSha256 !==
    liveLinuxCgroupDockerBindingSha256({
      requestSha256: parsedRequestSha256,
      executionBindingSha256,
      supervisorRunId,
      workerImageDigest: parsedWorkerImageDigest,
      roles,
    })
  ) {
    throw new Error("Live CPU Docker binding is not derived from the request and role identities.");
  }
  assertExpected(parsedRequestId, expected.requestId, "request ID");
  assertExpected(parsedRunNonce, expected.runNonce, "run nonce");
  assertExpected(parsedRequestSha256, expected.requestSha256, "request digest");
  assertExpected(executionBindingSha256, expected.executionBindingSha256, "execution");
  assertExpected(supervisorRunId, expected.supervisorRunId, "supervisor run");
  assertExpected(dockerBindingSha256, expected.dockerBindingSha256, "Docker");
  assertExpected(parsedWorkerImageDigest, expected.workerImageDigest, "worker image");
  assertExpected(workerPolicySha256, expected.workerPolicySha256, "worker policy");
  assertExpected(acceptedCorpusSha256, expected.acceptedCorpusSha256, "corpus");
  if (expected.budgetUsec !== undefined && budget !== expected.budgetUsec) {
    throw new Error("Live CPU proof request budget binding is invalid.");
  }
  return {
    schemaVersion: "1",
    proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE",
    status: "OBSERVED_WITHIN_BUDGET",
    requestId: parsedRequestId,
    runNonce: parsedRunNonce,
    requestSha256: parsedRequestSha256,
    executionBindingSha256,
    supervisorRunId,
    dockerBindingSha256,
    workerImageDigest: parsedWorkerImageDigest,
    workerPolicySha256,
    acceptedCorpusSha256,
    budgetUsec: budget.toString(),
    aggregateUsageUsec: aggregate.toString(),
    accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE",
    samplingMode: "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES",
    cumulativeAccountingVerified: true,
    failStopEnforcementArmed: true,
    hardLimitEnforced: false,
    overshootBounded: false,
    containmentTriggered: false,
    controllerStopped: true,
    allRoleCgroupsReleased: true,
    roles,
  };
}

export function liveLinuxCgroupCpuSampleTranscriptSha256(
  samplesUsec: readonly string[],
): string {
  const normalized = samplesUsec.map((sample, index) =>
    decimal(sample, `live CPU transcript sample ${index}`).toString(),
  );
  return transcriptSha256(normalized);
}
