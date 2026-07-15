import { createHash } from "node:crypto";
import {
  parseCartographyResult,
  parseCommandEvidence,
  parsePolicyVerificationEvidence,
  parseRepairResult,
  parseRepairWorkerInput,
  parseReviewResult,
} from "./validate.js";
import { assertNoSensitiveWorkerText, assertSafeRelativePath } from "./safety.js";
import type {
  CommandEvidence,
  PolicyVerificationEvidence,
  RepairWorkerInput,
  RepairWorkerReport,
} from "./types.js";
import {
  parseLiveLinuxCgroupCpuProof,
  type LiveLinuxCgroupCpuProof,
} from "./live-linux-cgroup-cpu-proof.js";

export const WORKER_RPC_PROTOCOL = "policytwin.codex.repair.v1" as const;
export const WORKER_RPC_REQUEST_ACTION = "RUN_REPAIR" as const;
export const WORKER_RPC_RESPONSE_ACTION = "RUN_REPAIR_RESULT" as const;
export const WORKER_RPC_SIGNATURE_DOMAIN = "PolicyTwin-External-Worker-RPC-v1" as const;
export const WORKER_RPC_V2_PROTOCOL = "policytwin.codex.repair.v2" as const;
export const WORKER_RPC_V2_SIGNATURE_DOMAIN =
  "PolicyTwin-External-Worker-RPC-v2-Live-Linux-Cgroup" as const;
export const WORKER_RPC_V2_EXECUTION_BINDING_DOMAIN =
  "PolicyTwin-External-Worker-Execution-Binding-v2" as const;
export const WORKER_RPC_MAX_REQUEST_BYTES = 1024 * 1024;
export const WORKER_RPC_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES = 64 * 1024;
export const WORKER_RPC_MAX_RESPONSE_CHUNKS = 1024;

export interface WorkerRpcResourceLimits {
  wallTimeMs: number;
  cpuTimeMs: number;
  memoryBytes: number;
  pids: number;
  outputBytes: number;
}

export interface WorkerRpcExecutionTreeEntry {
  path: string;
  kind: "directory" | "file";
  mode: number;
  mtimeMs: number;
  sha256: string | null;
}

export interface WorkerRpcExecutionTreeManifest {
  schemaVersion: "1";
  entries: WorkerRpcExecutionTreeEntry[];
}

export interface WorkerRpcPolicy {
  schemaVersion: "1";
  fixtureId: "seeded-refund-demo";
  baselineContentSha256: string;
  baselineExecutionTreeSha256: string;
  baselineExecutionTreeManifest: WorkerRpcExecutionTreeManifest;
  acceptedCorpusSha256: string;
  workerImageDigest: string;
  sdkPackage: "@openai/codex-sdk";
  sdkVersion: "0.144.3";
  writablePaths: ["src/refund.ts", "tests/refund.test.mjs"];
  commandIds: ["fixture-typecheck", "fixture-test"];
  repairWorkspace: "DISPOSABLE_TWO_FILE_WRITESET";
  verificationWorkspace: "IMMUTABLE_RECONSTRUCTED";
  rootFilesystem: "READ_ONLY";
  codexApiEgress: "SUPERVISOR_OPENAI_PROXY_ONLY";
  fixtureProcessNetwork: "DISABLED";
  nonPrivileged: true;
  limits: WorkerRpcResourceLimits;
}

export interface WorkerRpcRequest {
  schemaVersion: "1";
  protocol: typeof WORKER_RPC_PROTOCOL;
  action: typeof WORKER_RPC_REQUEST_ACTION;
  requestId: string;
  runNonce: string;
  sequence: 1;
  issuedAt: string;
  expiresAt: string;
  model: string;
  modelReasoningEffort: "high";
  inputSha256: string;
  policySha256: string;
  policy: WorkerRpcPolicy;
  input: RepairWorkerInput;
}

export interface WorkerRpcSupervisorReceipt {
  schemaVersion: "1";
  algorithm: "Ed25519";
  keyId: string;
  supervisorId: string;
  supervisorRunId: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  fixtureId: "seeded-refund-demo";
  baselineContentSha256: string;
  baselineExecutionTreeSha256: string;
  finalExecutionTreeSha256: string;
  finalExecutionTreeManifest: WorkerRpcExecutionTreeManifest;
  acceptedCorpusSha256: string;
  executionMode: "LIVE_CODEX_SDK";
  repairWorkspaceDeleted: true;
  verificationWorkspaceDeleted: true;
  processTreeReaped: true;
  remainingProcessCount: 0;
  signature: string;
}

export interface WorkerRpcResponse {
  schemaVersion: "1";
  protocol: typeof WORKER_RPC_PROTOCOL;
  action: typeof WORKER_RPC_RESPONSE_ACTION;
  requestId: string;
  runNonce: string;
  sequence: 1;
  requestSha256: string;
  status: "PASS" | "FAIL";
  completedAt: string;
  resultSha256: string;
  report: RepairWorkerReport | null;
  error: string | null;
  receipt: WorkerRpcSupervisorReceipt;
}

export interface WorkerRpcV2ExecutionBindingInput {
  requestId: string;
  runNonce: string;
  model: string;
  inputSha256: string;
  policySha256: string;
}

