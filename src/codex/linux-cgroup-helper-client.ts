import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  type PrivateLiveLinuxDockerCleanupReceipt,
  type PrivateLiveLinuxDockerOwner,
  type PrivateLiveLinuxDockerRemovalReceipt,
  type PrivateLiveLinuxDockerReobservation,
  type PrivateLiveLinuxOwnedDockerRole,
  assertPrivateLiveLinuxDockerCleanupReceipt,
  assertPrivateLiveLinuxDockerRemovalReceipt,
  assertPrivateLiveLinuxOwnedDockerRole,
  consumePrivateLiveLinuxDockerHelperBindIdentity,
} from "./live-linux-docker-owned-container.js";
import {
  LINUX_CGROUP_HELPER_OPCODES,
  type LinuxCgroupHelperRole,
  decodeLinuxCgroupHelperAckResponse,
  decodeLinuxCgroupHelperBindResponse,
  decodeLinuxCgroupHelperError,
  decodeLinuxCgroupHelperFrame,
  decodeLinuxCgroupHelperHelloResponse,
  decodeLinuxCgroupHelperRawClockResponse,
  decodeLinuxCgroupHelperSampleResponse,
  encodeLinuxCgroupHelperBindPayload,
  encodeLinuxCgroupHelperFrame,
  encodeLinuxCgroupHelperHandlePayload,
  encodeLinuxCgroupHelperHelloPayload,
  linuxCgroupHelperFrameLength,
} from "./linux-cgroup-helper-protocol.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_HELPER_BYTES = 4 * 1024 * 1024;
const EXPECTED_CAPABILITY_BITS = 0x7fn;
const MIN_HELPER_REQUEST_TIMEOUT_MS = 6_000;
const HELPER_TERMINATION_GRACE_MS = 500;
const helperClientStates = new WeakMap<object, HelperClientState>();
const boundRoleStates = new WeakMap<object, BoundRoleState>();

export declare const PRIVATE_LINUX_CGROUP_HELPER_CLIENT: unique symbol;
export declare const PRIVATE_LINUX_CGROUP_HELPER_BOUND_ROLE: unique symbol;

export interface PrivateLinuxCgroupHelperClient {
  readonly [PRIVATE_LINUX_CGROUP_HELPER_CLIENT]: "PRIVATE_LINUX_CGROUP_HELPER_CLIENT";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_HELPER_HANDSHAKE_VERIFIED";
  readonly protocolVersion: "1";
  readonly helperSha256: string;
  readonly runBindingSha256: string;
  readonly handshakeVerified: true;
  readonly dynamicContainerRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
}

export interface CreatePrivateLinuxCgroupHelperClientOptions {
  helperPath: string;
  expectedHelperSha256: string;
  runBindingSha256: string;
  requestTimeoutMs: number;
  /** Test seam only; the default is the operating-system CSPRNG. */
  randomBytes?: (size: number) => Uint8Array;
}

export interface PrivateLinuxCgroupHelperBoundRole {
  readonly [PRIVATE_LINUX_CGROUP_HELPER_BOUND_ROLE]: "PRIVATE_LINUX_CGROUP_HELPER_BOUND_ROLE";
  readonly schemaVersion: "1";
  readonly status: "PRIVATE_HELPER_ROLE_BOUND_NOT_RUNTIME_VERIFIED";
  readonly role: LinuxCgroupHelperRole;
  readonly baseline: Readonly<{
    monotonicRawNs: bigint;
    usageUsec: bigint;
  }>;
  readonly dynamicContainerRuntimeVerified: false;
  readonly liveEvidenceIssuanceEnabled: false;
  readonly passSigningEligible: false;
}

export interface PrivateLinuxCgroupHelperRoleSample {
  readonly schemaVersion: "1";
  readonly role: LinuxCgroupHelperRole;
  readonly monotonicRawNs: bigint;
  readonly usageUsec: bigint;
  readonly populated: boolean;
  readonly frozen: boolean;
  readonly directProcessCount: number;
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
  poisoning: boolean;
  activeRoleCount: number;
  readonly boundRoles: Set<LinuxCgroupHelperRole>;
  lastMonotonicRawNs: bigint;
  stopping: Promise<void> | undefined;
}

