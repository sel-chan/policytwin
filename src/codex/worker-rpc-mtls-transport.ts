import { isIP } from "node:net";
import {
  checkServerIdentity,
  connect as connectTls,
  type PeerCertificate,
  type TLSSocket,
} from "node:tls";
import {
  WORKER_RPC_MAX_REQUEST_BYTES,
  WORKER_RPC_MAX_RESPONSE_BYTES,
} from "./worker-rpc-contract.js";
import type {
  ExternalWorkerRpcResponseStream,
  ExternalWorkerRpcTransport,
  MutualTlsWorkerRpcV2Transport,
} from "./worker-rpc-transport-capability.js";

export const WORKER_RPC_MTLS_ALPN = "policytwin-worker-rpc/1" as const;
export const WORKER_RPC_MTLS_REQUEST_MAGIC = "PTQ1" as const;
export const WORKER_RPC_MTLS_RESPONSE_MAGIC = "PTS1" as const;
export const WORKER_RPC_V2_MTLS_ALPN = "policytwin-worker-rpc/2" as const;
export const WORKER_RPC_V2_MTLS_REQUEST_MAGIC = "PTQ2" as const;
export const WORKER_RPC_V2_MTLS_RESPONSE_MAGIC = "PTS2" as const;
export const WORKER_RPC_MTLS_HEADER_BYTES = 8;

const TLS_RECORD_CHUNK_BYTES = 64 * 1024;
const MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS = new WeakSet<object>();

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

interface WorkerRpcMtlsProfile {
  alpn: string;
  requestMagic: string;
  responseMagic: string;
}

interface MutualTlsWorkerRpcTransportSnapshot {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly servername: string;
  readonly ca: TlsCa;
  readonly cert: TlsCertificate;
  readonly key: TlsCertificate;
  readonly keyPassphrase: string | undefined;
  readonly expectedServerCertificateSha256: string;
  readonly handshakeTimeoutMs: number;
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
    (/\s|[/\\:@]/u.test(value) && isIP(value) === 0)
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

function copyTlsMaterial(value: string | Buffer): string | Buffer {
  return typeof value === "string" ? value : Buffer.from(value);
}

function copyTlsCa(value: TlsCa): TlsCa {
  if (!Array.isArray(value)) return copyTlsMaterial(value);
  const copied = value.map((item) => copyTlsMaterial(item));
  Object.freeze(copied);
  return copied;
}

function optionalTlsPassphrase(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4_096 || value.includes("\0")) {
    throw new Error("External worker TLS key passphrase is invalid.");
  }
  return value;
}

function fingerprintSha256(value: string, label: string): string {
  const normalized = value.replaceAll(":", "").toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a SHA-256 certificate fingerprint.`);
  }
  return normalized;
}

function snapshotMutualTlsWorkerRpcTransportOptions(
  options: MutualTlsWorkerRpcTransportOptions,
): MutualTlsWorkerRpcTransportSnapshot {
  const {
    id,
    host,
    port,
    servername,
    ca,
    cert,
    key,
    keyPassphrase,
    expectedServerCertificateSha256,
    handshakeTimeoutMs,
  } = options;
  tlsMaterial(ca, "External worker TLS CA");
  tlsMaterial(cert, "External worker TLS client certificate");
  tlsMaterial(key, "External worker TLS client key");
  return Object.freeze({
    id: safeIdentifier(id, "External worker TLS transport ID"),
    host: safeHost(host, "External worker TLS host"),
    port: integer(port, "External worker TLS port", 1, 65_535),
    servername: safeServername(servername),
    ca: copyTlsCa(ca),
    cert: copyTlsMaterial(cert),
    key: copyTlsMaterial(key),
    keyPassphrase: optionalTlsPassphrase(keyPassphrase),
    expectedServerCertificateSha256: fingerprintSha256(
      expectedServerCertificateSha256,
      "External worker TLS server fingerprint",
    ),
    handshakeTimeoutMs: integer(
      handshakeTimeoutMs ?? 10_000,
      "External worker TLS handshake timeout",
      250,
      60_000,
    ),
  });
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

async function connectAuthenticatedTls(
  options: MutualTlsWorkerRpcTransportSnapshot,
  signal: AbortSignal,
  expectedAlpn: string,
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
      ALPNProtocols: [expectedAlpn],
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
      options.handshakeTimeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("error", onError);
    socket.once("secureConnect", () => {
      try {
        assertTlsProtocol(socket, "External worker supervisor", expectedAlpn);
        const certificate = socket.getPeerCertificate(true) as PeerCertificate;
        const identityError = checkServerIdentity(options.servername, certificate);
        if (identityError !== undefined) throw identityError;
        if (
          peerFingerprint(socket, "External worker supervisor") !==
          options.expectedServerCertificateSha256
        ) {
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

function createMutualTlsWorkerRpcTransportForProfile(
  options: MutualTlsWorkerRpcTransportOptions,
  profile: WorkerRpcMtlsProfile,
): ExternalWorkerRpcTransport {
  const snapshot = snapshotMutualTlsWorkerRpcTransportOptions(options);

  return {
    id: snapshot.id,
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
        snapshot,
        callOptions.signal,
        profile.alpn,
      );
      const onAbort = () => socket.destroy(abortError());
      callOptions.signal.addEventListener("abort", onAbort, { once: true });
      try {
        await writeFrame(
          socket,
          profile.requestMagic,
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
          profile.responseMagic,
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

export function createMutualTlsWorkerRpcTransport(
  options: MutualTlsWorkerRpcTransportOptions,
): ExternalWorkerRpcTransport {
  return createMutualTlsWorkerRpcTransportForProfile(options, V1_MTLS_PROFILE);
}

export function createMutualTlsWorkerRpcV2Transport(
  options: MutualTlsWorkerRpcTransportOptions,
): MutualTlsWorkerRpcV2Transport {
  const transport = Object.freeze(
    createMutualTlsWorkerRpcTransportForProfile(options, V2_MTLS_PROFILE),
  );
  MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS.add(transport);
  return transport as MutualTlsWorkerRpcV2Transport;
}

export function assertMutualTlsWorkerRpcV2Transport(
  transport: ExternalWorkerRpcTransport,
): asserts transport is MutualTlsWorkerRpcV2Transport {
  if (transport.authenticationMode !== "MUTUAL_TLS") {
    throw new Error("External worker v2 transport must use mutual TLS.");
  }
  if (!MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS.has(transport)) {
    throw new Error(
      "External worker v2 transport must be created by the concrete mutual TLS v2 transport factory.",
    );
  }
}
