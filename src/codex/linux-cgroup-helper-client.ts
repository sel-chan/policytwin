import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  LINUX_CGROUP_HELPER_OPCODES,
  decodeLinuxCgroupHelperError,
  decodeLinuxCgroupHelperFrame,
  decodeLinuxCgroupHelperHelloResponse,
  decodeLinuxCgroupHelperRawClockResponse,
  encodeLinuxCgroupHelperFrame,
  encodeLinuxCgroupHelperHelloPayload,
  linuxCgroupHelperFrameLength,
} from "./linux-cgroup-helper-protocol.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_HELPER_BYTES = 4 * 1024 * 1024;
const EXPECTED_CAPABILITY_BITS = 0x7fn;
const helperClientStates = new WeakMap<object, HelperClientState>();

export declare const PRIVATE_LINUX_CGROUP_HELPER_CLIENT: unique symbol;

export interface PrivateLinuxCgroupHelperClient {
  readonly [PRIVATE_LINUX_CGROUP_HELPER_CLIENT]: "PRIVATE_LINUX_CGROUP_HELPER_CLIENT";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_HELPER_HANDSHAKE_VERIFIED";
  readonly protocolVersion: "1";
  readonly helperSha256: string;
  readonly handshakeVerified: true;
  readonly dynamicContainerRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
}

export interface CreatePrivateLinuxCgroupHelperClientOptions {
  helperPath: string;
  expectedHelperSha256: string;
  requestTimeoutMs: number;
  /** Test seam only; the default is the operating-system CSPRNG. */
  randomBytes?: (size: number) => Uint8Array;
}

class HelperFrameReader {
  private buffered = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(stream: NodeJS.ReadableStream) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(minimumBytes: number) {
    while (this.buffered.byteLength < minimumBytes) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("The Linux cgroup helper response stream ended early.");
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      if (chunk.byteLength === 0) continue;
      if (this.buffered.byteLength + chunk.byteLength > 4_096) {
        throw new Error("The Linux cgroup helper response stream exceeded its bound.");
      }
      this.buffered = Buffer.concat([this.buffered, chunk]);
    }
  }

  async readFrame() {
    await this.fill(24);
    const length = linuxCgroupHelperFrameLength(this.buffered.subarray(0, 24));
    await this.fill(length);
    const frameBytes = this.buffered.subarray(0, length);
    this.buffered = Buffer.from(this.buffered.subarray(length));
    return decodeLinuxCgroupHelperFrame(frameBytes);
  }
}

interface HelperClientState {
  readonly client: PrivateLinuxCgroupHelperClient;
  readonly child: ChildProcessWithoutNullStreams;
  readonly reader: HelperFrameReader;
  readonly requestTimeoutMs: number;
  readonly exitOutcome: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>;
  nextSequence: bigint;
  queue: Promise<void>;
  terminal: boolean;
  stopped: boolean;
}

class HelperRejectedOperation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelperRejectedOperation";
  }
}

function requiredState(client: PrivateLinuxCgroupHelperClient) {
  const state =
    typeof client === "object" && client !== null ? helperClientStates.get(client) : undefined;
  if (state === undefined || state.terminal) {
    throw new Error("The Linux cgroup helper client is not an active private capability.");
  }
  return state;
}

export function assertPrivateLinuxCgroupHelperClient(
  value: unknown,
): asserts value is PrivateLinuxCgroupHelperClient {
  requiredState(value as PrivateLinuxCgroupHelperClient);
}

function validateRandom(candidate: ((size: number) => Uint8Array) | undefined) {
  if (candidate === undefined) return (size: number) => randomBytes(size);
  if (typeof candidate !== "function") throw new Error("The helper random source is invalid.");
  return (size: number) => {
    const value = candidate(size);
    if (!(value instanceof Uint8Array) || value.byteLength !== size) {
      throw new Error("The helper random source returned an invalid value.");
    }
    return Buffer.from(value);
  };
}

async function writeFrame(child: ChildProcessWithoutNullStreams, bytes: Buffer) {
  if (child.stdin.destroyed || !child.stdin.writable) {
    throw new Error("The Linux cgroup helper request stream is unavailable.");
  }
  if (child.stdin.write(bytes)) return;
  await new Promise<void>((resolveDrain, reject) => {
    const onDrain = () => {
      child.stdin.removeListener("error", onError);
      resolveDrain();
    };
    const onError = () => {
      child.stdin.removeListener("drain", onDrain);
      reject(new Error("The Linux cgroup helper request stream failed."));
    };
    child.stdin.once("drain", onDrain);
    child.stdin.once("error", onError);
  });
}