type BoundRoleStatus = "BOUND" | "ACTIVE" | "FROZEN" | "KILL_SENT" | "QUIESCENT" | "RELEASED";

interface BoundRoleState {
  readonly clientState: HelperClientState;
  readonly capability: PrivateLinuxCgroupHelperBoundRole;
  readonly handle: number;
  readonly role: LinuxCgroupHelperRole;
  readonly containerId: string;
  readonly pid: number;
  readonly pidStartTicks: bigint;
  readonly cgroupDevice: bigint;
  readonly cgroupInode: bigint;
  readonly cgroupMountId: bigint;
  lastMonotonicRawNs: bigint;
  lastUsageUsec: bigint;
  status: BoundRoleStatus;
}

class HelperRejectedOperation extends Error {
  constructor(
    message: string,
    readonly errorCode: number,
  ) {
    super(message);
    this.name = "HelperRejectedOperation";
  }
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The Linux cgroup helper request was aborted.");
}

function poisonHelperSession(state: HelperClientState) {
  if (state.poisoning || state.terminal) return;
  state.poisoning = true;
  state.terminal = true;
  try {
    state.child.stdin.end();
  } catch {
    state.child.stdin.destroy();
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

function requiredBoundState(
  client: PrivateLinuxCgroupHelperClient,
  role: PrivateLinuxCgroupHelperBoundRole,
) {
  const clientState = requiredState(client);
  const roleState =
    typeof role === "object" && role !== null ? boundRoleStates.get(role) : undefined;
  if (
    roleState === undefined ||
    roleState.clientState !== clientState ||
    roleState.status === "RELEASED"
  ) {
    throw new Error("The helper role is not an active private bound role capability.");
  }
  return roleState;
}

export function assertPrivateLinuxCgroupHelperBoundRole(
  client: PrivateLinuxCgroupHelperClient,
  value: unknown,
): asserts value is PrivateLinuxCgroupHelperBoundRole {
  try {
    requiredBoundState(client, value as PrivateLinuxCgroupHelperBoundRole);
  } catch {
    throw new Error("The value is not an active private bound role capability.");
  }
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

function recordMonotonicRawNs(state: HelperClientState, value: bigint) {
  if (value <= state.lastMonotonicRawNs) {
    poisonHelperSession(state);
    throw new Error("The Linux cgroup helper RAW clock did not advance globally.");
  }
  state.lastMonotonicRawNs = value;
  return value;
}

function decodeBoundSample(state: BoundRoleState, payload: Buffer) {
  let decoded: ReturnType<typeof decodeLinuxCgroupHelperSampleResponse>;
  try {
    decoded = decodeLinuxCgroupHelperSampleResponse(payload);
  } catch (error) {
    poisonHelperSession(state.clientState);
    throw error;
  }
  if (
    decoded.handle !== state.handle ||
    decoded.usageUsec < state.lastUsageUsec ||
    decoded.monotonicRawNs <= state.lastMonotonicRawNs
  ) {
    poisonHelperSession(state.clientState);
    throw new Error("The Linux cgroup helper sample regressed or changed identity.");
  }
  recordMonotonicRawNs(state.clientState, decoded.monotonicRawNs);
  state.lastMonotonicRawNs = decoded.monotonicRawNs;
  state.lastUsageUsec = decoded.usageUsec;
  return Object.freeze({
    schemaVersion: "1" as const,
    role: state.role,
    monotonicRawNs: decoded.monotonicRawNs,
    usageUsec: decoded.usageUsec,
    populated: decoded.populated,
    frozen: decoded.frozen,
    directProcessCount: decoded.directProcessCount,
  }) satisfies PrivateLinuxCgroupHelperRoleSample;
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
  options: { signal?: AbortSignal; allowStopping?: boolean } = {},
) {
  const allowStopping = options.allowStopping === true;
  if (state.terminal || (state.stopped && !allowStopping)) {
    throw new Error("The Linux cgroup helper session is closed.");
  }
  if (Boolean(options.signal?.aborted)) throw abortError(options.signal!);
  let releaseQueue!: () => void;
  const previous = state.queue;
  state.queue = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue;
  });
  await previous;
  if (state.terminal || (state.stopped && !allowStopping)) {
    releaseQueue();
    throw new Error("The Linux cgroup helper session is closed.");
  }
  if (Boolean(options.signal?.aborted)) {
    releaseQueue();
    throw abortError(options.signal!);
  }
  const sequence = state.nextSequence;
  state.nextSequence += 1n;
  let timeout: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error("The Linux cgroup helper request timed out.");
      poisonHelperSession(state);
      reject(error);
    }, state.requestTimeoutMs);
    if (options.signal !== undefined) {
      abortListener = () => {
        const error = abortError(options.signal!);
        poisonHelperSession(state);
        reject(error);
      };
      options.signal.addEventListener("abort", abortListener, { once: true });
    }
  });
  try {
    const response = await Promise.race([
      (async () => {
        await writeFrame(state.child, encodeLinuxCgroupHelperFrame({ opcode, sequence, payload }));
        return await state.reader.readFrame();
      })(),
      boundary,
    ]);
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
        helperError.errorCode,
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
    poisonHelperSession(state);
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortListener !== undefined && options.signal !== undefined) {
      options.signal.removeEventListener("abort", abortListener);
    }
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
  const runBindingSha256 = options.runBindingSha256;
  const requestTimeoutMs = options.requestTimeoutMs;
  const random = validateRandom(options.randomBytes);
  if (process.platform !== "linux") {
    throw new Error("The private cgroup helper requires a Linux supervisor.");
  }
  if (!SHA256.test(runBindingSha256)) {
    throw new Error("The Linux cgroup helper run binding is invalid.");
  }
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < MIN_HELPER_REQUEST_TIMEOUT_MS ||
    requestTimeoutMs > 60_000
  ) {
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
    runBindingSha256,
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
    poisoning: false,
    activeRoleCount: 0,
    boundRoles: new Set(),
    lastMonotonicRawNs: 0n,
    stopping: undefined,
  };
  helperClientStates.set(client, state);
  child.once("exit", () => {
    state.terminal = true;
  });
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
    poisonHelperSession(state);
    throw error;
  } finally {
    nonce.fill(0);
  }
}

