import {
  createPrivateKey,
  sign as signPayload,
} from "node:crypto";
import { isIP, type Socket } from "node:net";
import {
  checkServerIdentity,
  connect as connectTls,
  createServer as createTlsServer,
  type PeerCertificate,
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
  workerRpcSha256,
  workerRpcSignaturePayload,
  type WorkerRpcRequest,
  type WorkerRpcResponse,
  type WorkerRpcSupervisorReceipt,
} from "./worker-rpc-contract.js";
import type {
  ExternalWorkerRpcResponseStream,
  ExternalWorkerRpcTransport,
} from "./worker-rpc-client.js";
import type { RepairWorkerReport } from "./types.js";

export const WORKER_RPC_MTLS_ALPN = "policytwin-worker-rpc/1" as const;
export const WORKER_RPC_MTLS_REQUEST_MAGIC = "PTQ1" as const;
export const WORKER_RPC_MTLS_RESPONSE_MAGIC = "PTS1" as const;
export const WORKER_RPC_MTLS_HEADER_BYTES = 8;

const TLS_RECORD_CHUNK_BYTES = 64 * 1024;
const EMPTY_SIGNATURE = Buffer.alloc(64).toString("base64url");

type TlsCa = string | Buffer | Array<string | Buffer>;
type TlsCertificate = string | Buffer;

interface MutualTlsMaterial {
  ca: TlsCa;
  cert: TlsCertificate;
  key: TlsCertificate;
  keyPassphrase?: string;
}

export interface MutualTlsWorkerRpcTransportOptions extends MutualTlsMaterial {
  id: string;
  host: string;
  port: number;
  servername: string;
  expectedServerCertificateSha256: string;
  handshakeTimeoutMs?: number;
}

export interface WorkerRpcReplayCapability {
  requestId: string;
  runNonce: string;
  expiresAt: string;
}

