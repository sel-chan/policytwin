import {
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
  acceptedCorpusSha256,
  assertNoWorkerRpcHostPath,
  canonicalWorkerRpcJson,
  parseWorkerRpcExecutionTreeManifest,
  parseWorkerRpcRequest,
  parseWorkerRpcResponse,
  workerRpcExecutionTreeSha256,
  workerRpcSha256,
  workerRpcSignaturePayload,
  type WorkerRpcPolicy,
  type WorkerRpcExecutionTreeManifest,
  type WorkerRpcRequest,
  type WorkerRpcResourceLimits,
  type WorkerRpcResponse,
  type WorkerRpcSupervisorReceipt,
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

export interface ExternalWorkerRpcClientOptions {
  transport: ExternalWorkerRpcTransport;
  trustedWorkerPublicKeys: Readonly<Record<string, string>>;
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

export interface ValidatedExternalWorkerRun {
  requestId: string;
  runNonce: string;
  requestSha256: string;
  completedAt: string;
  report: RepairWorkerReport;
  receipt: WorkerRpcSupervisorReceipt;
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
  options: ExternalWorkerRpcClientOptions,
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

function verifyReceiptSignature(
  response: WorkerRpcResponse,
  trustedWorkerPublicKeys: Readonly<Record<string, string>>,
): void {
  const trusted = Object.hasOwn(trustedWorkerPublicKeys, response.receipt.keyId)
    ? trustedWorkerPublicKeys[response.receipt.keyId]
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

function verifyPhaseMetadata(
  report: RepairWorkerReport,
  request: WorkerRpcRequest,
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

function verifyReportHistory(report: RepairWorkerReport, request: WorkerRpcRequest): string {
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
        verifyReceiptSignature(response, options.trustedWorkerPublicKeys);
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
