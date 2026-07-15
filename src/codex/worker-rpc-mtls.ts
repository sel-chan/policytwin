import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signPayload,
} from "node:crypto";
import { isIP, type Socket } from "node:net";
import {
  createServer as createTlsServer,
  type Server as TlsServer,
  type TLSSocket,
} from "node:tls";
import { TextDecoder } from "node:util";
import {
  WORKER_RPC_MAX_REQUEST_BYTES,
  WORKER_RPC_MAX_RESPONSE_BYTES,
  canonicalWorkerRpcJson,
  parseWorkerRpcRequest,
  parseWorkerRpcResponse,
  parseWorkerRpcV2Request,
  parseWorkerRpcV2Response,
  workerRpcSha256,
  workerRpcSignaturePayload,
  workerRpcV2SignaturePayload,
  type WorkerRpcRequest,
  type WorkerRpcResponse,
  type WorkerRpcSupervisorReceipt,
  type WorkerRpcV2Request,
  type WorkerRpcV2Response,
  type WorkerRpcV2SupervisorReceipt,
} from "./worker-rpc-contract.js";
import { assertWorkerRpcTrustBundleSigner } from "./worker-rpc-client.js";
import type { WorkerRpcTrustBundle } from "./worker-rpc-client.js";
import {
  WORKER_RPC_MTLS_ALPN,
  WORKER_RPC_MTLS_HEADER_BYTES,
  WORKER_RPC_MTLS_REQUEST_MAGIC,
  WORKER_RPC_MTLS_RESPONSE_MAGIC,
  WORKER_RPC_V2_MTLS_ALPN,
  WORKER_RPC_V2_MTLS_REQUEST_MAGIC,
  WORKER_RPC_V2_MTLS_RESPONSE_MAGIC,
} from "./worker-rpc-mtls-transport.js";
import type { RepairWorkerReport } from "./types.js";

export {
  WORKER_RPC_MTLS_ALPN,
  WORKER_RPC_MTLS_HEADER_BYTES,
  WORKER_RPC_MTLS_REQUEST_MAGIC,
  WORKER_RPC_MTLS_RESPONSE_MAGIC,
  WORKER_RPC_V2_MTLS_ALPN,
  WORKER_RPC_V2_MTLS_REQUEST_MAGIC,
  WORKER_RPC_V2_MTLS_RESPONSE_MAGIC,
  createMutualTlsWorkerRpcTransport,
  createMutualTlsWorkerRpcV2Transport,
  type MutualTlsWorkerRpcTransportOptions,
} from "./worker-rpc-mtls-transport.js";

const TLS_RECORD_CHUNK_BYTES = 64 * 1024;
const EMPTY_SIGNATURE = Buffer.alloc(64).toString("base64url");
const POLICYTWIN_SIGNERS = new WeakSet<object>();

type TlsCa = string | Buffer | Array<string | Buffer>;
type TlsCertificate = string | Buffer;

interface MutualTlsMaterial {
  ca: TlsCa;
  cert: TlsCertificate;
  key: TlsCertificate;
  keyPassphrase?: string;
}

export interface WorkerRpcReplayCapability {
  requestId: string;
  runNonce: string;
  expiresAt: string;
}

export interface WorkerRpcReplayStore {
  readonly durability: "EPHEMERAL" | "DURABLE_SQLITE";
  consume(capability: WorkerRpcReplayCapability, now: Date): Promise<boolean>;
}

export interface EphemeralWorkerRpcReplayStoreOptions {
  capacity?: number;
}

type SupervisorReceiptBody = Omit<
  WorkerRpcSupervisorReceipt,
  "schemaVersion" | "algorithm" | "keyId" | "supervisorId" | "signature"
>;

export interface WorkerRpcSupervisorExecutionResult {
  status: "PASS" | "FAIL";
  report: RepairWorkerReport | null;
  error: string | null;
  receipt: SupervisorReceiptBody;
}

type V2SupervisorReceiptBody = Omit<
  WorkerRpcV2SupervisorReceipt,
  "schemaVersion" | "algorithm" | "keyId" | "supervisorId" | "signature"
>;

export interface WorkerRpcV2SupervisorExecutionResult {
  status: "PASS" | "FAIL";
  report: RepairWorkerReport | null;
  error: string | null;
  receipt: V2SupervisorReceiptBody;
}

export interface WorkerRpcSupervisorExecutor {
  execute(
    request: WorkerRpcRequest,
    context: { signal: AbortSignal; peerCertificateSha256: string },
  ): Promise<WorkerRpcSupervisorExecutionResult>;
}

export interface WorkerRpcV2SupervisorExecutor {
  execute(
    request: WorkerRpcV2Request,
    context: { signal: AbortSignal; peerCertificateSha256: string },
  ): Promise<WorkerRpcV2SupervisorExecutionResult>;
}