export interface WorkerRpcReplayStore {
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

export interface WorkerRpcSupervisorExecutor {
  execute(
    request: WorkerRpcRequest,
    context: { signal: AbortSignal; peerCertificateSha256: string },
  ): Promise<WorkerRpcSupervisorExecutionResult>;
}

export interface WorkerRpcSupervisorSigner {
  keyId: string;
  supervisorId: string;
  sign(payload: string): Promise<Uint8Array>;
}

export interface Ed25519WorkerRpcSignerOptions {
  keyId: string;
  supervisorId: string;
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

function safeServername(value: string): string {
  if (
    value.length < 1 ||
    value.length > 253 ||
    !/^[A-Za-z0-9.-]+$/u.test(value) ||
    value.startsWith(".") ||
    value.endsWith(".")
  ) {
    throw new Error("External worker TLS server name is invalid.");
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

function assertTlsProtocol(socket: TLSSocket, label: string): void {
  if (
    socket.authorized !== true ||
    socket.getProtocol() !== "TLSv1.3" ||
    socket.alpnProtocol !== WORKER_RPC_MTLS_ALPN
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

async function connectAuthenticatedTls(
  options: MutualTlsWorkerRpcTransportOptions,
  signal: AbortSignal,
  handshakeTimeoutMs: number,
  expectedFingerprint: string,
): Promise<TLSSocket> {
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connectTls({
      host: options.host,
      port: options.port,
      servername: options.servername,
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      passphrase: options.keyPassphrase,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ALPNProtocols: [WORKER_RPC_MTLS_ALPN],
      checkServerIdentity: (_hostname, certificate) =>
        checkServerIdentity(options.servername, certificate),
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("error", onError);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error(message));
    };
    const onAbort = () => fail("External worker TLS connection was aborted.");
    const onError = () => fail("External worker TLS handshake failed.");
    const timer = setTimeout(
      () => fail("External worker TLS handshake timed out."),
      handshakeTimeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("error", onError);
    socket.once("secureConnect", () => {
      try {
        assertTlsProtocol(socket, "External worker supervisor");
        const certificate = socket.getPeerCertificate(true) as PeerCertificate;
        const identityError = checkServerIdentity(options.servername, certificate);
        if (identityError !== undefined) throw identityError;
        if (peerFingerprint(socket, "External worker supervisor") !== expectedFingerprint) {
          throw new Error("External worker supervisor certificate pin does not match.");
        }
      } catch {
        fail("External worker TLS supervisor identity verification failed.");
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      socket.on("error", () => undefined);
      socket.setNoDelay(true);
      resolve(socket);
    });
  });
}

export function createMutualTlsWorkerRpcTransport(
  options: MutualTlsWorkerRpcTransportOptions,
): ExternalWorkerRpcTransport {
  const id = safeIdentifier(options.id, "External worker TLS transport ID");
  safeHost(options.host, "External worker TLS host");
  integer(options.port, "External worker TLS port", 1, 65_535);
  safeServername(options.servername);
  tlsMaterial(options.ca, "External worker TLS CA");
  tlsMaterial(options.cert, "External worker TLS client certificate");
  tlsMaterial(options.key, "External worker TLS client key");
  const expectedFingerprint = fingerprintSha256(
    options.expectedServerCertificateSha256,
    "External worker TLS server fingerprint",
  );
  const handshakeTimeoutMs = integer(
    options.handshakeTimeoutMs ?? 10_000,
    "External worker TLS handshake timeout",
    250,
    60_000,
  );

  return {
    id,
    authenticationMode: "MUTUAL_TLS",
    async call(canonicalRequest, callOptions): Promise<ExternalWorkerRpcResponseStream> {
      if (
        typeof canonicalRequest !== "string" ||
        canonicalRequest.length === 0 ||
        canonicalRequest.includes("\0")
      ) {
        throw new Error("External worker TLS request must be non-empty NUL-free text.");
      }
      const requestBytes = Buffer.from(canonicalRequest, "utf8");
      if (
        requestBytes.byteLength < 1 ||
        requestBytes.byteLength > WORKER_RPC_MAX_REQUEST_BYTES ||
        requestBytes.toString("utf8") !== canonicalRequest
      ) {
        throw new Error("External worker TLS request exceeds its canonical byte limit.");
      }
      const maxResponseBytes = integer(
        callOptions.maxResponseBytes,
        "External worker TLS response limit",
        1,
        WORKER_RPC_MAX_RESPONSE_BYTES,
      );
      const maxChunkBytes = integer(
        callOptions.maxChunkBytes,
        "External worker TLS response chunk limit",
        1,
        WORKER_RPC_MAX_RESPONSE_BYTES,
      );
      const maxChunks = integer(
        callOptions.maxChunks,
        "External worker TLS response chunk-count limit",
        1,
        65_536,
      );
      const socket = await connectAuthenticatedTls(
        options,
        callOptions.signal,
        handshakeTimeoutMs,
        expectedFingerprint,
      );
      const onAbort = () => socket.destroy(abortError());
      callOptions.signal.addEventListener("abort", onAbort, { once: true });
      try {
        await writeFrame(
          socket,
          WORKER_RPC_MTLS_REQUEST_MAGIC,
          requestBytes,
          WORKER_RPC_MAX_REQUEST_BYTES,
          callOptions.signal,
        );
        const reader = new BoundedSocketReader(socket);
        const header = await reader.readExactly(
          WORKER_RPC_MTLS_HEADER_BYTES,
          callOptions.signal,
        );
        const declaredLength = parseFrameHeader(
          header,
          WORKER_RPC_MTLS_RESPONSE_MAGIC,
          maxResponseBytes,
        );
        if (Math.ceil(declaredLength / maxChunkBytes) > maxChunks) {
          throw new Error("External worker TLS response cannot fit the declared chunk limits.");
        }
        const chunks = (async function* (): AsyncGenerator<Uint8Array> {
          let remaining = declaredLength;
          try {
            while (remaining > 0) {
              const size = Math.min(remaining, maxChunkBytes);
              const chunk = await reader.readExactly(size, callOptions.signal);
              remaining -= chunk.byteLength;
              yield chunk;
            }
            await reader.expectEnd(callOptions.signal);
          } finally {
            callOptions.signal.removeEventListener("abort", onAbort);
            socket.destroy();
            const returned = reader.iterator.return?.();
            if (returned !== undefined) {
              void Promise.resolve(returned).catch(() => undefined);
            }
          }
        })();
        return { declaredLength, chunks };
      } catch (error) {
        callOptions.signal.removeEventListener("abort", onAbort);
        socket.destroy();
        throw error;
      }
    },
  };
}

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
  return {
    keyId,
    supervisorId,
    async sign(payload): Promise<Uint8Array> {
      return signPayload(null, Buffer.from(payload, "utf8"), privateKey);
    },
  };
}

function validateRequestWindow(request: WorkerRpcRequest, now: Date, clockSkewMs: number): void {
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
      keyId: signer.keyId,
      supervisorId: signer.supervisorId,
      ...result.receipt,
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

function serverAddress(server: TlsServer, requestedHost: string): { host: string; port: number } {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Worker TLS supervisor did not bind an IP socket.");
  }
  return { host: requestedHost, port: address.port };
}

export function createMutualTlsWorkerRpcSupervisor(
  options: MutualTlsWorkerRpcSupervisorOptions,
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
    ALPNProtocols: [WORKER_RPC_MTLS_ALPN],
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
      let executorPromise: Promise<WorkerRpcSupervisorExecutionResult> | null = null;
      let executionController: AbortController | null = null;
      try {
        assertTlsProtocol(socket, "Worker RPC client");
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
          WORKER_RPC_MTLS_REQUEST_MAGIC,
          WORKER_RPC_MAX_REQUEST_BYTES,
        );
        const requestBytes = await reader.readExactly(
          declaredLength,
          requestReadController.signal,
        );
        if (reader.pendingBytes !== 0) {
          throw new Error("Worker RPC TLS request contains trailing bytes.");
        }
        const { request } = decodeCanonicalRequest(requestBytes);
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
        let result: WorkerRpcSupervisorExecutionResult;
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
        const response = await buildSignedResponse(
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
            WORKER_RPC_MTLS_RESPONSE_MAGIC,
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