export async function readPrivateLinuxCgroupHelperRawClockNs(
  client: PrivateLinuxCgroupHelperClient,
  signal?: AbortSignal,
) {
  const state = requiredState(client);
  const response = await requestFrame(
    state,
    LINUX_CGROUP_HELPER_OPCODES.RAW_CLOCK,
    Buffer.alloc(0),
    8,
    signal === undefined ? {} : { signal },
  );
  let value: bigint;
  try {
    value = decodeLinuxCgroupHelperRawClockResponse(response);
  } catch (error) {
    poisonHelperSession(state);
    throw error;
  }
  return recordMonotonicRawNs(state, value);
}

export async function bindPrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  owner: PrivateLiveLinuxDockerOwner,
  ownedRole: PrivateLiveLinuxOwnedDockerRole,
  reobservation: PrivateLiveLinuxDockerReobservation,
  signal: AbortSignal,
): Promise<PrivateLinuxCgroupHelperBoundRole> {
  const state = requiredState(client);
  if (signal.aborted) throw abortError(signal);
  const identity = consumePrivateLiveLinuxDockerHelperBindIdentity(
    owner,
    ownedRole,
    reobservation,
  );
  if (state.boundRoles.has(identity.role)) {
    throw new Error(`The ${identity.role} helper role was already bound in this session.`);
  }
  const response = await requestFrame(
    state,
    LINUX_CGROUP_HELPER_OPCODES.BIND,
    encodeLinuxCgroupHelperBindPayload(identity),
    56,
    { signal },
  );
  let bound: ReturnType<typeof decodeLinuxCgroupHelperBindResponse>;
  try {
    bound = decodeLinuxCgroupHelperBindResponse(response);
  } catch (error) {
    poisonHelperSession(state);
    throw error;
  }
  if (
    bound.role !== identity.role ||
    bound.pidStartTicks === 0n ||
    bound.cgroupDevice === 0n ||
    bound.cgroupInode === 0n ||
    bound.cgroupMountId === 0n
  ) {
    poisonHelperSession(state);
    throw new Error("The Linux cgroup helper returned an invalid bound identity.");
  }
  recordMonotonicRawNs(state, bound.monotonicRawNs);
  const capability = Object.freeze({
    schemaVersion: "1" as const,
    status: "PRIVATE_HELPER_ROLE_BOUND_NOT_RUNTIME_VERIFIED" as const,
    role: identity.role,
    baseline: Object.freeze({
      monotonicRawNs: bound.monotonicRawNs,
      usageUsec: bound.baselineUsageUsec,
    }),
    dynamicContainerRuntimeVerified: false as const,
    liveEvidenceIssuanceEnabled: false as const,
    passSigningEligible: false as const,
  }) as unknown as PrivateLinuxCgroupHelperBoundRole;
  const roleState: BoundRoleState = {
    clientState: state,
    capability,
    handle: bound.handle,
    role: identity.role,
    containerId: identity.containerId,
    pid: identity.pid,
    pidStartTicks: bound.pidStartTicks,
    cgroupDevice: bound.cgroupDevice,
    cgroupInode: bound.cgroupInode,
    cgroupMountId: bound.cgroupMountId,
    lastMonotonicRawNs: bound.monotonicRawNs,
    lastUsageUsec: bound.baselineUsageUsec,
    status: "BOUND",
  };
  boundRoleStates.set(capability, roleState);
  state.boundRoles.add(identity.role);
  state.activeRoleCount += 1;
  return capability;
}