export interface WorkerRpcV2Request {
  schemaVersion: "2";
  protocol: typeof WORKER_RPC_V2_PROTOCOL;
  action: typeof WORKER_RPC_REQUEST_ACTION;
  requestId: string;
  runNonce: string;
  sequence: 1;
  issuedAt: string;
  expiresAt: string;
  model: string;
  modelReasoningEffort: "high";
  inputSha256: string;
  policySha256: string;
  executionBindingSha256: string;
  policy: WorkerRpcPolicy;
  input: RepairWorkerInput;
}

export interface WorkerRpcV2SupervisorReceipt {
  schemaVersion: "2";
  algorithm: "Ed25519";
  keyId: string;
  supervisorId: string;
  supervisorRunId: string;
  workerImageDigest: string;
  workerPolicySha256: string;
  fixtureId: "seeded-refund-demo";
  baselineContentSha256: string;
  baselineExecutionTreeSha256: string;
  finalExecutionTreeSha256: string;
  finalExecutionTreeManifest: WorkerRpcExecutionTreeManifest;
  acceptedCorpusSha256: string;
  executionMode: "LIVE_CODEX_SDK";
  executionBindingSha256: string;
  dockerBindingSha256: string;
  cpuProof: LiveLinuxCgroupCpuProof | null;
  repairWorkspaceDeleted: true;
  verificationWorkspaceDeleted: true;
  processTreeReaped: true;
  remainingProcessCount: 0;
  signature: string;
}

export interface WorkerRpcV2Response {
  schemaVersion: "2";
  protocol: typeof WORKER_RPC_V2_PROTOCOL;
  action: typeof WORKER_RPC_RESPONSE_ACTION;
  requestId: string;
  runNonce: string;
  sequence: 1;
  requestSha256: string;
  executionBindingSha256: string;
  status: "PASS" | "FAIL";
  completedAt: string;
  resultSha256: string;
  report: RepairWorkerReport | null;
  error: string | null;
  receipt: WorkerRpcV2SupervisorReceipt;
}

interface CanonicalState {
  nodes: number;
}

function canonicalValue(value: unknown, depth: number, state: CanonicalState): string {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 50_000) {
    throw new Error("Worker RPC JSON exceeds the structural limit.");
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Worker RPC JSON contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalValue(item, depth + 1, state)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new Error("Worker RPC JSON contains an unsupported value.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Worker RPC JSON objects must use a plain prototype.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareText);
  return `{${keys
    .map((key) => {
      const item = record[key];
      if (item === undefined) throw new Error(`Worker RPC JSON contains undefined at ${key}.`);
      return `${JSON.stringify(key)}:${canonicalValue(item, depth + 1, state)}`;
    })
    .join(",")}}`;
}

export function canonicalWorkerRpcJson(value: unknown): string {
  return canonicalValue(value, 0, { nodes: 0 });
}

export function workerRpcSha256(value: unknown): string {
  return createHash("sha256").update(canonicalWorkerRpcJson(value), "utf8").digest("hex");
}

export function workerRpcV2ExecutionBindingSha256(
  value: WorkerRpcV2ExecutionBindingInput,
): string {
  if (
    !/^[0-9a-f]{32}$/u.test(value.requestId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.runNonce) ||
    Buffer.from(value.runNonce, "base64url").byteLength !== 32 ||
    Buffer.from(value.runNonce, "base64url").toString("base64url") !== value.runNonce ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.model) ||
    !/^[0-9a-f]{64}$/u.test(value.inputSha256) ||
    !/^[0-9a-f]{64}$/u.test(value.policySha256)
  ) {
    throw new Error("Worker RPC v2 execution binding input is invalid.");
  }
  return workerRpcSha256({
    domain: WORKER_RPC_V2_EXECUTION_BINDING_DOMAIN,
    requestId: value.requestId,
    runNonce: value.runNonce,
    model: value.model,
    inputSha256: value.inputSha256,
    policySha256: value.policySha256,
  });
}