export interface WorkerRpcSupervisorSigner {
  readonly keyId: string;
  readonly supervisorId: string;
  readonly purpose: "GENERAL_WORKER_RPC_V1" | "LIVE_LINUX_CGROUP_RPC_V2";
  readonly publicKeySpkiSha256: string;
  sign(payload: string): Promise<Uint8Array>;
}

export interface Ed25519WorkerRpcSignerOptions {
  keyId: string;
  supervisorId: string;
  purpose: WorkerRpcSupervisorSigner["purpose"];
  privateKey: string | Buffer;
  passphrase?: string;
}

export type WorkerRpcSupervisorAuditEvent =
  | "TLS_CLIENT_REJECTED"
  | "TLS_CLIENT_AUTHENTICATED"
  | "REQUEST_REJECTED"
  | "REQUEST_ACCEPTED"
  | "EXECUTION_ABORTED"
  | "RESPONSE_SENT";

export interface MutualTlsWorkerRpcSupervisorOptions extends MutualTlsMaterial {
  host: string;
  port: number;
  expectedClientCertificateSha256: string;
  replayStore: WorkerRpcReplayStore;
  executor: WorkerRpcSupervisorExecutor;
  signer: WorkerRpcSupervisorSigner;
  trustBundle: WorkerRpcTrustBundle;
  handshakeTimeoutMs?: number;
  requestReadTimeoutMs?: number;
  clockSkewMs?: number;
  maxConnections?: number;
  executorShutdownTimeoutMs?: number;
  now?: () => Date;
  onAuditEvent?: (event: {
    type: WorkerRpcSupervisorAuditEvent;
    at: string;
  }) => void;
}

export interface MutualTlsWorkerRpcV2SupervisorOptions extends MutualTlsMaterial {
  host: string;
  port: number;
  expectedClientCertificateSha256: string;
  replayStore: WorkerRpcReplayStore;
  executor: WorkerRpcV2SupervisorExecutor;
  signer: WorkerRpcSupervisorSigner;
  trustBundle: WorkerRpcTrustBundle;
  handshakeTimeoutMs?: number;
  requestReadTimeoutMs?: number;
  clockSkewMs?: number;
  maxConnections?: number;
  executorShutdownTimeoutMs?: number;
  now?: () => Date;
  onAuditEvent?: (event: {
    type: WorkerRpcSupervisorAuditEvent;
    at: string;
  }) => void;
}

export interface MutualTlsWorkerRpcSupervisor {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  readonly activeRepairCount: number;
  readonly openConnectionCount: number;
}