export function activatePrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  owner: PrivateLiveLinuxDockerOwner,
  ownedRole: PrivateLiveLinuxOwnedDockerRole,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
) {
  const state = requiredBoundState(client, boundRole);
  try {
    assertPrivateLiveLinuxOwnedDockerRole(owner, ownedRole);
  } catch (error) {
    poisonHelperSession(state.clientState);
    throw error;
  }
  if (state.status !== "BOUND" || ownedRole.role !== state.role) {
    poisonHelperSession(state.clientState);
    throw new Error("The helper role cannot be activated for a different Docker identity.");
  }
  state.status = "ACTIVE";
}

export async function samplePrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
  signal: AbortSignal,
) {
  const state = requiredBoundState(client, boundRole);
  if (state.status !== "ACTIVE") {
    throw new Error("Only an active helper role can be sampled.");
  }
  const response = await requestFrame(
    state.clientState,
    LINUX_CGROUP_HELPER_OPCODES.SAMPLE,
    encodeLinuxCgroupHelperHandlePayload(state.handle),
    28,
    { signal },
  );
  return decodeBoundSample(state, response);
}

export async function freezePrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
  signal: AbortSignal,
) {
  const state = requiredBoundState(client, boundRole);
  if (state.status !== "ACTIVE" && state.status !== "BOUND") {
    throw new Error("Only a bound or active helper role can be frozen.");
  }
  const response = await requestFrame(
    state.clientState,
    LINUX_CGROUP_HELPER_OPCODES.FREEZE,
    encodeLinuxCgroupHelperHandlePayload(state.handle),
    28,
    { signal },
  );
  const sample = decodeBoundSample(state, response);
  if (!sample.frozen) {
    poisonHelperSession(state.clientState);
    throw new Error("The Linux cgroup helper did not observe the frozen role.");
  }
  state.status = "FROZEN";
  return sample;
}

export async function killPrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
  signal: AbortSignal,
) {
  const state = requiredBoundState(client, boundRole);
  if (state.status !== "FROZEN") {
    throw new Error("The helper role must be frozen before kill containment.");
  }
  const response = await requestFrame(
    state.clientState,
    LINUX_CGROUP_HELPER_OPCODES.KILL,
    encodeLinuxCgroupHelperHandlePayload(state.handle),
    28,
    { signal },
  );
  const sample = decodeBoundSample(state, response);
  state.status = "KILL_SENT";
  return sample;
}

export async function readQuiescentPrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
  signal: AbortSignal,
) {
  const state = requiredBoundState(client, boundRole);
  if (state.status !== "ACTIVE" && state.status !== "KILL_SENT") {
    throw new Error("The helper role is not ready for a quiescent observation.");
  }
  const response = await requestFrame(
    state.clientState,
    LINUX_CGROUP_HELPER_OPCODES.QUIESCENT,
    encodeLinuxCgroupHelperHandlePayload(state.handle),
    28,
    { signal },
  );
  const sample = decodeBoundSample(state, response);
  if (sample.populated || sample.directProcessCount !== 0) {
    poisonHelperSession(state.clientState);
    throw new Error("The Linux cgroup helper returned a non-quiescent final sample.");
  }
  state.status = "QUIESCENT";
  return sample;
}

