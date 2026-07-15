import {
  createHash,
  createPublicKey,
  randomBytes as secureRandomBytes,
  verify as verifySignature,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { assertNoSensitiveWorkerText, redactWorkerOutput } from "./safety.js";
import {
  WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
  WORKER_RPC_MAX_RESPONSE_CHUNKS,
  WORKER_RPC_MAX_RESPONSE_BYTES,
  WORKER_RPC_PROTOCOL,
  WORKER_RPC_REQUEST_ACTION,
  WORKER_RPC_V2_PROTOCOL,
  acceptedCorpusSha256,
  assertNoWorkerRpcHostPath,
  canonicalWorkerRpcJson,
  parseWorkerRpcExecutionTreeManifest,
  parseWorkerRpcRequest,
  parseWorkerRpcResponse,
  parseWorkerRpcV2Request,
  parseWorkerRpcV2Response,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcSignaturePayload,
  workerRpcV2ExecutionBindingSha256,
  workerRpcV2SignaturePayload,
  type WorkerRpcPolicy,
  type WorkerRpcExecutionTreeManifest,
  type WorkerRpcRequest,
  type WorkerRpcResourceLimits,
  type WorkerRpcResponse,
  type WorkerRpcSupervisorReceipt,
  type WorkerRpcV2Request,
  type WorkerRpcV2Response,
  type WorkerRpcV2SupervisorReceipt,
} from "./worker-rpc-contract.js";
import { parseRepairWorkerInput } from "./validate.js";
import type { RepairWorkerInput, RepairWorkerReport } from "./types.js";

export interface ExternalWorkerRpcResponseStream {
  readonly declaredLength: number;
  readonly chunks: AsyncIterable<Uint8Array>;
}

export interface ExternalWorkerRpcTransport {
  readonly id: string;
  readonly authenticationMode: "MUTUAL_TLS" | "LOCAL_SOCKET_ACL";
  call(
    canonicalRequest: string,
    options: {
      signal: AbortSignal;
      maxResponseBytes: number;
      maxChunkBytes: number;
      maxChunks: number;
    },
  ): Promise<ExternalWorkerRpcResponseStream>;
}

interface ExternalWorkerRpcBaseOptions {
  transport: ExternalWorkerRpcTransport;
  expectedSupervisorId: string;
  expectedBackendId: string;
  workerImageDigest: string;
  baselineContentSha256: string;
  baselineExecutionTreeSha256: string;
  baselineExecutionTreeManifest: WorkerRpcExecutionTreeManifest;
  model: string;
  limits: WorkerRpcResourceLimits;
  rpcTimeoutMs: number;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}

export interface ExternalWorkerRpcClientOptions extends ExternalWorkerRpcBaseOptions {
  trustBundle: WorkerRpcTrustBundle;
}

export interface ExternalWorkerRpcV2ClientOptions extends ExternalWorkerRpcBaseOptions {
  trustBundle: WorkerRpcTrustBundle;
}

export interface LiveSupervisorTrustEntry {
  publicKeyPem: string;
  supervisorId: string;
  purpose: "LIVE_LINUX_CGROUP_RPC_V2";
}

export interface WorkerRpcTrustBundle {
  readonly generalWorkerPublicKeys: Readonly<Record<string, string>>;
  readonly liveSupervisorPublicKeys: Readonly<Record<string, LiveSupervisorTrustEntry>>;
}

export interface WorkerRpcTrustBundleInput {
  generalWorkerPublicKeys: Readonly<Record<string, string>>;
  liveSupervisorPublicKeys: Readonly<Record<string, LiveSupervisorTrustEntry>>;
}

const WORKER_RPC_TRUST_BUNDLES = new WeakSet<object>();
const WORKER_RPC_TRUST_METADATA = new WeakMap<
  object,
  {
    generalFingerprints: ReadonlyMap<string, string>;
    liveFingerprints: ReadonlyMap<string, string>;
  }
>();

export interface ValidatedExternalWorkerRun {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  completedAt: string;
  report: RepairWorkerReport;
  receipt: WorkerRpcSupervisorReceipt;
}

export interface ValidatedExternalWorkerV2Run {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  executionBindingSha256: string;
  completedAt: string;
  report: RepairWorkerReport;
  receipt: WorkerRpcV2SupervisorReceipt & { cpuProof: NonNullable<WorkerRpcV2SupervisorReceipt["cpuProof"]> };
}

function safeDiagnostic(value: unknown): string {
  const redacted = redactWorkerOutput(
    value instanceof Error ? value.message : String(value),
    4_096,
  ).text;
  try {
    assertNoWorkerRpcHostPath(redacted, "external worker diagnostic");
    return redacted;
  } catch {
    return "[REDACTED_WORKER_DIAGNOSTIC]";
  }
}

function safeIdentifier(value: string, label: string): string {
  if (value.length < 3 || value.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function sha256(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function imageDigest(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("External worker image must use an immutable sha256 digest.");
  }
  return value;
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function publicKeyFingerprint(publicKeyPem: string, label: string): string {
  if (typeof publicKeyPem !== "string" || publicKeyPem.includes("PRIVATE KEY")) {
    throw new Error(`${label} is not a public key.`);
  }
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    throw new Error(`${label} is invalid: ${safeDiagnostic(error)}`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label} must be Ed25519.`);
  }
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export function createWorkerRpcTrustBundle(
  input: WorkerRpcTrustBundleInput,
): WorkerRpcTrustBundle {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "generalWorkerPublicKeys,liveSupervisorPublicKeys"
  ) {
    throw new Error("Worker RPC trust bundle input is invalid.");
  }
  const generalEntries = Object.entries(input.generalWorkerPublicKeys);
  const liveEntries = Object.entries(input.liveSupervisorPublicKeys);
  if (generalEntries.length === 0 || liveEntries.length === 0) {
    throw new Error("Worker RPC trust bundle requires both v1 and v2 key registries.");
  }
  const materialOwners = new Map<string, string>();
  const generalFingerprints = new Map<string, string>();
  const liveFingerprints = new Map<string, string>();
  const generalWorkerPublicKeys: Record<string, string> = {};
  const liveSupervisorPublicKeys: Record<string, LiveSupervisorTrustEntry> = {};
  for (const [keyId, publicKeyPem] of generalEntries) {
    safeIdentifier(keyId, "general worker trust key ID");
    const fingerprint = publicKeyFingerprint(publicKeyPem, "General worker trust key");
    if (materialOwners.has(fingerprint)) {
      throw new Error("Worker RPC trust bundle reuses Ed25519 key material.");
    }
    materialOwners.set(fingerprint, `GENERAL:${keyId}`);
    generalFingerprints.set(keyId, fingerprint);
    generalWorkerPublicKeys[keyId] = publicKeyPem;
  }
  for (const [keyId, entry] of liveEntries) {
    if (!keyId.startsWith("live-cpu-")) {
      throw new Error("Worker RPC live trust key lacks the live CPU purpose prefix.");
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "publicKeyPem,purpose,supervisorId" ||
      entry.purpose !== "LIVE_LINUX_CGROUP_RPC_V2"
    ) {
      throw new Error("Worker RPC live trust entry is invalid.");
    }
    safeIdentifier(entry.supervisorId, "live worker trust supervisor ID");
    const fingerprint = publicKeyFingerprint(entry.publicKeyPem, "Live worker trust key");
    if (materialOwners.has(fingerprint)) {
      throw new Error("Worker RPC trust bundle reuses Ed25519 key material.");
    }
    materialOwners.set(fingerprint, `LIVE:${keyId}`);
    liveFingerprints.set(keyId, fingerprint);
    liveSupervisorPublicKeys[keyId] = Object.freeze({ ...entry });
  }
  const bundle = Object.freeze({
    generalWorkerPublicKeys: Object.freeze(generalWorkerPublicKeys),
    liveSupervisorPublicKeys: Object.freeze(liveSupervisorPublicKeys),
  });
  WORKER_RPC_TRUST_BUNDLES.add(bundle);
  WORKER_RPC_TRUST_METADATA.set(bundle, { generalFingerprints, liveFingerprints });
  return bundle;
}

export function assertWorkerRpcTrustBundle(value: WorkerRpcTrustBundle): void {
  if (!WORKER_RPC_TRUST_BUNDLES.has(value)) {
    throw new Error("Worker RPC requires a factory-created immutable trust bundle.");
  }
}

export function assertWorkerRpcTrustBundleSigner(
  bundle: WorkerRpcTrustBundle,
  signer: {
    keyId: string;
    supervisorId: string;
    purpose: "GENERAL_WORKER_RPC_V1" | "LIVE_LINUX_CGROUP_RPC_V2";
    publicKeySpkiSha256: string;
  },
): void {
  assertWorkerRpcTrustBundle(bundle);
  const metadata = WORKER_RPC_TRUST_METADATA.get(bundle);
  if (metadata === undefined) throw new Error("Worker RPC trust metadata is unavailable.");
  const expected =
    signer.purpose === "GENERAL_WORKER_RPC_V1"
      ? metadata.generalFingerprints.get(signer.keyId)
      : metadata.liveFingerprints.get(signer.keyId);
  if (expected !== signer.publicKeySpkiSha256) {
    throw new Error("Worker RPC signer is not registered for its exact key purpose.");
  }
  if (signer.purpose === "LIVE_LINUX_CGROUP_RPC_V2") {
    const entry = bundle.liveSupervisorPublicKeys[signer.keyId];
    if (entry?.supervisorId !== signer.supervisorId) {
      throw new Error("Worker RPC live signer supervisor identity is not trusted.");
    }
  }
}

function randomToken(
  size: number,
  source: (size: number) => Uint8Array,
  encoding: "hex" | "base64url",
): string {
  const value = source(size);
  if (!(value instanceof Uint8Array) || value.byteLength !== size) {
    throw new Error(`External worker random source must return exactly ${size} bytes.`);
  }
  return Buffer.from(value).toString(encoding);
}

function buildPolicy(
  options: ExternalWorkerRpcBaseOptions,
  input: RepairWorkerInput,
): WorkerRpcPolicy {
  return {
    schemaVersion: "1",
    fixtureId: "seeded-refund-demo",
    baselineContentSha256: sha256(
      options.baselineContentSha256,
      "external worker baseline content digest",
    ),
    baselineExecutionTreeSha256: sha256(
      options.baselineExecutionTreeSha256,
      "external worker baseline execution tree digest",
    ),
    baselineExecutionTreeManifest: parseWorkerRpcExecutionTreeManifest(
      options.baselineExecutionTreeManifest,
    ),
    acceptedCorpusSha256: acceptedCorpusSha256(input),
    workerImageDigest: imageDigest(options.workerImageDigest),
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
    limits: { ...options.limits },
  };
}

function nextChunk(
  iterator: AsyncIterator<Uint8Array>,
  signal: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new Error("External worker RPC timed out."));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("External worker RPC timed out."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readBoundedResponse(
  value: ExternalWorkerRpcResponseStream,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isInteger(value.declaredLength) ||
    value.declaredLength < 1 ||
    value.declaredLength > WORKER_RPC_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      "External worker response length is empty, invalid, or exceeds the preallocation limit.",
    );
  }
  const chunks = value.chunks;
  if (
    typeof chunks !== "object" ||
    chunks === null ||
    typeof chunks[Symbol.asyncIterator] !== "function"
  ) {
    throw new Error("External worker response must provide an asynchronous byte stream.");
  }
  const iterator = chunks[Symbol.asyncIterator]();
  const received: Buffer[] = [];
  let receivedBytes = 0;
  let receivedChunks = 0;
  try {
    while (true) {
      const next = await nextChunk(iterator, signal);
      if (next.done) break;
      receivedChunks += 1;
      if (receivedChunks > WORKER_RPC_MAX_RESPONSE_CHUNKS) {
        throw new Error("External worker response exceeds the chunk-count limit.");
      }
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength === 0 ||
        next.value.byteLength > WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES
      ) {
        throw new Error("External worker response contains an invalid or oversized chunk.");
      }
      receivedBytes += next.value.byteLength;
      if (
        receivedBytes > value.declaredLength ||
        receivedBytes > WORKER_RPC_MAX_RESPONSE_BYTES
      ) {
        throw new Error("External worker response exceeded its declared byte length.");
      }
      received.push(Buffer.from(next.value));
    }
  } catch (error) {
    void iterator.return?.().catch(() => undefined);
    throw error;
  }
  if (receivedBytes !== value.declaredLength) {
    throw new Error("External worker response did not match its declared byte length.");
  }
  return Buffer.concat(received, receivedBytes);
}

function decodeResponse(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("External worker response is not canonical UTF-8.");
  }
  if (!Buffer.from(text, "utf8").equals(bytes) || text.includes("\0")) {
    throw new Error("External worker response is not canonical NUL-free UTF-8.");
  }
  assertNoSensitiveWorkerText(
    text,
    "external worker response",
    WORKER_RPC_MAX_RESPONSE_BYTES,
  );
  assertNoWorkerRpcHostPath(text, "external worker response");
  return text;
}

function parseCanonicalResponse(text: string): WorkerRpcResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`External worker response is not JSON: ${safeDiagnostic(error)}`);
  }
  const response = parseWorkerRpcResponse(value);
  if (canonicalWorkerRpcJson(response) !== text) {
    throw new Error("External worker response must use the canonical JSON encoding.");
  }
  return response;
}

function parseCanonicalV2Response(text: string): WorkerRpcV2Response {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`External worker v2 response is not JSON: ${safeDiagnostic(error)}`);
  }
  const response = parseWorkerRpcV2Response(value);
  if (canonicalWorkerRpcJson(response) !== text) {
    throw new Error("External worker v2 response must use the canonical JSON encoding.");
  }
  return response;
}

function verifyReceiptSignature(
  response: WorkerRpcResponse,
  trustBundle: WorkerRpcTrustBundle,
): void {
  const trusted = Object.hasOwn(
    trustBundle.generalWorkerPublicKeys,
    response.receipt.keyId,
  )
    ? trustBundle.generalWorkerPublicKeys[response.receipt.keyId]
    : undefined;
  if (typeof trusted !== "string" || trusted.includes("PRIVATE KEY")) {
    throw new Error("External worker receipt key is not trusted as a public key.");
  }
  let publicKey;
  try {
    publicKey = createPublicKey(trusted);
  } catch (error) {
    throw new Error(`External worker public key is invalid: ${safeDiagnostic(error)}`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("External worker public key must be Ed25519.");
  }
  const valid = verifySignature(
    null,
    Buffer.from(workerRpcSignaturePayload(response), "utf8"),
    publicKey,
    Buffer.from(response.receipt.signature, "base64url"),
  );
  if (!valid) throw new Error("External worker supervisor signature is invalid.");
}

function verifyV2ReceiptSignature(
  response: WorkerRpcV2Response,
  options: ExternalWorkerRpcV2ClientOptions,
): void {
  if (!response.receipt.keyId.startsWith("live-cpu-")) {
    throw new Error("External worker v2 receipt key lacks the live CPU proof purpose.");
  }
  const trusted = Object.hasOwn(
    options.trustBundle.liveSupervisorPublicKeys,
    response.receipt.keyId,
  )
    ? options.trustBundle.liveSupervisorPublicKeys[response.receipt.keyId]
    : undefined;
  if (
    typeof trusted !== "object" ||
    trusted === null ||
    Array.isArray(trusted) ||
    Object.keys(trusted).sort().join(",") !== "publicKeyPem,purpose,supervisorId" ||
    trusted.purpose !== "LIVE_LINUX_CGROUP_RPC_V2" ||
    trusted.supervisorId !== response.receipt.supervisorId ||
    trusted.supervisorId !== options.expectedSupervisorId ||
    typeof trusted.publicKeyPem !== "string" ||
    trusted.publicKeyPem.includes("PRIVATE KEY")
  ) {
    throw new Error("External worker v2 receipt key is not trusted for live CPU proof.");
  }
  let publicKey;
  try {
    publicKey = createPublicKey(trusted.publicKeyPem);
  } catch (error) {
    throw new Error(`External worker v2 public key is invalid: ${safeDiagnostic(error)}`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("External worker v2 public key must be Ed25519.");
  }
  const valid = verifySignature(
    null,
    Buffer.from(workerRpcV2SignaturePayload(response), "utf8"),
    publicKey,
    Buffer.from(response.receipt.signature, "base64url"),
  );
  if (!valid) throw new Error("External worker v2 supervisor signature is invalid.");
}

type WorkerRpcRequestLike = WorkerRpcRequest | WorkerRpcV2Request;

function verifyPhaseMetadata(
  report: RepairWorkerReport,
  request: WorkerRpcRequestLike,
  expectedBackendId: string,
): void {
  if (report.cartography === null || report.review === null) {
    throw new Error("External worker PASS report lacks required phases.");
  }
  const phases = [
    report.cartography.metadata,
    ...report.repairAttempts.map((item) => item.metadata),
    report.review.metadata,
  ];
  for (const metadata of phases) {
    if (
      metadata.executionMode !== "LIVE_CODEX_SDK" ||
      metadata.backendId !== expectedBackendId ||
      metadata.sdkVersion !== "0.144.3" ||
      metadata.model !== request.model ||
      metadata.modelReasoningEffort !== "high" ||
      Date.parse(metadata.startedAt) < Date.parse(request.issuedAt) ||
      Date.parse(metadata.completedAt) > Date.parse(request.expiresAt)
    ) {
      throw new Error("External worker phase metadata is not bound to the requested live run.");
    }
  }
}

function verifyReportHistory(report: RepairWorkerReport, request: WorkerRpcRequestLike): string {
  const repairRunIds = report.repairAttempts.map((item) => item.metadata.runId);
  if (report.commandEvidence.length !== report.attempts * 2) {
    throw new Error("External worker report does not preserve both commands for every attempt.");
  }
  const expectedPolicyIrSha256 = workerRpcSha256(request.input.acceptedPolicyIr);
  for (const repair of report.repairAttempts) {
    if (
      JSON.stringify(repair.changedFiles) !==
      JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"])
    ) {
      throw new Error("External worker repair changed-files receipt exceeds the fixed write set.");
    }
  }
  const receiptsByAttempt = new Map(
    report.policyVerificationAttempts.map((receipt) => [receipt.attempt, receipt]),
  );
  let previousReceiptAttempt = 0;
  for (const receipt of report.policyVerificationAttempts) {
    if (
      receipt.attempt <= previousReceiptAttempt ||
      receipt.attempt > report.attempts ||
      receipt.repairRunId !== repairRunIds[receipt.attempt - 1] ||
      receipt.acceptedCorpusSha256 !== request.policy.acceptedCorpusSha256 ||
      receipt.policyIrSha256 !== expectedPolicyIrSha256 ||
      receipt.total !== request.input.acceptedCases.length ||
      receipt.results.length !== request.input.acceptedCases.length
    ) {
      throw new Error("External worker corpus receipts are not bound to ordered repair attempts.");
    }
    previousReceiptAttempt = receipt.attempt;
    const caseById = new Map(request.input.acceptedCases.map((item) => [item.id, item]));
    const seenCaseIds = new Set<string>();
    for (const result of receipt.results) {
      const expected = caseById.get(result.caseId);
      if (
        expected === undefined ||
        seenCaseIds.has(result.caseId) ||
        result.expectedDecision !== expected.expectedDecision
      ) {
        throw new Error("External worker corpus receipt changed or duplicated an accepted case.");
      }
      seenCaseIds.add(result.caseId);
    }
  }
  for (let index = 0; index < report.commandEvidence.length; index += 2) {
    const attempt = index / 2 + 1;
    const typecheck = report.commandEvidence[index];
    const fixtureTest = report.commandEvidence[index + 1];
    const repairRunId = repairRunIds[attempt - 1];
    if (
      typecheck === undefined ||
      fixtureTest === undefined ||
      repairRunId === undefined ||
      typecheck.attempt !== attempt ||
      fixtureTest.attempt !== attempt ||
      typecheck.repairRunId !== repairRunId ||
      fixtureTest.repairRunId !== repairRunId ||
      typecheck.commandId !== "fixture-typecheck" ||
      fixtureTest.commandId !== "fixture-test" ||
      typecheck.fixtureTreeBeforeSha256 !== typecheck.fixtureTreeAfterSha256 ||
      typecheck.fixtureTreeAfterSha256 !== fixtureTest.fixtureTreeBeforeSha256 ||
      fixtureTest.fixtureTreeBeforeSha256 !== fixtureTest.fixtureTreeAfterSha256
    ) {
      throw new Error("External worker command receipts break the immutable verification tree.");
    }
    const commandsPassed = [typecheck, fixtureTest].every(
      (command) => command.exitCode === 0 && !command.timedOut,
    );
    const corpusReceipt = receiptsByAttempt.get(attempt);
    if (
      commandsPassed !== (corpusReceipt !== undefined) ||
      (corpusReceipt !== undefined &&
        corpusReceipt.fixtureTreeSha256 !== fixtureTest.fixtureTreeAfterSha256)
    ) {
      throw new Error("External worker command and corpus receipts disagree.");
    }
  }
  const finalReceipt = report.policyVerificationAttempts.at(-1);
  if (
    finalReceipt === undefined ||
    finalReceipt.attempt !== report.attempts ||
    finalReceipt.status !== "PASS" ||
    finalReceipt.passed !== request.input.acceptedCases.length ||
    finalReceipt.results.some(
      (result) =>
        result.status !== "PASS" ||
        result.actualDecision === null ||
        result.actualDecision !== result.expectedDecision,
    ) ||
    report.policyVerificationAttempts.slice(0, -1).some((receipt) => receipt.status !== "FAIL")
  ) {
    throw new Error("External worker report does not end in an exact full-corpus PASS.");
  }
  if (finalReceipt.fixtureTreeSha256 === request.policy.baselineExecutionTreeSha256) {
    throw new Error("External worker final execution tree did not change from the bound baseline.");
  }
  return finalReceipt.fixtureTreeSha256;
}

function verifyExecutionTreeDelta(
  baseline: WorkerRpcExecutionTreeManifest,
  final: WorkerRpcExecutionTreeManifest,
): void {
  if (baseline.entries.length !== final.entries.length) {
    throw new Error("External worker final execution tree changed the fixture path set.");
  }
  const changed = new Set<string>();
  const contentChanged = new Set<string>();
  for (let index = 0; index < baseline.entries.length; index += 1) {
    const before = baseline.entries[index];
    const after = final.entries[index];
    if (
      before === undefined ||
      after === undefined ||
      before.path !== after.path ||
      before.kind !== after.kind ||
      before.mode !== after.mode
    ) {
      throw new Error("External worker final execution tree changed fixture structure or modes.");
    }
    if (before.mtimeMs !== after.mtimeMs || before.sha256 !== after.sha256) {
      changed.add(before.path);
    }
    if (before.sha256 !== after.sha256) contentChanged.add(before.path);
  }
  if (
    changed.size !== 2 ||
    !changed.has("src/refund.ts") ||
    !changed.has("tests/refund.test.mjs") ||
    contentChanged.size !== 2 ||
    !contentChanged.has("src/refund.ts") ||
    !contentChanged.has("tests/refund.test.mjs")
  ) {
    throw new Error("External worker execution-tree delta exceeds the fixed two-file write set.");
  }
}

function verifyResponseBindings(
  response: WorkerRpcResponse,
  request: WorkerRpcRequest,
  requestSha256: string,
  options: ExternalWorkerRpcClientOptions,
): void {
  if (
    response.requestId !== request.requestId ||
    response.runNonce !== request.runNonce ||
    response.requestSha256 !== requestSha256 ||
    response.receipt.workerImageDigest !== request.policy.workerImageDigest ||
    response.receipt.workerPolicySha256 !== request.policySha256 ||
    response.receipt.fixtureId !== request.policy.fixtureId ||
    response.receipt.baselineContentSha256 !== request.policy.baselineContentSha256 ||
    response.receipt.baselineExecutionTreeSha256 !==
      request.policy.baselineExecutionTreeSha256 ||
    response.receipt.acceptedCorpusSha256 !== request.policy.acceptedCorpusSha256 ||
    response.receipt.supervisorId !== options.expectedSupervisorId
  ) {
    throw new Error("External worker response is not bound to the exact request and policy.");
  }
  const completedAt = Date.parse(response.completedAt);
  if (
    completedAt < Date.parse(request.issuedAt) ||
    completedAt > Date.parse(request.expiresAt) ||
    completedAt > (options.now ?? (() => new Date()))().getTime() + 5_000
  ) {
    throw new Error("External worker completion timestamp is outside the request window.");
  }
}

function verifyV2ResponseBindings(
  response: WorkerRpcV2Response,
  request: WorkerRpcV2Request,
  requestSha256: string,
  options: ExternalWorkerRpcV2ClientOptions,
): void {
  if (
    response.requestId !== request.requestId ||
    response.runNonce !== request.runNonce ||
    response.requestSha256 !== requestSha256 ||
    response.executionBindingSha256 !== request.executionBindingSha256 ||
    response.receipt.executionBindingSha256 !== request.executionBindingSha256 ||
    response.receipt.workerImageDigest !== request.policy.workerImageDigest ||
    response.receipt.workerPolicySha256 !== request.policySha256 ||
    response.receipt.fixtureId !== request.policy.fixtureId ||
    response.receipt.baselineContentSha256 !== request.policy.baselineContentSha256 ||
    response.receipt.baselineExecutionTreeSha256 !==
      request.policy.baselineExecutionTreeSha256 ||
    response.receipt.acceptedCorpusSha256 !== request.policy.acceptedCorpusSha256 ||
    response.receipt.supervisorId !== options.expectedSupervisorId
  ) {
    throw new Error("External worker v2 response is not bound to the exact request and policy.");
  }
  const completedAt = Date.parse(response.completedAt);
  if (
    completedAt < Date.parse(request.issuedAt) ||
    completedAt > Date.parse(request.expiresAt) ||
    completedAt > (options.now ?? (() => new Date()))().getTime() + 5_000
  ) {
    throw new Error("External worker v2 completion timestamp is outside the request window.");
  }
  if (
    response.status === "PASS" &&
    (response.receipt.cpuProof === null ||
      BigInt(response.receipt.cpuProof.budgetUsec) !==
        BigInt(request.policy.limits.cpuTimeMs) * 1_000n)
  ) {
    throw new Error("External worker v2 CPU proof is missing or not bound to the request budget.");
  }
}

export function createExternalWorkerRpcClient(options: ExternalWorkerRpcClientOptions): {
  runRepair(input: unknown): Promise<ValidatedExternalWorkerRun>;
} {
  safeIdentifier(options.transport.id, "external worker transport ID");
  if (
    options.transport.authenticationMode !== "MUTUAL_TLS" &&
    options.transport.authenticationMode !== "LOCAL_SOCKET_ACL"
  ) {
    throw new Error("External worker transport must provide mutual authentication.");
  }
  assertWorkerRpcTrustBundle(options.trustBundle);
  safeIdentifier(options.expectedSupervisorId, "external worker supervisor ID");
  safeIdentifier(options.expectedBackendId, "external worker backend ID");
  imageDigest(options.workerImageDigest);
  sha256(options.baselineContentSha256, "external worker baseline content digest");
  sha256(
    options.baselineExecutionTreeSha256,
    "external worker baseline execution tree digest",
  );
  const baselineExecutionTreeManifest = parseWorkerRpcExecutionTreeManifest(
    options.baselineExecutionTreeManifest,
  );
  if (
    workerRpcExecutionTreeSha256(baselineExecutionTreeManifest) !==
    options.baselineExecutionTreeSha256
  ) {
    throw new Error(
      "External worker baseline execution tree digest does not match the host manifest.",
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.model)) {
    throw new Error("External worker model must be an explicit safe identifier.");
  }
  integer(options.rpcTimeoutMs, "external worker RPC timeout", 1_000, 15 * 60_000);
  if (options.limits.wallTimeMs > options.rpcTimeoutMs) {
    throw new Error("External worker wall-time limit cannot exceed the RPC timeout.");
  }
  const random = options.randomBytes ?? secureRandomBytes;
  const usedRequestIds = new Set<string>();
  const usedNonces = new Set<string>();
  const usedSupervisorRuns = new Set<string>();
  let active = false;

  return {
    async runRepair(inputValue: unknown): Promise<ValidatedExternalWorkerRun> {
      if (active) throw new Error("External worker RPC client permits only one active run.");
      active = true;
      try {
        const input = parseRepairWorkerInput(inputValue);
        const requestId = randomToken(16, random, "hex");
        const runNonce = randomToken(32, random, "base64url");
        if (usedRequestIds.has(requestId) || usedNonces.has(runNonce)) {
          throw new Error("External worker random source attempted to reuse a request capability.");
        }
        usedRequestIds.add(requestId);
        usedNonces.add(runNonce);
        const issued = (options.now ?? (() => new Date()))();
        if (!Number.isFinite(issued.getTime())) {
          throw new Error("External worker clock returned an invalid time.");
        }
        const policy = buildPolicy(options, input);
        const request = parseWorkerRpcRequest({
          schemaVersion: "1",
          protocol: WORKER_RPC_PROTOCOL,
          action: WORKER_RPC_REQUEST_ACTION,
          requestId,
          runNonce,
          sequence: 1,
          issuedAt: issued.toISOString(),
          expiresAt: new Date(issued.getTime() + options.rpcTimeoutMs).toISOString(),
          model: options.model,
          modelReasoningEffort: "high",
          inputSha256: workerRpcSha256(input),
          policySha256: workerRpcSha256(policy),
          policy,
          input,
        });
        const canonicalRequest = canonicalWorkerRpcJson(request);
        const requestSha256 = workerRpcSha256(request);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.rpcTimeoutMs);
        let rawResponse: Uint8Array;
        try {
          const aborted = new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("External worker RPC timed out.")),
              { once: true },
            );
          });
          const responseStream = await Promise.race([
            options.transport.call(canonicalRequest, {
              signal: controller.signal,
              maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
              maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
              maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
            }),
            aborted,
          ]);
          rawResponse = await readBoundedResponse(responseStream, controller.signal);
        } catch (error) {
          throw new Error(`External worker transport failed: ${safeDiagnostic(error)}`);
        } finally {
          clearTimeout(timeout);
        }
        const response = parseCanonicalResponse(decodeResponse(rawResponse));
        verifyResponseBindings(response, request, requestSha256, options);
        verifyReceiptSignature(response, options.trustBundle);
        if (usedSupervisorRuns.has(response.receipt.supervisorRunId)) {
          throw new Error("External worker supervisor run identity was replayed.");
        }
        usedSupervisorRuns.add(response.receipt.supervisorRunId);
        if (response.status === "FAIL" || response.report === null) {
          throw new Error(`External worker rejected the repair: ${response.error ?? "unknown"}`);
        }
        verifyPhaseMetadata(response.report, request, options.expectedBackendId);
        const finalExecutionTreeSha256 = verifyReportHistory(response.report, request);
        if (response.receipt.finalExecutionTreeSha256 !== finalExecutionTreeSha256) {
          throw new Error(
            "External worker final execution tree is not bound to the signed receipt.",
          );
        }
        verifyExecutionTreeDelta(
          request.policy.baselineExecutionTreeManifest,
          response.receipt.finalExecutionTreeManifest,
        );
        return {
          requestId,
          runNonce,
          requestSha256,
          completedAt: response.completedAt,
          report: response.report,
          receipt: response.receipt,
        };
      } finally {
        active = false;
      }
    },
  };
}

export function createExternalWorkerRpcV2Client(options: ExternalWorkerRpcV2ClientOptions): {
  runRepair(input: unknown): Promise<ValidatedExternalWorkerV2Run>;
} {
  safeIdentifier(options.transport.id, "external worker v2 transport ID");
  if (options.transport.authenticationMode !== "MUTUAL_TLS") {
    throw new Error("External worker v2 transport must use mutual TLS.");
  }
  safeIdentifier(options.expectedSupervisorId, "external worker v2 supervisor ID");
  safeIdentifier(options.expectedBackendId, "external worker v2 backend ID");
  assertWorkerRpcTrustBundle(options.trustBundle);
  imageDigest(options.workerImageDigest);
  sha256(options.baselineContentSha256, "external worker v2 baseline content digest");
  sha256(
    options.baselineExecutionTreeSha256,
    "external worker v2 baseline execution tree digest",
  );
  const baselineExecutionTreeManifest = parseWorkerRpcExecutionTreeManifest(
    options.baselineExecutionTreeManifest,
  );
  if (
    workerRpcExecutionTreeSha256(baselineExecutionTreeManifest) !==
    options.baselineExecutionTreeSha256
  ) {
    throw new Error(
      "External worker v2 baseline execution tree digest does not match the host manifest.",
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.model)) {
    throw new Error("External worker v2 model must be an explicit safe identifier.");
  }
  integer(options.rpcTimeoutMs, "external worker v2 RPC timeout", 1_000, 15 * 60_000);
  if (options.limits.wallTimeMs > options.rpcTimeoutMs) {
    throw new Error("External worker v2 wall-time limit cannot exceed the RPC timeout.");
  }
  const random = options.randomBytes ?? secureRandomBytes;
  const usedRequestIds = new Set<string>();
  const usedNonces = new Set<string>();
  const usedSupervisorRuns = new Set<string>();
  const usedDockerBindings = new Set<string>();
  let active = false;

  return {
    async runRepair(inputValue: unknown): Promise<ValidatedExternalWorkerV2Run> {
      if (active) throw new Error("External worker v2 client permits only one active run.");
      active = true;
      try {
        const input = parseRepairWorkerInput(inputValue);
        const requestId = randomToken(16, random, "hex");
        const runNonce = randomToken(32, random, "base64url");
        if (usedRequestIds.has(requestId) || usedNonces.has(runNonce)) {
          throw new Error("External worker v2 random source reused a request capability.");
        }
        usedRequestIds.add(requestId);
        usedNonces.add(runNonce);
        const issued = (options.now ?? (() => new Date()))();
        if (!Number.isFinite(issued.getTime())) {
          throw new Error("External worker v2 clock returned an invalid time.");
        }
        const policy = buildPolicy(options, input);
        const inputSha256 = workerRpcSha256(input);
        const policySha256 = workerRpcSha256(policy);
        const executionBindingSha256 = workerRpcV2ExecutionBindingSha256({
          requestId,
          runNonce,
          model: options.model,
          inputSha256,
          policySha256,
        });
        const request = parseWorkerRpcV2Request({
          schemaVersion: "2",
          protocol: WORKER_RPC_V2_PROTOCOL,
          action: WORKER_RPC_REQUEST_ACTION,
          requestId,
          runNonce,
          sequence: 1,
          issuedAt: issued.toISOString(),
          expiresAt: new Date(issued.getTime() + options.rpcTimeoutMs).toISOString(),
          model: options.model,
          modelReasoningEffort: "high",
          inputSha256,
          policySha256,
          executionBindingSha256,
          policy,
          input,
        });
        const canonicalRequest = canonicalWorkerRpcJson(request);
        const requestSha256 = workerRpcSha256(request);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.rpcTimeoutMs);
        let rawResponse: Uint8Array;
        try {
          const aborted = new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("External worker v2 RPC timed out.")),
              { once: true },
            );
          });
          const responseStream = await Promise.race([
            options.transport.call(canonicalRequest, {
              signal: controller.signal,
              maxResponseBytes: WORKER_RPC_MAX_RESPONSE_BYTES,
              maxChunkBytes: WORKER_RPC_MAX_RESPONSE_CHUNK_BYTES,
              maxChunks: WORKER_RPC_MAX_RESPONSE_CHUNKS,
            }),
            aborted,
          ]);
          rawResponse = await readBoundedResponse(responseStream, controller.signal);
        } catch (error) {
          throw new Error(`External worker v2 transport failed: ${safeDiagnostic(error)}`);
        } finally {
          clearTimeout(timeout);
        }
        const response = parseCanonicalV2Response(decodeResponse(rawResponse));
        verifyV2ReceiptSignature(response, options);
        verifyV2ResponseBindings(response, request, requestSha256, options);
        if (usedSupervisorRuns.has(response.receipt.supervisorRunId)) {
          throw new Error("External worker v2 supervisor run identity was replayed.");
        }
        if (usedDockerBindings.has(response.receipt.dockerBindingSha256)) {
          throw new Error("External worker v2 Docker execution binding was replayed.");
        }
        usedSupervisorRuns.add(response.receipt.supervisorRunId);
        usedDockerBindings.add(response.receipt.dockerBindingSha256);
        if (
          response.status === "FAIL" ||
          response.report === null ||
          response.receipt.cpuProof === null
        ) {
          throw new Error(`External worker v2 rejected the repair: ${response.error ?? "unknown"}`);
        }
        verifyPhaseMetadata(response.report, request, options.expectedBackendId);
        const finalExecutionTreeSha256 = verifyReportHistory(response.report, request);
        if (response.receipt.finalExecutionTreeSha256 !== finalExecutionTreeSha256) {
          throw new Error(
            "External worker v2 final execution tree is not bound to the signed receipt.",
          );
        }
        verifyExecutionTreeDelta(
          request.policy.baselineExecutionTreeManifest,
          response.receipt.finalExecutionTreeManifest,
        );
        return {
          requestId,
          runNonce,
          requestSha256,
          executionBindingSha256,
          completedAt: response.completedAt,
          report: response.report,
          receipt: {
            ...response.receipt,
            cpuProof: response.receipt.cpuProof,
          },
        };
      } finally {
        active = false;
      }
    },
  };
}