async function requestFrame(
  state: HelperClientState,
  opcode: number,
  payload: Buffer,
  expectedPayloadLength: number,
) {
  if (state.terminal || state.stopped) throw new Error("The Linux cgroup helper session is closed.");
  const sequence = state.nextSequence;
  state.nextSequence += 1n;
  let releaseQueue!: () => void;
  const previous = state.queue;
  state.queue = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue;
  });
  await previous;
  const timeout = setTimeout(() => {
    state.terminal = true;
    state.child.kill("SIGKILL");
  }, state.requestTimeoutMs);
  try {
    await writeFrame(state.child, encodeLinuxCgroupHelperFrame({ opcode, sequence, payload }));
    const response = await state.reader.readFrame();
    if (response.sequence !== sequence) {
      throw new Error("The Linux cgroup helper response sequence is invalid.");
    }
    if (response.opcode === LINUX_CGROUP_HELPER_OPCODES.ERROR) {
      const helperError = decodeLinuxCgroupHelperError(response.payload);
      if (helperError.failedOpcode !== opcode) {
        throw new Error("The Linux cgroup helper error opcode is invalid.");
      }
      throw new HelperRejectedOperation(
        `The Linux cgroup helper rejected operation ${opcode}:${helperError.errorCode}.`,
      );
    }
    if (
      response.opcode !== (opcode | LINUX_CGROUP_HELPER_OPCODES.RESPONSE_BIT) ||
      response.payload.byteLength !== expectedPayloadLength
    ) {
      throw new Error("The Linux cgroup helper response contract is invalid.");
    }
    return response.payload;
  } catch (error) {
    if (error instanceof HelperRejectedOperation) throw error;
    state.terminal = true;
    state.child.kill("SIGKILL");
    throw error;
  } finally {
    clearTimeout(timeout);
    releaseQueue();
  }
}

async function verifyHelperBinary(path: string, expectedSha256: string): Promise<FileHandle> {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    !SHA256.test(expectedSha256)
  ) {
    throw new Error("The Linux cgroup helper binary identity is invalid.");
  }
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1n ||
    before.size > BigInt(MAX_HELPER_BYTES) ||
    (Number(before.mode) & 0o6222) !== 0 ||
    (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid())) ||
    (await realpath(path)) !== path
  ) {
    throw new Error("The Linux cgroup helper binary is unsafe.");
  }
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      (Number(after.mode) & 0o6222) !== 0
    ) {
      throw new Error("The Linux cgroup helper binary changed identity.");
    }
    const bytes = await handle.readFile();
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    bytes.fill(0);
    if (actualSha256 !== expectedSha256) {
      throw new Error("The Linux cgroup helper binary hash does not match.");
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function createPrivateLinuxCgroupHelperClient(
  options: CreatePrivateLinuxCgroupHelperClientOptions,
): Promise<PrivateLinuxCgroupHelperClient> {
  const helperPath = options.helperPath;
  const expectedHelperSha256 = options.expectedHelperSha256;
  const requestTimeoutMs = options.requestTimeoutMs;
  const random = validateRandom(options.randomBytes);
  if (process.platform !== "linux") {
    throw new Error("The private cgroup helper requires a Linux supervisor.");
  }
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 60_000) {
    throw new Error("The Linux cgroup helper request timeout is invalid.");
  }
  const executableHandle = await verifyHelperBinary(helperPath, expectedHelperSha256);
  const helperEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C",
    LC_ALL: "C",
  };
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn("/proc/self/fd/3", ["--stdio-v1"], {
      cwd: "/",
      env: helperEnvironment,
      detached: false,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", executableHandle.fd],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  } finally {
    await executableHandle.close();
  }
  child.stderr.resume();
  child.stdin.on("error", () => undefined);
  const exitOutcome = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>((resolveExit) => {
    child.once("error", (error) => resolveExit({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const client = Object.freeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_HELPER_HANDSHAKE_VERIFIED" as const,
    protocolVersion: "1" as const,
    helperSha256: expectedHelperSha256,
    handshakeVerified: true as const,
    dynamicContainerRuntimeVerified: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
  }) as unknown as PrivateLinuxCgroupHelperClient;
  const state: HelperClientState = {
    client,
    child,
    reader: new HelperFrameReader(child.stdout),
    requestTimeoutMs,
    exitOutcome,
    nextSequence: 1n,
    queue: Promise.resolve(),
    terminal: false,
    stopped: false,
  };
  helperClientStates.set(client, state);
  const nonce = random(32);
  try {
    const response = await requestFrame(
      state,
      LINUX_CGROUP_HELPER_OPCODES.HELLO,
      encodeLinuxCgroupHelperHelloPayload(nonce),
      40,
    );
    const handshake = decodeLinuxCgroupHelperHelloResponse(response, nonce);
    if (handshake.capabilityBits !== EXPECTED_CAPABILITY_BITS) {
      throw new Error("The Linux cgroup helper capability set is invalid.");
    }
    return client;
  } catch (error) {
    state.terminal = true;
    child.kill("SIGKILL");
    throw error;
  } finally {
    nonce.fill(0);
  }
}

export async function readPrivateLinuxCgroupHelperRawClockNs(
  client: PrivateLinuxCgroupHelperClient,
) {
  const state = requiredState(client);
  const response = await requestFrame(
    state,
    LINUX_CGROUP_HELPER_OPCODES.RAW_CLOCK,
    Buffer.alloc(0),
    8,
  );
  return decodeLinuxCgroupHelperRawClockResponse(response);
}

export async function stopPrivateLinuxCgroupHelperClient(
  client: PrivateLinuxCgroupHelperClient,
) {
  const state = requiredState(client);
  const response = await requestFrame(
    state,
    LINUX_CGROUP_HELPER_OPCODES.STOP,
    Buffer.alloc(0),
    0,
  );
  if (response.byteLength !== 0) throw new Error("The Linux cgroup helper stop response is invalid.");
  state.stopped = true;
  state.child.stdin.end();
  const exit = await state.exitOutcome;
  state.terminal = true;
  if (exit.error !== undefined || exit.code !== 0 || exit.signal !== null) {
    throw new Error("The Linux cgroup helper did not stop cleanly.");
  }
}