export async function releasePrivateLinuxCgroupHelperRole(
  client: PrivateLinuxCgroupHelperClient,
  owner: PrivateLiveLinuxDockerOwner,
  ownedRole: PrivateLiveLinuxOwnedDockerRole,
  removalReceipt: PrivateLiveLinuxDockerRemovalReceipt,
  boundRole: PrivateLinuxCgroupHelperBoundRole,
  signal: AbortSignal,
) {
  const state = requiredBoundState(client, boundRole);
  if (state.status !== "QUIESCENT") {
    throw new Error("The helper role must be quiescent before cgroup release.");
  }
  assertPrivateLiveLinuxDockerRemovalReceipt(owner, ownedRole, removalReceipt);
  const response = await requestFrame(
    state.clientState,
    LINUX_CGROUP_HELPER_OPCODES.RELEASE,
    encodeLinuxCgroupHelperHandlePayload(state.handle),
    4,
    { signal },
  );
  try {
    decodeLinuxCgroupHelperAckResponse(response, state.handle);
  } catch (error) {
    poisonHelperSession(state.clientState);
    throw error;
  }
  state.status = "RELEASED";
  state.clientState.boundRoles.delete(state.role);
  state.clientState.activeRoleCount -= 1;
  boundRoleStates.delete(boundRole);
}

export async function stopPrivateLinuxCgroupHelperClient(
  client: PrivateLinuxCgroupHelperClient,
  signal?: AbortSignal,
) {
  const state =
    typeof client === "object" && client !== null ? helperClientStates.get(client) : undefined;
  if (state === undefined) {
    throw new Error("The Linux cgroup helper client is not a private capability.");
  }
  if (state.stopping !== undefined) return await state.stopping;
  if (state.terminal || state.stopped) {
    throw new Error("The Linux cgroup helper session is closed.");
  }
  if (signal?.aborted === true) throw abortError(signal);
  if (state.activeRoleCount !== 0 || state.boundRoles.size !== 0) {
    throw new Error("The Linux cgroup helper cannot stop while bound roles remain.");
  }
  const stopping = (async () => {
    state.stopped = true;
    const response = await requestFrame(
      state,
      LINUX_CGROUP_HELPER_OPCODES.STOP,
      Buffer.alloc(0),
      0,
      {
        allowStopping: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.byteLength !== 0) {
      poisonHelperSession(state);
      throw new Error("The Linux cgroup helper stop response is invalid.");
    }
    state.child.stdin.end();
    const exit = await state.exitOutcome;
    state.terminal = true;
    if (exit.error !== undefined || exit.code !== 0 || exit.signal !== null) {
      throw new Error("The Linux cgroup helper did not stop cleanly.");
    }
  })();
  state.stopping = stopping;
  return await stopping;
}

export async function terminatePrivateLinuxCgroupHelperAfterDockerCleanup(
  client: PrivateLinuxCgroupHelperClient,
  owner: PrivateLiveLinuxDockerOwner,
  cleanupReceipt: PrivateLiveLinuxDockerCleanupReceipt,
) {
  const state =
    typeof client === "object" && client !== null ? helperClientStates.get(client) : undefined;
  if (state === undefined) {
    throw new Error("The Linux cgroup helper client is not a private capability.");
  }
  assertPrivateLiveLinuxDockerCleanupReceipt(owner, cleanupReceipt);
  state.terminal = true;
  state.poisoning = true;
  try {
    state.child.stdin.end();
  } catch {
    state.child.stdin.destroy();
  }
  if (state.child.exitCode === null && state.child.signalCode === null) {
    state.child.kill("SIGTERM");
  }
  const graceful = await Promise.race([
    state.exitOutcome.then(() => true),
    new Promise<false>((resolveTimeout) => {
      const timer = setTimeout(() => resolveTimeout(false), HELPER_TERMINATION_GRACE_MS);
      timer.unref();
    }),
  ]);
  if (!graceful && state.child.exitCode === null && state.child.signalCode === null) {
    state.child.kill("SIGKILL");
    await state.exitOutcome;
  }
}