export function acceptedCorpusSha256(input: RepairWorkerInput): string {
  return createHash("sha256").update(JSON.stringify(input.acceptedCases), "utf8").digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const required = [...expected].sort(compareText);
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${label} must contain exactly: ${required.join(", ")}.`);
  }
}

function safeId(value: unknown, label: string, minimum = 8, maximum = 128): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function imageDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Worker image must use an immutable sha256 digest.");
  }
  return value;
}

function canonicalIso(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function treePath(value: unknown, label: string): string {
  if (value === ".") return ".";
  return assertSafeRelativePath(value, label);
}

function mtimeMs(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  ) {
    throw new Error(`${label} must be a finite non-negative filesystem timestamp.`);
  }
  return value;
}

export function parseWorkerRpcExecutionTreeManifest(
  value: unknown,
): WorkerRpcExecutionTreeManifest {
  const manifest = record(value, "worker RPC execution tree manifest");
  exactKeys(manifest, ["schemaVersion", "entries"], "worker RPC execution tree manifest");
  if (
    manifest.schemaVersion !== "1" ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length < 5 ||
    manifest.entries.length > 256
  ) {
    throw new Error("Worker RPC execution tree manifest is incomplete or too large.");
  }
  const entries = manifest.entries.map((value, index): WorkerRpcExecutionTreeEntry => {
    const entry = record(value, `worker RPC execution tree entry ${index}`);
    exactKeys(
      entry,
      ["path", "kind", "mode", "mtimeMs", "sha256"],
      `worker RPC execution tree entry ${index}`,
    );
    const path = treePath(entry.path, `worker RPC execution tree entry ${index} path`);
    if (entry.kind !== "directory" && entry.kind !== "file") {
      throw new Error(`Worker RPC execution tree entry ${index} kind is invalid.`);
    }
    const kind = entry.kind;
    const digest = entry.sha256 === null ? null : sha256(entry.sha256, `tree entry ${path}`);
    if (
      (kind === "directory" && digest !== null) ||
      (kind === "file" && digest === null) ||
      (path === "." && kind !== "directory")
    ) {
      throw new Error(`Worker RPC execution tree entry ${path} is inconsistent.`);
    }
    return {
      path,
      kind,
      mode: integer(entry.mode, `tree entry ${path} mode`, 0, 0o177777),
      mtimeMs: mtimeMs(entry.mtimeMs, `tree entry ${path} mtimeMs`),
      sha256: digest,
    };
  });
  const paths = entries.map((entry) => entry.path);
  if (
    paths[0] !== "." ||
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => index > 0 && compareText(paths[index - 1] ?? "", path) >= 0)
  ) {
    throw new Error("Worker RPC execution tree entries must use unique canonical path order.");
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries.slice(1)) {
    const slash = entry.path.lastIndexOf("/");
    const parent = slash < 0 ? "." : entry.path.slice(0, slash);
    if (byPath.get(parent)?.kind !== "directory") {
      throw new Error(`Worker RPC execution tree entry ${entry.path} lacks a directory parent.`);
    }
  }
  for (const writablePath of ["src/refund.ts", "tests/refund.test.mjs"]) {
    if (byPath.get(writablePath)?.kind !== "file") {
      throw new Error(`Worker RPC execution tree lacks writable file ${writablePath}.`);
    }
  }
  return { schemaVersion: "1", entries };
}

export function workerRpcExecutionTreeSha256(value: unknown): string {
  return workerRpcSha256(parseWorkerRpcExecutionTreeManifest(value));
}

const HOST_PATH =
  /(?:\b[A-Za-z]:[\\/]|\\\\|\bfile:\/\/|\/(?:home|root|Users|etc|proc|sys|dev|var\/(?:run|tmp)|run)(?:\/|\b))/iu;

export function assertNoWorkerRpcHostPath(value: string, label: string): string {
  if (HOST_PATH.test(value)) {
    throw new Error(`${label} contains a host or privileged absolute path.`);
  }
  return value;
}

function assertSafeRpcText(value: string, label: string, maximum: number): string {
  assertNoSensitiveWorkerText(value, label, maximum);
  assertNoWorkerRpcHostPath(value, label);
  return value;
}

function parseLimits(value: unknown): WorkerRpcResourceLimits {
  const result = record(value, "worker RPC resource limits");
  exactKeys(
    result,
    ["wallTimeMs", "cpuTimeMs", "memoryBytes", "pids", "outputBytes"],
    "worker RPC resource limits",
  );
  return {
    wallTimeMs: integer(result.wallTimeMs, "worker RPC wall time", 1_000, 15 * 60_000),
    cpuTimeMs: integer(result.cpuTimeMs, "worker RPC CPU time", 1_000, 10 * 60_000),
    memoryBytes: integer(
      result.memoryBytes,
      "worker RPC memory",
      256 * 1024 * 1024,
      4 * 1024 * 1024 * 1024,
    ),
    pids: integer(result.pids, "worker RPC PID limit", 8, 128),
    outputBytes: integer(
      result.outputBytes,
      "worker RPC output limit",
      1024 * 1024,
      WORKER_RPC_MAX_RESPONSE_BYTES,
    ),
  };
}

export function parseWorkerRpcPolicy(value: unknown): WorkerRpcPolicy {
  const result = record(value, "worker RPC policy");
  exactKeys(
    result,
    [
      "schemaVersion",
      "fixtureId",
      "baselineContentSha256",
      "baselineExecutionTreeSha256",
      "baselineExecutionTreeManifest",
      "acceptedCorpusSha256",
      "workerImageDigest",
      "sdkPackage",
      "sdkVersion",
      "writablePaths",
      "commandIds",
      "repairWorkspace",
      "verificationWorkspace",
      "rootFilesystem",
      "codexApiEgress",
      "fixtureProcessNetwork",
      "nonPrivileged",
      "limits",
    ],
    "worker RPC policy",
  );
  if (
    result.schemaVersion !== "1" ||
    result.fixtureId !== "seeded-refund-demo" ||
    result.sdkPackage !== "@openai/codex-sdk" ||
    result.sdkVersion !== "0.144.3" ||
    result.repairWorkspace !== "DISPOSABLE_TWO_FILE_WRITESET" ||
    result.verificationWorkspace !== "IMMUTABLE_RECONSTRUCTED" ||
    result.rootFilesystem !== "READ_ONLY" ||
    result.codexApiEgress !== "SUPERVISOR_OPENAI_PROXY_ONLY" ||
    result.fixtureProcessNetwork !== "DISABLED" ||
    result.nonPrivileged !== true ||
    JSON.stringify(result.writablePaths) !==
      JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"]) ||
    JSON.stringify(result.commandIds) !==
      JSON.stringify(["fixture-typecheck", "fixture-test"])
  ) {
    throw new Error("Worker RPC policy weakens the fixed sandbox or verification contract.");
  }
  const baselineExecutionTreeManifest = parseWorkerRpcExecutionTreeManifest(
    result.baselineExecutionTreeManifest,
  );
  const baselineExecutionTreeSha256 = sha256(
    result.baselineExecutionTreeSha256,
    "worker RPC baseline execution tree digest",
  );
  if (
    baselineExecutionTreeSha256 !==
    workerRpcExecutionTreeSha256(baselineExecutionTreeManifest)
  ) {
    throw new Error("Worker RPC baseline execution tree digest does not match its manifest.");
  }
  return {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: sha256(
      result.baselineContentSha256,
      "worker RPC baseline content digest",
    ),
    baselineExecutionTreeSha256,
    baselineExecutionTreeManifest,
    acceptedCorpusSha256: sha256(
      result.acceptedCorpusSha256,
      "worker RPC accepted corpus digest",
    ),
    workerImageDigest: imageDigest(result.workerImageDigest),
    sdkPackage: "@openai/codex-sdk",
    sdkVersion: "0.144.3",
    writablePaths: ["src/refund.ts", "tests/refund.test.mjs"],
    commandIds: ["fixture-typecheck", "fixture-test"],
    repairWorkspace: "DISPOSABLE_TWO_FILE_WRITESET",
    verificationWorkspace: "IMMUTABLE_RECONSTRUCTED",
    rootFilesystem: "READ_ONLY",
    codexApiEgress: "SUPERVISOR_OPENAI_PROXY_ONLY",
    fixtureProcessNetwork: "DISABLED",
    nonPrivileged: true,
    limits: parseLimits(result.limits),
  };
}

export function parseWorkerRpcRequest(value: unknown): WorkerRpcRequest {
  const result = record(value, "worker RPC request");
  exactKeys(
    result,
    [
      "schemaVersion",
      "protocol",
      "action",
      "requestId",
      "runNonce",
      "sequence",
      "issuedAt",
      "expiresAt",
      "model",
      "modelReasoningEffort",
      "inputSha256",
      "policySha256",
      "policy",
      "input",
    ],
    "worker RPC request",
  );
  if (
    result.schemaVersion !== "1" ||
    result.protocol !== WORKER_RPC_PROTOCOL ||
    result.action !== WORKER_RPC_REQUEST_ACTION ||
    result.sequence !== 1 ||
    result.modelReasoningEffort !== "high"
  ) {
    throw new Error("Worker RPC request protocol metadata is invalid.");
  }
  const requestId = safeId(result.requestId, "worker RPC request ID", 16, 64);
  if (!/^[0-9a-f]{32}$/u.test(requestId)) {
    throw new Error("Worker RPC request ID must be a 128-bit lowercase hex value.");
  }
  if (
    typeof result.runNonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(result.runNonce) ||
    Buffer.from(result.runNonce, "base64url").byteLength !== 32
  ) {
    throw new Error("Worker RPC run nonce must be a canonical 256-bit base64url value.");
  }
  if (
    typeof result.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result.model)
  ) {
    throw new Error("Worker RPC model must be an explicit safe identifier.");
  }
  const issuedAt = canonicalIso(result.issuedAt, "worker RPC issuedAt");
  const expiresAt = canonicalIso(result.expiresAt, "worker RPC expiresAt");
  const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (validityMs < 1_000 || validityMs > 15 * 60_000) {
    throw new Error("Worker RPC request validity window is invalid.");
  }
  const policy = parseWorkerRpcPolicy(result.policy);
  const input = parseRepairWorkerInput(result.input);
  if (
    sha256(result.inputSha256, "worker RPC input digest") !== workerRpcSha256(input) ||
    sha256(result.policySha256, "worker RPC policy digest") !== workerRpcSha256(policy) ||
    policy.acceptedCorpusSha256 !== acceptedCorpusSha256(input)
  ) {
    throw new Error("Worker RPC request hashes are inconsistent with the validated input.");
  }
  const parsed: WorkerRpcRequest = {
    schemaVersion: "1",
    protocol: WORKER_RPC_PROTOCOL,
    action: WORKER_RPC_REQUEST_ACTION,
    requestId,
    runNonce: result.runNonce,
    sequence: 1,
    issuedAt,
    expiresAt,
    model: result.model,
    modelReasoningEffort: "high",
    inputSha256: result.inputSha256 as string,
    policySha256: result.policySha256 as string,
    policy,
    input,
  };
  const encoded = canonicalWorkerRpcJson(parsed);
  if (Buffer.byteLength(encoded, "utf8") > WORKER_RPC_MAX_REQUEST_BYTES) {
    throw new Error("Worker RPC request exceeds the byte limit.");
  }
  assertSafeRpcText(encoded, "worker RPC request", WORKER_RPC_MAX_REQUEST_BYTES);
  return parsed;
}

function parseLivePassReport(value: unknown): RepairWorkerReport {
  const result = record(value, "worker RPC repair report");
  exactKeys(
    result,
    [
      "schemaVersion",
      "executionMode",
      "status",
      "attempts",
      "cartography",
      "repairAttempts",
      "commandEvidence",
      "commandFailures",
      "policyVerificationAttempts",
      "review",
      "failure",
    ],
    "worker RPC repair report",
  );
  if (
    result.schemaVersion !== "1" ||
    result.executionMode !== "LIVE_CODEX_SDK" ||
    result.status !== "PASS" ||
    result.failure !== null ||
    !Array.isArray(result.repairAttempts) ||
    !Array.isArray(result.commandEvidence) ||
    !Array.isArray(result.commandFailures) ||
    !Array.isArray(result.policyVerificationAttempts) ||
    result.commandFailures.length !== 0
  ) {
    throw new Error("Worker RPC PASS report is incomplete or contains failure evidence.");
  }
  const attempts = integer(result.attempts, "worker RPC repair attempts", 1, 2) as 1 | 2;
  if (result.repairAttempts.length !== attempts) {
    throw new Error("Worker RPC PASS report does not preserve every repair attempt.");
  }
  const cartography = parseCartographyResult(result.cartography, "LIVE_CODEX_SDK");
  const repairAttempts = result.repairAttempts.map((item) =>
    parseRepairResult(item, "LIVE_CODEX_SDK"),
  );
  const commandEvidence = result.commandEvidence.map((item) => parseCommandEvidence(item));
  const policyVerificationAttempts = result.policyVerificationAttempts.map((item) =>
    parsePolicyVerificationEvidence(item),
  );
  const review = parseReviewResult(result.review, "LIVE_CODEX_SDK");
  if (review.verdict !== "APPROVE" || policyVerificationAttempts.at(-1)?.status !== "PASS") {
    throw new Error("Worker RPC PASS report lacks final corpus PASS or independent approval.");
  }
  const runIds = [
    cartography.metadata.runId,
    ...repairAttempts.map((item) => item.metadata.runId),
    review.metadata.runId,
  ];
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("Worker RPC phase run identities must be distinct.");
  }
  return {
    schemaVersion: "1",
    executionMode: "LIVE_CODEX_SDK",
    status: "PASS",
    attempts,
    cartography,
    repairAttempts,
    commandEvidence: commandEvidence as CommandEvidence[],
    commandFailures: [],
    policyVerificationAttempts: policyVerificationAttempts as PolicyVerificationEvidence[],
    review,
    failure: null,
  };
}

function parseReceipt(value: unknown): WorkerRpcSupervisorReceipt {
  const result = record(value, "worker RPC supervisor receipt");
  exactKeys(
    result,
    [
      "schemaVersion",
      "algorithm",
      "keyId",
      "supervisorId",
      "supervisorRunId",
      "workerImageDigest",
      "workerPolicySha256",
      "fixtureId",
      "baselineContentSha256",
      "baselineExecutionTreeSha256",
      "finalExecutionTreeSha256",
      "finalExecutionTreeManifest",
      "acceptedCorpusSha256",
      "executionMode",
      "repairWorkspaceDeleted",
      "verificationWorkspaceDeleted",
      "processTreeReaped",
      "remainingProcessCount",
      "signature",
    ],
    "worker RPC supervisor receipt",
  );
  if (
    result.schemaVersion !== "1" ||
    result.algorithm !== "Ed25519" ||
    result.fixtureId !== "seeded-refund-demo" ||
    result.executionMode !== "LIVE_CODEX_SDK" ||
    result.repairWorkspaceDeleted !== true ||
    result.verificationWorkspaceDeleted !== true ||
    result.processTreeReaped !== true ||
    result.remainingProcessCount !== 0
  ) {
    throw new Error("Worker RPC supervisor receipt does not prove mandatory teardown.");
  }
  if (
    typeof result.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(result.signature) ||
    Buffer.from(result.signature, "base64url").byteLength !== 64 ||
    Buffer.from(result.signature, "base64url").toString("base64url") !== result.signature
  ) {
    throw new Error("Worker RPC supervisor signature encoding is invalid.");
  }
  const finalExecutionTreeManifest = parseWorkerRpcExecutionTreeManifest(
    result.finalExecutionTreeManifest,
  );
  const finalExecutionTreeSha256 = sha256(
    result.finalExecutionTreeSha256,
    "worker RPC final execution tree digest",
  );
  if (finalExecutionTreeSha256 !== workerRpcExecutionTreeSha256(finalExecutionTreeManifest)) {
    throw new Error("Worker RPC final execution tree digest does not match its manifest.");
  }
  return {
    schemaVersion: "1",
    algorithm: "Ed25519",
    keyId: safeId(result.keyId, "worker RPC key ID", 3, 128),
    supervisorId: safeId(result.supervisorId, "worker RPC supervisor ID", 3, 128),
    supervisorRunId: safeId(result.supervisorRunId, "worker RPC supervisor run ID", 16, 128),
    workerImageDigest: imageDigest(result.workerImageDigest),
    workerPolicySha256: sha256(
      result.workerPolicySha256,
      "worker RPC worker policy digest",
    ),
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: sha256(
      result.baselineContentSha256,
      "worker RPC baseline content digest",
    ),
    baselineExecutionTreeSha256: sha256(
      result.baselineExecutionTreeSha256,
      "worker RPC baseline execution tree digest",
    ),
    finalExecutionTreeSha256,
    finalExecutionTreeManifest,
    acceptedCorpusSha256: sha256(
      result.acceptedCorpusSha256,
      "worker RPC accepted corpus digest",
    ),
    executionMode: "LIVE_CODEX_SDK",
    repairWorkspaceDeleted: true,
    verificationWorkspaceDeleted: true,
    processTreeReaped: true,
    remainingProcessCount: 0,
    signature: result.signature,
  };
}

export function parseWorkerRpcResponse(value: unknown): WorkerRpcResponse {
  const result = record(value, "worker RPC response");
  exactKeys(
    result,
    [
      "schemaVersion",
      "protocol",
      "action",
      "requestId",
      "runNonce",
      "sequence",
      "requestSha256",
      "status",
      "completedAt",
      "resultSha256",
      "report",
      "error",
      "receipt",
    ],
    "worker RPC response",
  );
  if (
    result.schemaVersion !== "1" ||
    result.protocol !== WORKER_RPC_PROTOCOL ||
    result.action !== WORKER_RPC_RESPONSE_ACTION ||
    result.sequence !== 1 ||
    (result.status !== "PASS" && result.status !== "FAIL")
  ) {
    throw new Error("Worker RPC response protocol metadata is invalid.");
  }
  const requestId = safeId(result.requestId, "worker RPC response request ID", 16, 64);
  if (!/^[0-9a-f]{32}$/u.test(requestId)) {
    throw new Error("Worker RPC response request ID is invalid.");
  }
  if (
    typeof result.runNonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(result.runNonce) ||
    Buffer.from(result.runNonce, "base64url").byteLength !== 32
  ) {
    throw new Error("Worker RPC response nonce is invalid.");
  }
  const status = result.status as "PASS" | "FAIL";
  let report: RepairWorkerReport | null;
  let error: string | null;
  if (status === "PASS") {
    report = parseLivePassReport(result.report);
    if (result.error !== null) throw new Error("Worker RPC PASS response must not include an error.");
    error = null;
  } else {
    if (result.report !== null || typeof result.error !== "string" || result.error.length === 0) {
      throw new Error("Worker RPC FAIL response must contain only a bounded error.");
    }
    error = assertSafeRpcText(result.error, "worker RPC error", 4_096);
    report = null;
  }
  const expectedResultHash = workerRpcSha256(report ?? { error });
  if (sha256(result.resultSha256, "worker RPC result digest") !== expectedResultHash) {
    throw new Error("Worker RPC result digest does not match its body.");
  }
  return {
    schemaVersion: "1",
    protocol: WORKER_RPC_PROTOCOL,
    action: WORKER_RPC_RESPONSE_ACTION,
    requestId,
    runNonce: result.runNonce,
    sequence: 1,
    requestSha256: sha256(result.requestSha256, "worker RPC request digest"),
    status,
    completedAt: canonicalIso(result.completedAt, "worker RPC completedAt"),
    resultSha256: result.resultSha256 as string,
    report,
    error,
    receipt: parseReceipt(result.receipt),
  };
}

export function workerRpcSignaturePayload(response: WorkerRpcResponse): string {
  const { signature: _signature, ...receipt } = response.receipt;
  return canonicalWorkerRpcJson({
    domain: WORKER_RPC_SIGNATURE_DOMAIN,
    response: {
      ...response,
      receipt,
    },
  });
}

export function parseWorkerRpcV2Request(value: unknown): WorkerRpcV2Request {
  const result = record(value, "worker RPC v2 request");
  exactKeys(
    result,
    [
      "schemaVersion",
      "protocol",
      "action",
      "requestId",
      "runNonce",
      "sequence",
      "issuedAt",
      "expiresAt",
      "model",
      "modelReasoningEffort",
      "inputSha256",
      "policySha256",
      "executionBindingSha256",
      "policy",
      "input",
    ],
    "worker RPC v2 request",
  );
  if (
    result.schemaVersion !== "2" ||
    result.protocol !== WORKER_RPC_V2_PROTOCOL ||
    result.action !== WORKER_RPC_REQUEST_ACTION ||
    result.sequence !== 1 ||
    result.modelReasoningEffort !== "high"
  ) {
    throw new Error("Worker RPC v2 request protocol metadata is invalid.");
  }
  const parsedRequestId = safeId(result.requestId, "worker RPC v2 request ID", 16, 64);
  if (!/^[0-9a-f]{32}$/u.test(parsedRequestId)) {
    throw new Error("Worker RPC v2 request ID must be a 128-bit lowercase hex value.");
  }
  if (
    typeof result.runNonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(result.runNonce) ||
    Buffer.from(result.runNonce, "base64url").byteLength !== 32 ||
    Buffer.from(result.runNonce, "base64url").toString("base64url") !== result.runNonce
  ) {
    throw new Error("Worker RPC v2 run nonce must be canonical 256-bit base64url.");
  }
  if (
    typeof result.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(result.model)
  ) {
    throw new Error("Worker RPC v2 model must be an explicit safe identifier.");
  }
  const issuedAt = canonicalIso(result.issuedAt, "worker RPC v2 issuedAt");
  const expiresAt = canonicalIso(result.expiresAt, "worker RPC v2 expiresAt");
  const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (validityMs < 1_000 || validityMs > 15 * 60_000) {
    throw new Error("Worker RPC v2 request validity window is invalid.");
  }
  const policy = parseWorkerRpcPolicy(result.policy);
  const input = parseRepairWorkerInput(result.input);
  const inputSha256 = sha256(result.inputSha256, "worker RPC v2 input digest");
  const policySha256 = sha256(result.policySha256, "worker RPC v2 policy digest");
  if (
    inputSha256 !== workerRpcSha256(input) ||
    policySha256 !== workerRpcSha256(policy) ||
    policy.acceptedCorpusSha256 !== acceptedCorpusSha256(input)
  ) {
    throw new Error("Worker RPC v2 request hashes are inconsistent with validated input.");
  }
  const executionBindingSha256 = sha256(
    result.executionBindingSha256,
    "worker RPC v2 execution binding",
  );
  if (
    executionBindingSha256 !==
    workerRpcV2ExecutionBindingSha256({
      requestId: parsedRequestId,
      runNonce: result.runNonce,
      model: result.model,
      inputSha256,
      policySha256,
    })
  ) {
    throw new Error("Worker RPC v2 execution binding is inconsistent with the request.");
  }
  const parsed: WorkerRpcV2Request = {
    schemaVersion: "2",
    protocol: WORKER_RPC_V2_PROTOCOL,
    action: WORKER_RPC_REQUEST_ACTION,
    requestId: parsedRequestId,
    runNonce: result.runNonce,
    sequence: 1,
    issuedAt,
    expiresAt,
    model: result.model,
    modelReasoningEffort: "high",
    inputSha256,
    policySha256,
    executionBindingSha256,
    policy,
    input,
  };
  const encoded = canonicalWorkerRpcJson(parsed);
  if (Buffer.byteLength(encoded, "utf8") > WORKER_RPC_MAX_REQUEST_BYTES) {
    throw new Error("Worker RPC v2 request exceeds the byte limit.");
  }
  assertSafeRpcText(encoded, "worker RPC v2 request", WORKER_RPC_MAX_REQUEST_BYTES);
  return parsed;
}

function parseV2Receipt(
  value: unknown,
  expected: {
    status: "PASS" | "FAIL";
    requestId: string;
    runNonce: string;
    requestSha256: string;
    executionBindingSha256: string;
  },
): WorkerRpcV2SupervisorReceipt {
  const result = record(value, "worker RPC v2 supervisor receipt");
  exactKeys(
    result,
    [
      "schemaVersion",
      "algorithm",
      "keyId",
      "supervisorId",
      "supervisorRunId",
      "workerImageDigest",
      "workerPolicySha256",
      "fixtureId",
      "baselineContentSha256",
      "baselineExecutionTreeSha256",
      "finalExecutionTreeSha256",
      "finalExecutionTreeManifest",
      "acceptedCorpusSha256",
      "executionMode",
      "executionBindingSha256",
      "dockerBindingSha256",
      "cpuProof",
      "repairWorkspaceDeleted",
      "verificationWorkspaceDeleted",
      "processTreeReaped",
      "remainingProcessCount",
      "signature",
    ],
    "worker RPC v2 supervisor receipt",
  );
  if (
    result.schemaVersion !== "2" ||
    result.algorithm !== "Ed25519" ||
    result.fixtureId !== "seeded-refund-demo" ||
    result.executionMode !== "LIVE_CODEX_SDK" ||
    result.repairWorkspaceDeleted !== true ||
    result.verificationWorkspaceDeleted !== true ||
    result.processTreeReaped !== true ||
    result.remainingProcessCount !== 0
  ) {
    throw new Error("Worker RPC v2 receipt does not prove mandatory teardown.");
  }
  if (
    typeof result.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(result.signature) ||
    Buffer.from(result.signature, "base64url").byteLength !== 64 ||
    Buffer.from(result.signature, "base64url").toString("base64url") !== result.signature
  ) {
    throw new Error("Worker RPC v2 supervisor signature encoding is invalid.");
  }
  const supervisorRunId = safeId(
    result.supervisorRunId,
    "worker RPC v2 supervisor run ID",
    16,
    128,
  );
  const parsedWorkerImageDigest = imageDigest(result.workerImageDigest);
  const workerPolicySha256 = sha256(
    result.workerPolicySha256,
    "worker RPC v2 worker policy digest",
  );
  const acceptedCorpusSha256 = sha256(
    result.acceptedCorpusSha256,
    "worker RPC v2 accepted corpus digest",
  );
  const executionBindingSha256 = sha256(
    result.executionBindingSha256,
    "worker RPC v2 receipt execution binding",
  );
  if (executionBindingSha256 !== expected.executionBindingSha256) {
    throw new Error("Worker RPC v2 receipt execution binding is inconsistent.");
  }
  const dockerBindingSha256 = sha256(
    result.dockerBindingSha256,
    "worker RPC v2 Docker binding",
  );
  let cpuProof: LiveLinuxCgroupCpuProof | null;
  if (expected.status === "PASS") {
    cpuProof = parseLiveLinuxCgroupCpuProof(result.cpuProof, {
      requestId: expected.requestId,
      runNonce: expected.runNonce,
      requestSha256: expected.requestSha256,
      executionBindingSha256,
      supervisorRunId,
      dockerBindingSha256,
      workerImageDigest: parsedWorkerImageDigest,
      workerPolicySha256,
      acceptedCorpusSha256,
    });
  } else {
    if (result.cpuProof !== null) {
      throw new Error("Worker RPC v2 FAIL receipt cannot carry a success CPU proof.");
    }
    cpuProof = null;
  }
  const finalExecutionTreeManifest = parseWorkerRpcExecutionTreeManifest(
    result.finalExecutionTreeManifest,
  );
  const finalExecutionTreeSha256 = sha256(
    result.finalExecutionTreeSha256,
    "worker RPC v2 final execution tree digest",
  );
  if (finalExecutionTreeSha256 !== workerRpcExecutionTreeSha256(finalExecutionTreeManifest)) {
    throw new Error("Worker RPC v2 final tree digest does not match its manifest.");
  }
  return {
    schemaVersion: "2",
    algorithm: "Ed25519",
    keyId: safeId(result.keyId, "worker RPC v2 key ID", 3, 128),
    supervisorId: safeId(result.supervisorId, "worker RPC v2 supervisor ID", 3, 128),
    supervisorRunId,
    workerImageDigest: parsedWorkerImageDigest,
    workerPolicySha256,
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: sha256(
      result.baselineContentSha256,
      "worker RPC v2 baseline content digest",
    ),
    baselineExecutionTreeSha256: sha256(
      result.baselineExecutionTreeSha256,
      "worker RPC v2 baseline execution tree digest",
    ),
    finalExecutionTreeSha256,
    finalExecutionTreeManifest,
    acceptedCorpusSha256,
    executionMode: "LIVE_CODEX_SDK",
    executionBindingSha256,
    dockerBindingSha256,
    cpuProof,
    repairWorkspaceDeleted: true,
    verificationWorkspaceDeleted: true,
    processTreeReaped: true,
    remainingProcessCount: 0,
    signature: result.signature,
  };
}

export function parseWorkerRpcV2Response(value: unknown): WorkerRpcV2Response {
  const result = record(value, "worker RPC v2 response");
  exactKeys(
    result,
    [
      "schemaVersion",
      "protocol",
      "action",
      "requestId",
      "runNonce",
      "sequence",
      "requestSha256",
      "executionBindingSha256",
      "status",
      "completedAt",
      "resultSha256",
      "report",
      "error",
      "receipt",
    ],
    "worker RPC v2 response",
  );
  if (
    result.schemaVersion !== "2" ||
    result.protocol !== WORKER_RPC_V2_PROTOCOL ||
    result.action !== WORKER_RPC_RESPONSE_ACTION ||
    result.sequence !== 1 ||
    (result.status !== "PASS" && result.status !== "FAIL")
  ) {
    throw new Error("Worker RPC v2 response protocol metadata is invalid.");
  }
  const parsedRequestId = safeId(result.requestId, "worker RPC v2 response request ID", 16, 64);
  if (!/^[0-9a-f]{32}$/u.test(parsedRequestId)) {
    throw new Error("Worker RPC v2 response request ID is invalid.");
  }
  if (
    typeof result.runNonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(result.runNonce) ||
    Buffer.from(result.runNonce, "base64url").byteLength !== 32 ||
    Buffer.from(result.runNonce, "base64url").toString("base64url") !== result.runNonce
  ) {
    throw new Error("Worker RPC v2 response nonce is invalid.");
  }
  const status = result.status as "PASS" | "FAIL";
  let report: RepairWorkerReport | null;
  let error: string | null;
  if (status === "PASS") {
    report = parseLivePassReport(result.report);
    if (result.error !== null) {
      throw new Error("Worker RPC v2 PASS response must not include an error.");
    }
    error = null;
  } else {
    if (result.report !== null || typeof result.error !== "string" || result.error.length === 0) {
      throw new Error("Worker RPC v2 FAIL response must contain only a bounded error.");
    }
    error = assertSafeRpcText(result.error, "worker RPC v2 error", 4_096);
    report = null;
  }
  const expectedResultHash = workerRpcSha256(report ?? { error });
  if (sha256(result.resultSha256, "worker RPC v2 result digest") !== expectedResultHash) {
    throw new Error("Worker RPC v2 result digest does not match its body.");
  }
  const parsedRequestSha256 = sha256(
    result.requestSha256,
    "worker RPC v2 request digest",
  );
  const executionBindingSha256 = sha256(
    result.executionBindingSha256,
    "worker RPC v2 execution binding",
  );
  return {
    schemaVersion: "2",
    protocol: WORKER_RPC_V2_PROTOCOL,
    action: WORKER_RPC_RESPONSE_ACTION,
    requestId: parsedRequestId,
    runNonce: result.runNonce,
    sequence: 1,
    requestSha256: parsedRequestSha256,
    executionBindingSha256,
    status,
    completedAt: canonicalIso(result.completedAt, "worker RPC v2 completedAt"),
    resultSha256: result.resultSha256 as string,
    report,
    error,
    receipt: parseV2Receipt(result.receipt, {
      status,
      requestId: parsedRequestId,
      runNonce: result.runNonce,
      requestSha256: parsedRequestSha256,
      executionBindingSha256,
    }),
  };
}

export function workerRpcV2SignaturePayload(response: WorkerRpcV2Response): string {
  const { signature: _signature, ...receipt } = response.receipt;
  return canonicalWorkerRpcJson({
    domain: WORKER_RPC_V2_SIGNATURE_DOMAIN,
    response: {
      ...response,
      receipt,
    },
  });
}