function safeIdentifier(value: string, label: string): string {
  if (value.length < 3 || value.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function safeHost(value: string, label: string): string {
  if (
    value.length < 1 ||
    value.length > 253 ||
    value.includes("\0") ||
    /[\s/\\:@]/u.test(value) && isIP(value) === 0
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function tlsMaterial(value: TlsCa | TlsCertificate, label: string): void {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    values.some(
      (item) =>
        !(typeof item === "string" || Buffer.isBuffer(item)) ||
        (typeof item === "string" ? item.trim().length === 0 : item.byteLength === 0),
    )
  ) {
    throw new Error(`${label} must contain non-empty in-memory TLS material.`);
  }
}

function fingerprintSha256(value: string, label: string): string {
  const normalized = value.replaceAll(":", "").toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 certificate fingerprint.`);
  }
  return normalized;
}

function peerFingerprint(socket: TLSSocket, label: string): string {
  const certificate = socket.getPeerX509Certificate();
  if (certificate === undefined) {
    throw new Error(`${label} did not present an X.509 certificate.`);
  }
  return fingerprintSha256(certificate.fingerprint256, `${label} fingerprint`);
}

function assertTlsProtocol(socket: TLSSocket, label: string, expectedAlpn: string): void {
  if (
    socket.authorized !== true ||
    socket.getProtocol() !== "TLSv1.3" ||
    socket.alpnProtocol !== expectedAlpn
  ) {
    throw new Error(`${label} did not satisfy the required TLS 1.3 mutual-authentication profile.`);
  }
}

function abortError(): Error {
  return new Error("External worker TLS operation was aborted.");
}

function nextSocketChunk(
  iterator: AsyncIterator<unknown>,
  signal: AbortSignal,
): Promise<IteratorResult<unknown>> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error("External worker TLS socket read failed."));
      },
    );
  });
}

class BoundedSocketReader {
  readonly iterator: AsyncIterator<unknown>;
  private pending = Buffer.alloc(0);

  constructor(socket: TLSSocket) {
    this.iterator = socket[Symbol.asyncIterator]();
  }

  get pendingBytes(): number {
    return this.pending.byteLength;
  }

  async readExactly(length: number, signal: AbortSignal): Promise<Buffer> {
    integer(length, "TLS frame read length", 1, WORKER_RPC_MAX_RESPONSE_BYTES);
    const pieces: Buffer[] = [];
    let total = 0;
    while (total < length) {
      if (this.pending.byteLength === 0) {
        const next = await nextSocketChunk(this.iterator, signal);
        if (next.done) {
          throw new Error("External worker TLS frame ended before its declared length.");
        }
        if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0) {
          throw new Error("External worker TLS socket produced an invalid byte chunk.");
        }
        this.pending = Buffer.from(next.value);
      }
      const needed = length - total;
      const take = Math.min(needed, this.pending.byteLength);
      pieces.push(this.pending.subarray(0, take));
      this.pending = this.pending.subarray(take);
      total += take;
    }
    return pieces.length === 1 ? Buffer.from(pieces[0]!) : Buffer.concat(pieces, length);
  }

  async expectEnd(signal: AbortSignal): Promise<void> {
    if (this.pending.byteLength !== 0) {
      throw new Error("External worker TLS response contains trailing bytes.");
    }
    const next = await nextSocketChunk(this.iterator, signal);
    if (!next.done) {
      throw new Error("External worker TLS response contains more than one frame.");
    }
  }

  async waitForInputOrEnd(signal: AbortSignal): Promise<"INPUT" | "END"> {
    if (this.pending.byteLength !== 0) return "INPUT";
    const next = await nextSocketChunk(this.iterator, signal);
    return next.done ? "END" : "INPUT";
  }
}

function encodeFrameHeader(magic: string, length: number, maximum: number): Buffer {
  if (!/^[A-Z0-9]{4}$/u.test(magic)) {
    throw new Error("External worker TLS frame magic is invalid.");
  }
  integer(length, "TLS frame byte length", 1, maximum);
  const header = Buffer.alloc(WORKER_RPC_MTLS_HEADER_BYTES);
  header.write(magic, 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return header;
}

function parseFrameHeader(
  header: Uint8Array,
  expectedMagic: string,
  maximum: number,
): number {
  if (header.byteLength !== WORKER_RPC_MTLS_HEADER_BYTES) {
    throw new Error("External worker TLS frame header has an invalid length.");
  }
  const bytes = Buffer.from(header);
  if (bytes.toString("ascii", 0, 4) !== expectedMagic) {
    throw new Error("External worker TLS frame magic is invalid.");
  }
  return integer(bytes.readUInt32BE(4), "TLS frame byte length", 1, maximum);
}

function waitForDrain(socket: TLSSocket, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeListener("drain", onDrain);
      socket.removeListener("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("External worker TLS socket closed during write."));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    socket.once("drain", onDrain);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function writeBytes(
  socket: TLSSocket,
  value: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  for (let offset = 0; offset < value.byteLength; offset += TLS_RECORD_CHUNK_BYTES) {
    if (signal.aborted || socket.destroyed) throw abortError();
    const end = Math.min(offset + TLS_RECORD_CHUNK_BYTES, value.byteLength);
    if (!socket.write(value.subarray(offset, end))) {
      await waitForDrain(socket, signal);
    }
  }
}

async function writeFrame(
  socket: TLSSocket,
  magic: string,
  payload: Uint8Array,
  maximum: number,
  signal: AbortSignal,
): Promise<void> {
  await writeBytes(socket, encodeFrameHeader(magic, payload.byteLength, maximum), signal);
  await writeBytes(socket, payload, signal);
}

function decodeCanonicalRequest(value: Uint8Array): {
  text: string;
  request: WorkerRpcRequest;
} {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error("External worker TLS request is not valid UTF-8.");
  }
  if (!Buffer.from(text, "utf8").equals(value) || text.includes("\0")) {
    throw new Error("External worker TLS request is not canonical NUL-free UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("External worker TLS request is not JSON.");
  }
  const request = parseWorkerRpcRequest(parsed);
  if (canonicalWorkerRpcJson(request) !== text) {
    throw new Error("External worker TLS request must use canonical JSON.");
  }
  return { text, request };
}

function decodeCanonicalV2Request(value: Uint8Array): {
  text: string;
  request: WorkerRpcV2Request;
} {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error("External worker TLS v2 request is not valid UTF-8.");
  }
  if (!Buffer.from(text, "utf8").equals(value) || text.includes("\0")) {
    throw new Error("External worker TLS v2 request is not canonical NUL-free UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("External worker TLS v2 request is not JSON.");
  }
  const request = parseWorkerRpcV2Request(parsed);
  if (canonicalWorkerRpcJson(request) !== text) {
    throw new Error("External worker TLS v2 request must use canonical JSON.");
  }
  return { text, request };
}

interface WorkerRpcMtlsProfile {
  alpn: string;
  requestMagic: string;
  responseMagic: string;
}

const V1_MTLS_PROFILE: WorkerRpcMtlsProfile = {
  alpn: WORKER_RPC_MTLS_ALPN,
  requestMagic: WORKER_RPC_MTLS_REQUEST_MAGIC,
  responseMagic: WORKER_RPC_MTLS_RESPONSE_MAGIC,
};

const V2_MTLS_PROFILE: WorkerRpcMtlsProfile = {
  alpn: WORKER_RPC_V2_MTLS_ALPN,
  requestMagic: WORKER_RPC_V2_MTLS_REQUEST_MAGIC,
  responseMagic: WORKER_RPC_V2_MTLS_RESPONSE_MAGIC,
};

export function createEphemeralWorkerRpcReplayStore(
  options: EphemeralWorkerRpcReplayStoreOptions = {},
): WorkerRpcReplayStore {
  const capacity = integer(
    options.capacity ?? 1_024,
    "Ephemeral worker replay-store capacity",
    1,
    100_000,
  );
  const capabilities = new Map<string, { runNonce: string; expiresAt: number }>();
  const nonceOwners = new Map<string, string>();
  return {
    durability: "EPHEMERAL",
    async consume(capability, now): Promise<boolean> {
      if (!Number.isFinite(now.getTime())) {
        throw new Error("Worker replay-store clock is invalid.");
      }
      for (const [requestId, record] of capabilities) {
        if (record.expiresAt <= now.getTime()) {
          capabilities.delete(requestId);
          nonceOwners.delete(record.runNonce);
        }
      }
      const expiry = Date.parse(capability.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= now.getTime()) return false;
      if (
        capabilities.has(capability.requestId) ||
        nonceOwners.has(capability.runNonce) ||
        capabilities.size >= capacity
      ) {
        return false;
      }
      capabilities.set(capability.requestId, {
        runNonce: capability.runNonce,
        expiresAt: expiry,
      });
      nonceOwners.set(capability.runNonce, capability.requestId);
      return true;
    },
  };
}

export function createEd25519WorkerRpcSigner(
  options: Ed25519WorkerRpcSignerOptions,
): WorkerRpcSupervisorSigner {
  const keyId = safeIdentifier(options.keyId, "Worker supervisor signing key ID");
  const supervisorId = safeIdentifier(options.supervisorId, "Worker supervisor ID");
  const privateKey = createPrivateKey({
    key: options.privateKey,
    format: "pem",
    passphrase: options.passphrase,
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Worker supervisor signing key must be Ed25519.");
  }
  const publicKeySpkiSha256 = createHash("sha256")
    .update(
      createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" })).export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("hex");
  const signer = {
    keyId,
    supervisorId,
    purpose: options.purpose,
    publicKeySpkiSha256,
    async sign(payload: string): Promise<Uint8Array> {
      return signPayload(null, Buffer.from(payload, "utf8"), privateKey);
    },
  } satisfies WorkerRpcSupervisorSigner;
  POLICYTWIN_SIGNERS.add(signer);
  return Object.freeze(signer);
}

function assertPolicyTwinSigner(value: WorkerRpcSupervisorSigner): void {
  if (!POLICYTWIN_SIGNERS.has(value)) {
    throw new Error("Worker TLS supervisor requires a PolicyTwin-created Ed25519 signer.");
  }
}

function assertExactReceiptBodyKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

function validateRequestWindow(
  request: WorkerRpcRequest | WorkerRpcV2Request,
  now: Date,
  clockSkewMs: number,
): void {
  const current = now.getTime();
  if (
    !Number.isFinite(current) ||
    Date.parse(request.issuedAt) > current + clockSkewMs ||
    Date.parse(request.expiresAt) < current
  ) {
    throw new Error("Worker RPC request is outside its validity window.");
  }
}

function validateExecutionReceiptBindings(
  result: WorkerRpcSupervisorExecutionResult,
  request: WorkerRpcRequest,
): void {
  if (
    result.receipt.workerImageDigest !== request.policy.workerImageDigest ||
    result.receipt.workerPolicySha256 !== request.policySha256 ||
    result.receipt.fixtureId !== request.policy.fixtureId ||
    result.receipt.baselineContentSha256 !== request.policy.baselineContentSha256 ||
    result.receipt.baselineExecutionTreeSha256 !==
      request.policy.baselineExecutionTreeSha256 ||
    result.receipt.acceptedCorpusSha256 !== request.policy.acceptedCorpusSha256
  ) {
    throw new Error("Worker supervisor execution receipt is not bound to its request.");
  }
}

async function buildSignedResponse(
  request: WorkerRpcRequest,
  result: WorkerRpcSupervisorExecutionResult,
  signer: WorkerRpcSupervisorSigner,
  now: Date,
): Promise<WorkerRpcResponse> {
  assertExactReceiptBodyKeys(
    result.receipt,
    [
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
    ],
    "Worker supervisor execution receipt",
  );
  if (
    (result.status === "PASS" && (result.report === null || result.error !== null)) ||
    (result.status === "FAIL" &&
      (result.report !== null || typeof result.error !== "string" || result.error.length === 0))
  ) {
    throw new Error("Worker supervisor execution result status is inconsistent.");
  }
  validateExecutionReceiptBindings(result, request);
  const completedAt = now.toISOString();
  if (
    Date.parse(completedAt) < Date.parse(request.issuedAt) ||
    Date.parse(completedAt) > Date.parse(request.expiresAt)
  ) {
    throw new Error("Worker supervisor completion is outside the request window.");
  }
  const responseWithPlaceholder = parseWorkerRpcResponse({
    schemaVersion: "1",
    protocol: request.protocol,
    action: "RUN_REPAIR_RESULT",
    requestId: request.requestId,
    runNonce: request.runNonce,
    sequence: 1,
    requestSha256: workerRpcSha256(request),
    status: result.status,
    completedAt,
    resultSha256: workerRpcSha256(result.report ?? { error: result.error }),
    report: result.report,
    error: result.error,
    receipt: {
      schemaVersion: "1",
      algorithm: "Ed25519",
      ...result.receipt,
      keyId: signer.keyId,
      supervisorId: signer.supervisorId,
      signature: EMPTY_SIGNATURE,
    },
  });
  const signature = await signer.sign(workerRpcSignaturePayload(responseWithPlaceholder));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new Error("Worker supervisor signer returned an invalid Ed25519 signature.");
  }
  return parseWorkerRpcResponse({
    ...responseWithPlaceholder,
    receipt: {
      ...responseWithPlaceholder.receipt,
      signature: Buffer.from(signature).toString("base64url"),
    },
  });
}

function validateV2ExecutionReceiptBindings(
  result: WorkerRpcV2SupervisorExecutionResult,
  request: WorkerRpcV2Request,
): void {
  const expectedCpuBudgetUsec = BigInt(request.policy.limits.cpuTimeMs) * 1_000n;
  if (
    result.receipt.workerImageDigest !== request.policy.workerImageDigest ||
    result.receipt.workerPolicySha256 !== request.policySha256 ||
    result.receipt.fixtureId !== request.policy.fixtureId ||
    result.receipt.baselineContentSha256 !== request.policy.baselineContentSha256 ||
    result.receipt.baselineExecutionTreeSha256 !==
      request.policy.baselineExecutionTreeSha256 ||
    result.receipt.acceptedCorpusSha256 !== request.policy.acceptedCorpusSha256 ||
    result.receipt.executionBindingSha256 !== request.executionBindingSha256 ||
    (result.status === "PASS" && result.receipt.cpuProof === null) ||
    (result.receipt.cpuProof !== null &&
      BigInt(result.receipt.cpuProof.budgetUsec) !== expectedCpuBudgetUsec) ||
    (result.status === "FAIL" && result.receipt.cpuProof !== null)
  ) {
    throw new Error("Worker supervisor v2 execution receipt is not bound to its request.");
  }
}

async function buildSignedV2Response(
  request: WorkerRpcV2Request,
  result: WorkerRpcV2SupervisorExecutionResult,
  signer: WorkerRpcSupervisorSigner,
  now: Date,
): Promise<WorkerRpcV2Response> {
  if (
    !signer.keyId.startsWith("live-cpu-") ||
    signer.purpose !== "LIVE_LINUX_CGROUP_RPC_V2"
  ) {
    throw new Error("Worker supervisor v2 signer lacks the live CPU proof purpose.");
  }
  if (result.status !== "FAIL") {
    throw new Error(
      "Worker supervisor v2 PASS signing is disabled until the live Linux controller is wired.",
    );
  }
  assertExactReceiptBodyKeys(
    result.receipt,
    [
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
    ],
    "Worker supervisor v2 execution receipt",
  );
  if (result.report !== null || typeof result.error !== "string" || result.error.length === 0) {
    throw new Error("Worker supervisor v2 execution result status is inconsistent.");
  }
  validateV2ExecutionReceiptBindings(result, request);
  const completedAt = now.toISOString();
  if (
    Date.parse(completedAt) < Date.parse(request.issuedAt) ||
    Date.parse(completedAt) > Date.parse(request.expiresAt)
  ) {
    throw new Error("Worker supervisor v2 completion is outside the request window.");
  }
  const responseWithPlaceholder = parseWorkerRpcV2Response({
    schemaVersion: "2",
    protocol: request.protocol,
    action: "RUN_REPAIR_RESULT",
    requestId: request.requestId,
    runNonce: request.runNonce,
    sequence: 1,
    requestSha256: workerRpcSha256(request),
    executionBindingSha256: request.executionBindingSha256,
    status: result.status,
    completedAt,
    resultSha256: workerRpcSha256(result.report ?? { error: result.error }),
    report: result.report,
    error: result.error,
    receipt: {
      schemaVersion: "2",
      algorithm: "Ed25519",
      ...result.receipt,
      keyId: signer.keyId,
      supervisorId: signer.supervisorId,
      signature: EMPTY_SIGNATURE,
    },
  });
  const signature = await signer.sign(workerRpcV2SignaturePayload(responseWithPlaceholder));
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) {
    throw new Error("Worker supervisor v2 signer returned an invalid Ed25519 signature.");
  }
  return parseWorkerRpcV2Response({
    ...responseWithPlaceholder,
    receipt: {
      ...responseWithPlaceholder.receipt,
      signature: Buffer.from(signature).toString("base64url"),
    },
  });
}

function serverAddress(server: TlsServer, requestedHost: string): { host: string; port: number } {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Worker TLS supervisor did not bind an IP socket.");
  }
  return { host: requestedHost, port: address.port };
}

type GenericSupervisorOptions<
  Request extends WorkerRpcRequest | WorkerRpcV2Request,
  Result,
> = Omit<MutualTlsWorkerRpcSupervisorOptions, "executor"> & {
  executor: {
    execute(
      request: Request,
      context: { signal: AbortSignal; peerCertificateSha256: string },
    ): Promise<Result>;
  };
};

interface SupervisorProtocolProfile<
  Request extends WorkerRpcRequest | WorkerRpcV2Request,
  Result,
  Response,
> extends WorkerRpcMtlsProfile {
  decodeRequest(value: Uint8Array): { text: string; request: Request };
  buildSignedResponse(
    request: Request,
    result: Result,
    signer: WorkerRpcSupervisorSigner,
    now: Date,
  ): Promise<Response>;
}

function createMutualTlsWorkerRpcSupervisorForProfile<
  Request extends WorkerRpcRequest | WorkerRpcV2Request,
  Result,
  Response,
>(
  options: GenericSupervisorOptions<Request, Result>,
  profile: SupervisorProtocolProfile<Request, Result, Response>,
): MutualTlsWorkerRpcSupervisor {
  safeHost(options.host, "Worker TLS supervisor host");
  integer(options.port, "Worker TLS supervisor port", 0, 65_535);
  tlsMaterial(options.ca, "Worker TLS supervisor CA");
  tlsMaterial(options.cert, "Worker TLS supervisor certificate");
  tlsMaterial(options.key, "Worker TLS supervisor key");
  const expectedClientFingerprint = fingerprintSha256(
    options.expectedClientCertificateSha256,
    "Worker TLS client fingerprint",
  );
  const handshakeTimeoutMs = integer(
    options.handshakeTimeoutMs ?? 10_000,
    "Worker TLS supervisor handshake timeout",
    250,
    60_000,
  );
  const requestReadTimeoutMs = integer(
    options.requestReadTimeoutMs ?? 10_000,
    "Worker TLS supervisor request-read timeout",
    250,
    60_000,
  );
  const clockSkewMs = integer(
    options.clockSkewMs ?? 5_000,
    "Worker TLS supervisor clock skew",
    0,
    60_000,
  );
  const maxConnections = integer(
    options.maxConnections ?? 8,
    "Worker TLS supervisor connection limit",
    1,
    64,
  );
  const executorShutdownTimeoutMs = integer(
    options.executorShutdownTimeoutMs ?? 30_000,
    "Worker TLS supervisor executor shutdown timeout",
    250,
    60_000,
  );
  if (
    typeof options.replayStore?.consume !== "function" ||
    typeof options.executor?.execute !== "function" ||
    typeof options.signer?.sign !== "function"
  ) {
    throw new Error("Worker TLS supervisor dependencies are incomplete.");
  }
  safeIdentifier(options.signer.keyId, "Worker supervisor signing key ID");
  safeIdentifier(options.signer.supervisorId, "Worker supervisor ID");

  const rawConnections = new Set<Socket>();
  const sockets = new Set<TLSSocket>();
  const executionControllers = new Set<AbortController>();
  const executorSettlements = new Set<Promise<void>>();
  let activeRepair = false;
  let listening = false;
  let closed = false;
  let closing: Promise<void> | null = null;

  const audit = (type: WorkerRpcSupervisorAuditEvent) => {
    const now = (options.now ?? (() => new Date()))();
    if (!Number.isFinite(now.getTime())) return;
    try {
      options.onAuditEvent?.({ type, at: now.toISOString() });
    } catch {
      // Audit sinks cannot change the security decision.
    }
  };

  const server = createTlsServer({
    ca: options.ca,
    cert: options.cert,
    key: options.key,
    passphrase: options.keyPassphrase,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    ALPNProtocols: [profile.alpn],
    handshakeTimeout: handshakeTimeoutMs,
  });
  server.maxConnections = maxConnections;
  server.on("connection", (socket) => {
    rawConnections.add(socket);
    socket.once("close", () => rawConnections.delete(socket));
  });
  server.on("tlsClientError", () => audit("TLS_CLIENT_REJECTED"));
  server.on("error", () => undefined);

  server.on("secureConnection", (socket) => {
    void (async () => {
      sockets.add(socket);
      socket.on("error", () => undefined);
      socket.setNoDelay(true);
      let requestReadController: AbortController | null = new AbortController();
      const requestReadTimer = setTimeout(() => {
        requestReadController?.abort();
        socket.destroy();
      }, requestReadTimeoutMs);
      let ownsRepairSlot = false;
      let executorPromise: Promise<Result> | null = null;
      let executionController: AbortController | null = null;
      try {
        assertTlsProtocol(socket, "Worker RPC client", profile.alpn);
        const fingerprint = peerFingerprint(socket, "Worker RPC client");
        if (fingerprint !== expectedClientFingerprint) {
          throw new Error("Worker RPC client certificate pin does not match.");
        }
        audit("TLS_CLIENT_AUTHENTICATED");
        const reader = new BoundedSocketReader(socket);
        const header = await reader.readExactly(
          WORKER_RPC_MTLS_HEADER_BYTES,
          requestReadController.signal,
        );
        const declaredLength = parseFrameHeader(
          header,
          profile.requestMagic,
          WORKER_RPC_MAX_REQUEST_BYTES,
        );
        const requestBytes = await reader.readExactly(
          declaredLength,
          requestReadController.signal,
        );
        if (reader.pendingBytes !== 0) {
          throw new Error("Worker RPC TLS request contains trailing bytes.");
        }
        const { request } = profile.decodeRequest(requestBytes);
        clearTimeout(requestReadTimer);
        requestReadController = null;
        const now = (options.now ?? (() => new Date()))();
        validateRequestWindow(request, now, clockSkewMs);
        if (activeRepair) {
          throw new Error("Worker TLS supervisor permits only one active repair.");
        }
        activeRepair = true;
        ownsRepairSlot = true;
        const consumed = await options.replayStore.consume(
          {
            requestId: request.requestId,
            runNonce: request.runNonce,
            expiresAt: request.expiresAt,
          },
          now,
        );
        if (!consumed) throw new Error("Worker RPC request capability was replayed.");
        if (closed || socket.destroyed) {
          throw new Error("Worker TLS supervisor closed before execution started.");
        }
        validateRequestWindow(
          request,
          (options.now ?? (() => new Date()))(),
          clockSkewMs,
        );
        audit("REQUEST_ACCEPTED");

        executionController = new AbortController();
        executionControllers.add(executionController);
        const executionNow = (options.now ?? (() => new Date()))();
        const remainingValidity = Date.parse(request.expiresAt) - executionNow.getTime();
        const executionTimeoutMs = Math.max(
          1,
          Math.min(request.policy.limits.wallTimeMs, remainingValidity),
        );
        const executionTimer = setTimeout(() => {
          executionController?.abort(new Error("Worker RPC execution deadline expired."));
        }, executionTimeoutMs);
        let monitorInput = true;
        const connectionMonitor = reader
          .waitForInputOrEnd(executionController.signal)
          .then((state) => {
            if (!monitorInput) return new Promise<never>(() => undefined);
            executionController?.abort(
              new Error(
                state === "INPUT"
                  ? "Worker RPC client sent trailing bytes."
                  : "Worker RPC client disconnected before completion.",
              ),
            );
            socket.destroy();
            throw new Error("Worker RPC connection changed during execution.");
          });
        executorPromise = Promise.resolve().then(() =>
          options.executor.execute(request, {
            signal: executionController!.signal,
            peerCertificateSha256: fingerprint,
          }),
        );
        const executorSettlement = executorPromise.then(
          () => undefined,
          () => undefined,
        );
        executorSettlements.add(executorSettlement);
        void executorSettlement.then(() => executorSettlements.delete(executorSettlement));
        let result: Result;
        try {
          result = await Promise.race([executorPromise, connectionMonitor]);
          if (executionController.signal.aborted) throw abortError();
        } catch (error) {
          executionController.abort();
          audit("EXECUTION_ABORTED");
          try {
            await executorPromise;
          } catch {
            // The executor must settle after cancellation before the slot is released.
          }
          throw error;
        } finally {
          monitorInput = false;
          clearTimeout(executionTimer);
          executionControllers.delete(executionController);
        }
        const response = await profile.buildSignedResponse(
          request,
          result,
          options.signer,
          (options.now ?? (() => new Date()))(),
        );
        const responseBytes = Buffer.from(canonicalWorkerRpcJson(response), "utf8");
        if (responseBytes.byteLength > WORKER_RPC_MAX_RESPONSE_BYTES) {
          throw new Error("Worker RPC response exceeds its byte limit.");
        }
        const responseController = new AbortController();
        const responseTimeoutMs = Math.max(
          1,
          Math.min(
            10_000,
            Date.parse(request.expiresAt) -
              (options.now ?? (() => new Date()))().getTime(),
          ),
        );
        const responseTimer = setTimeout(() => {
          responseController.abort();
          socket.destroy();
        }, responseTimeoutMs);
        try {
          await writeFrame(
            socket,
            profile.responseMagic,
            responseBytes,
            WORKER_RPC_MAX_RESPONSE_BYTES,
            responseController.signal,
          );
        } finally {
          clearTimeout(responseTimer);
        }
        socket.end();
        audit("RESPONSE_SENT");
      } catch {
        audit("REQUEST_REJECTED");
        socket.destroy();
      } finally {
        clearTimeout(requestReadTimer);
        requestReadController?.abort();
        if (executionController !== null) executionControllers.delete(executionController);
        if (ownsRepairSlot) activeRepair = false;
        sockets.delete(socket);
      }
    })();
  });

  return {
    async listen(): Promise<{ host: string; port: number }> {
      if (closed || listening) {
        throw new Error("Worker TLS supervisor can listen exactly once.");
      }
      await new Promise<void>((resolve, reject) => {
        const onError = () => {
          server.removeListener("listening", onListening);
          reject(new Error("Worker TLS supervisor failed to listen."));
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, options.host);
      });
      listening = true;
      return serverAddress(server, options.host);
    },
    async close(): Promise<void> {
      if (closing !== null) return closing;
      closed = true;
      closing = (async () => {
        for (const controller of executionControllers) controller.abort();
        for (const socket of sockets) socket.destroy();
        for (const socket of rawConnections) socket.destroy();
        sockets.clear();
        rawConnections.clear();
        if (listening) {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
          });
          listening = false;
        }
        if (executorSettlements.size > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Worker TLS supervisor executor did not settle after cancellation.",
                  ),
                ),
              executorShutdownTimeoutMs,
            );
            Promise.all([...executorSettlements]).then(
              () => {
                clearTimeout(timer);
                resolve();
              },
              () => {
                clearTimeout(timer);
                reject(new Error("Worker TLS supervisor executor shutdown failed."));
              },
            );
          });
        }
      })();
      return closing;
    },
    get activeRepairCount(): number {
      return activeRepair ? 1 : 0;
    },
    get openConnectionCount(): number {
      return rawConnections.size;
    },
  };
}

export function createMutualTlsWorkerRpcSupervisor(
  options: MutualTlsWorkerRpcSupervisorOptions,
): MutualTlsWorkerRpcSupervisor {
  assertPolicyTwinSigner(options.signer);
  assertWorkerRpcTrustBundleSigner(options.trustBundle, options.signer);
  if (options.signer.purpose !== "GENERAL_WORKER_RPC_V1") {
    throw new Error("Worker TLS v1 supervisor signer lacks the general worker purpose.");
  }
  return createMutualTlsWorkerRpcSupervisorForProfile(options, {
    ...V1_MTLS_PROFILE,
    decodeRequest: decodeCanonicalRequest,
    buildSignedResponse,
  });
}

export function createMutualTlsWorkerRpcV2Supervisor(
  options: MutualTlsWorkerRpcV2SupervisorOptions,
): MutualTlsWorkerRpcSupervisor {
  assertPolicyTwinSigner(options.signer);
  assertWorkerRpcTrustBundleSigner(options.trustBundle, options.signer);
  if (
    !options.signer.keyId.startsWith("live-cpu-") ||
    options.signer.purpose !== "LIVE_LINUX_CGROUP_RPC_V2"
  ) {
    throw new Error("Worker TLS v2 supervisor signer lacks the live CPU proof purpose.");
  }
  if (options.replayStore.durability !== "DURABLE_SQLITE") {
    throw new Error("Worker TLS v2 supervisor requires a durable SQLite replay store.");
  }
  return createMutualTlsWorkerRpcSupervisorForProfile(options, {
    ...V2_MTLS_PROFILE,
    decodeRequest: decodeCanonicalV2Request,
    buildSignedResponse: buildSignedV2Response,
  });
}
