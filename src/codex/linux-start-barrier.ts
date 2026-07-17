import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { TextDecoder } from "node:util";

const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_PROTOCOL_BYTES = 4_096;
const HOST_OWNED_RECEIPT_SLOT_MODE = 0o622;
const LOCKED_RECEIPT_DIRECTORY_MODE = 0o511;
const LOCKED_CONTROL_DIRECTORY_MODE = 0o711;
const HELD_COMMIT_FRAME_BYTES = Buffer.byteLength(
  `${JSON.stringify({
    schemaVersion: "1",
    status: "HELD_RECEIPT_COMMITTED",
    receiptSha256: "0".repeat(64),
  })}\n`,
  "utf8",
);
const ROLES = Object.freeze(["egress", "worker", "verifier"] as const);
const controllerStates = new WeakMap<object, ControllerState>();
const preparedRoleStates = new WeakMap<object, PreparedRoleState>();

export declare const PRIVATE_LINUX_START_BARRIER_CONTROLLER: unique symbol;
export declare const PRIVATE_LINUX_START_BARRIER_ROLE: unique symbol;

export type LinuxStartBarrierRole = (typeof ROLES)[number];

export interface PrivateLinuxStartBarrierController {
  readonly [PRIVATE_LINUX_START_BARRIER_CONTROLLER]: "PRIVATE_HOST_START_BARRIER_CONTROLLER";
  readonly schemaVersion: "1";
  readonly status: "HOST_CONTROLLER_IMPLEMENTED_NOT_RUNTIME_VERIFIED";
  readonly dynamicRuntimeVerified: false;
  readonly rootDirectory: string;
  readonly runBindingSha256: string;
  readonly holdTimeoutMs: number;
  readonly pollIntervalMs: number;
}

export interface LinuxStartBarrierMount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface LinuxStartBarrierContainerConfiguration {
  readonly entrypointPrefix: readonly ["node", "scripts/role-start-barrier.mjs", "--"];
  readonly environment: Readonly<Record<string, string>>;
  readonly receiptMount: LinuxStartBarrierMount;
  readonly controlMount: LinuxStartBarrierMount;
}

export interface LinuxStartBarrierRoleProtocol {
  readonly role: LinuxStartBarrierRole;
  readonly barrierId: string;
  readonly runBindingSha256: string;
}

export interface PrivatePreparedLinuxStartBarrierRole {
  readonly [PRIVATE_LINUX_START_BARRIER_ROLE]: "PRIVATE_PREPARED_START_BARRIER_ROLE";
  readonly schemaVersion: "1";
  readonly status: "PREPARED_HELD_BARRIER";
  readonly roleProtocol: LinuxStartBarrierRoleProtocol;
  readonly containerConfiguration: LinuxStartBarrierContainerConfiguration;
  readonly hostPaths: {
    readonly receiptDirectory: string;
    readonly controlDirectory: string;
  };
}

interface ControllerState {
  readonly controller: PrivateLinuxStartBarrierController;
  readonly rootDirectory: string;
  readonly rootRealPath: string;
  readonly rootDevice: bigint;
  readonly rootInode: bigint;
  readonly random: (size: number) => Buffer;
  readonly beforeReleasePublish: () => Promise<void>;
  readonly preparedRoles: Map<LinuxStartBarrierRole, PrivatePreparedLinuxStartBarrierRole>;
  destroyed: boolean;
}

type PreparedStatus =
  | "PREPARED"
  | "AWAITING"
  | "HELD"
  | "RELEASING"
  | "RELEASED"
  | "FAILED";

interface PreparedRoleState {
  readonly controllerState: ControllerState;
  readonly prepared: PrivatePreparedLinuxStartBarrierRole;
  readonly heldPath: string;
  readonly heldCommitPath: string;
  readonly releasePath: string;
  readonly receiptDirectoryDevice: bigint;
  readonly receiptDirectoryInode: bigint;
  readonly heldIdentity: HostOwnedReceiptSlotIdentity;
  readonly heldCommitIdentity: HostOwnedReceiptSlotIdentity;
  status: PreparedStatus;
}

interface HostOwnedReceiptSlotIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly uid: bigint;
}

export interface CreatePrivateLinuxStartBarrierControllerOptions {
  rootDirectory: string;
  runBindingSha256: string;
  holdTimeoutMs: number;
  pollIntervalMs: number;
  /** Test seam only; the default is the operating-system CSPRNG. */
  randomBytes?: (size: number) => Uint8Array;
  /** Test seam only; it can fail closed immediately before release publication. */
  testOnlyBeforeReleasePublish?: () => void | Promise<void>;
}

function assertIntegerInRange(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
}

function exactRole(value: unknown): asserts value is LinuxStartBarrierRole {
  if (!ROLES.includes(value as LinuxStartBarrierRole)) {
    throw new Error("The start-barrier role is invalid.");
  }
}

function safeRandomFunction(
  candidate: ((size: number) => Uint8Array) | undefined,
): (size: number) => Buffer {
  if (candidate === undefined) return (size) => randomBytes(size);
  if (typeof candidate !== "function") throw new Error("The start-barrier random source is invalid.");
  return (size) => {
    const value = candidate(size);
    if (!(value instanceof Uint8Array) || value.byteLength !== size) {
      throw new Error("The start-barrier random source returned an invalid value.");
    }
    return Buffer.from(value);
  };
}

function token(random: (size: number) => Buffer) {
  const value = random(32).toString("base64url");
  if (!TOKEN.test(value)) throw new Error("The start-barrier random token is invalid.");
  return value;
}

async function createHostOwnedReceiptSlot(path: string): Promise<HostOwnedReceiptSlotIdentity> {
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    HOST_OWNED_RECEIPT_SLOT_MODE,
  );
  try {
    await handle.chmod(HOST_OWNED_RECEIPT_SLOT_MODE);
    const stat = await handle.stat({ bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== 0n ||
      (process.platform === "linux" &&
        (Number(stat.mode) & 0o777) !== HOST_OWNED_RECEIPT_SLOT_MODE)
    ) {
      throw new Error("The host-owned start-barrier receipt slot is unsafe.");
    }
    return Object.freeze({ device: stat.dev, inode: stat.ino, uid: stat.uid });
  } finally {
    await handle.close();
  }
}

async function assertFreshAbsoluteRoot(rootDirectory: string) {
  if (
    typeof rootDirectory !== "string" ||
    rootDirectory.length === 0 ||
    rootDirectory.includes("\0") ||
    !isAbsolute(rootDirectory) ||
    resolve(rootDirectory) !== rootDirectory
  ) {
    throw new Error("The start-barrier root must be a canonical absolute path.");
  }
  try {
    await lstat(rootDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("The start-barrier controller requires a fresh root.");
}

export async function createPrivateLinuxStartBarrierController(
  options: CreatePrivateLinuxStartBarrierControllerOptions,
): Promise<PrivateLinuxStartBarrierController> {
  const rootDirectory = options.rootDirectory;
  const runBindingSha256 = options.runBindingSha256;
  const holdTimeoutMs = options.holdTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs;
  const random = safeRandomFunction(options.randomBytes);
  const beforeReleasePublish = options.testOnlyBeforeReleasePublish;
  if (beforeReleasePublish !== undefined && typeof beforeReleasePublish !== "function") {
    throw new Error("The start-barrier release prepublish hook is invalid.");
  }
  if (!SHA256.test(runBindingSha256)) {
    throw new Error("The start-barrier run binding is invalid.");
  }
  assertIntegerInRange(holdTimeoutMs, 100, 60_000, "The start-barrier hold timeout");
  assertIntegerInRange(pollIntervalMs, 1, 1_000, "The start-barrier poll interval");
  if (pollIntervalMs >= holdTimeoutMs) {
    throw new Error("The start-barrier poll interval must be shorter than its hold timeout.");
  }
  await assertFreshAbsoluteRoot(rootDirectory);
  await mkdir(rootDirectory, { mode: 0o700 });
  const rootStat = await lstat(rootDirectory, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("The start-barrier root is unsafe.");
  }
  const rootRealPath = await realpath(rootDirectory);
  const controller = Object.freeze({
    schemaVersion: "1" as const,
    status: "HOST_CONTROLLER_IMPLEMENTED_NOT_RUNTIME_VERIFIED" as const,
    dynamicRuntimeVerified: false as const,
    rootDirectory,
    runBindingSha256,
    holdTimeoutMs,
    pollIntervalMs,
  }) as unknown as PrivateLinuxStartBarrierController;
  controllerStates.set(controller, {
    controller,
    rootDirectory,
    rootRealPath,
    rootDevice: rootStat.dev,
    rootInode: rootStat.ino,
    random,
    beforeReleasePublish: async () => beforeReleasePublish?.(),
    preparedRoles: new Map(),
    destroyed: false,
  });
  return controller;
}

export function assertPrivateLinuxStartBarrierController(
  value: unknown,
): asserts value is PrivateLinuxStartBarrierController {
  const state =
    typeof value === "object" && value !== null ? controllerStates.get(value) : undefined;
  if (state === undefined || state.destroyed) {
    throw new Error(
      "A Linux start-barrier controller must be created by the private start-barrier factory.",
    );
  }
}

function requiredControllerState(controller: PrivateLinuxStartBarrierController) {
  assertPrivateLinuxStartBarrierController(controller);
  return controllerStates.get(controller)!;
}

function requiredPreparedState(
  controller: PrivateLinuxStartBarrierController,
  prepared: PrivatePreparedLinuxStartBarrierRole,
) {
  const controllerState = requiredControllerState(controller);
  const state =
    typeof prepared === "object" && prepared !== null
      ? preparedRoleStates.get(prepared)
      : undefined;
  if (state === undefined || state.controllerState !== controllerState) {
    throw new Error("The start-barrier role was not issued by this controller.");
  }
  return state;
}

export function assertPrivatePreparedLinuxStartBarrierRole(
  controller: PrivateLinuxStartBarrierController,
  value: unknown,
): asserts value is PrivatePreparedLinuxStartBarrierRole {
  try {
    requiredPreparedState(
      controller,
      value as PrivatePreparedLinuxStartBarrierRole,
    );
  } catch {
    throw new Error("The value is not a private prepared Linux start-barrier role.");
  }
}

export async function preparePrivateLinuxStartBarrierRole(
  controller: PrivateLinuxStartBarrierController,
  role: LinuxStartBarrierRole,
): Promise<PrivatePreparedLinuxStartBarrierRole> {
  const controllerState = requiredControllerState(controller);
  exactRole(role);
  if (controllerState.preparedRoles.has(role)) {
    throw new Error(`The ${role} start-barrier role was already prepared.`);
  }
  const roleRoot = join(controllerState.rootDirectory, role);
  const receiptDirectory = join(roleRoot, "receipt");
  const controlDirectory = join(roleRoot, "control");
  await mkdir(roleRoot, { mode: 0o700 });
  await mkdir(receiptDirectory, { mode: 0o700 });
  await mkdir(controlDirectory, { mode: LOCKED_CONTROL_DIRECTORY_MODE });
  const heldPath = join(receiptDirectory, "held.json");
  const heldCommitPath = join(receiptDirectory, "held.commit.json");
  const heldIdentity = await createHostOwnedReceiptSlot(heldPath);
  const heldCommitIdentity = await createHostOwnedReceiptSlot(heldCommitPath);
  await chmod(receiptDirectory, LOCKED_RECEIPT_DIRECTORY_MODE);
  await chmod(controlDirectory, LOCKED_CONTROL_DIRECTORY_MODE);
  const receiptDirectoryStat = await lstat(receiptDirectory, { bigint: true });
  if (
    !receiptDirectoryStat.isDirectory() ||
    receiptDirectoryStat.isSymbolicLink() ||
    (process.platform === "linux" &&
      (Number(receiptDirectoryStat.mode) & 0o777) !== LOCKED_RECEIPT_DIRECTORY_MODE)
  ) {
    throw new Error("The start-barrier receipt directory is unsafe.");
  }
  const controlDirectoryStat = await lstat(controlDirectory, { bigint: true });
  if (
    !controlDirectoryStat.isDirectory() ||
    controlDirectoryStat.isSymbolicLink() ||
    (process.platform === "linux" &&
      (Number(controlDirectoryStat.mode) & 0o777) !== LOCKED_CONTROL_DIRECTORY_MODE)
  ) {
    throw new Error("The start-barrier control directory is unsafe.");
  }

  const barrierId = token(controllerState.random);
  const containerRoot = `/run/policytwin-start-barrier/${role}`;
  const roleProtocol = Object.freeze({
    role,
    barrierId,
    runBindingSha256: controller.runBindingSha256,
  });
  const receiptMount = Object.freeze({
    source: receiptDirectory,
    target: `${containerRoot}/receipt`,
    readOnly: false,
  });
  const controlMount = Object.freeze({
    source: controlDirectory,
    target: `${containerRoot}/control`,
    readOnly: true,
  });
  const environment = Object.freeze({
    NODE_OPTIONS: "",
    POLICYTWIN_START_BARRIER_MODE: "REQUIRED_V1",
    POLICYTWIN_START_BARRIER_ROLE: role,
    POLICYTWIN_START_BARRIER_ID: barrierId,
    POLICYTWIN_START_BARRIER_RUN_BINDING_SHA256: controller.runBindingSha256,
    POLICYTWIN_START_BARRIER_RECEIPT_DIRECTORY: receiptMount.target,
    POLICYTWIN_START_BARRIER_CONTROL_DIRECTORY: controlMount.target,
    POLICYTWIN_START_BARRIER_HOLD_TIMEOUT_MS: String(controller.holdTimeoutMs),
    POLICYTWIN_START_BARRIER_POLL_INTERVAL_MS: String(controller.pollIntervalMs),
  });
  const prepared = Object.freeze({
    schemaVersion: "1" as const,
    status: "PREPARED_HELD_BARRIER" as const,
    roleProtocol,
    containerConfiguration: Object.freeze({
      entrypointPrefix: Object.freeze([
        "node",
        "scripts/role-start-barrier.mjs",
        "--",
      ]) as readonly ["node", "scripts/role-start-barrier.mjs", "--"],
      environment,
      receiptMount,
      controlMount,
    }),
    hostPaths: Object.freeze({ receiptDirectory, controlDirectory }),
  }) as unknown as PrivatePreparedLinuxStartBarrierRole;
  const preparedState: PreparedRoleState = {
    controllerState,
    prepared,
    heldPath,
    heldCommitPath,
    releasePath: join(controlDirectory, "release.json"),
    receiptDirectoryDevice: receiptDirectoryStat.dev,
    receiptDirectoryInode: receiptDirectoryStat.ino,
    heldIdentity,
    heldCommitIdentity,
    status: "PREPARED",
  };
  preparedRoleStates.set(prepared, preparedState);
  controllerState.preparedRoles.set(role, prepared);
  return prepared;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function freezeAndReadBoundedNoFollowJson(
  path: string,
  label: string,
  expectedIdentity: HostOwnedReceiptSlotIdentity,
) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1n ||
    before.size > 4_096n ||
    before.dev !== expectedIdentity.device ||
    before.ino !== expectedIdentity.inode ||
    before.uid !== expectedIdentity.uid ||
    (process.platform === "linux" &&
      (Number(before.mode) & 0o777) !== HOST_OWNED_RECEIPT_SLOT_MODE)
  ) {
    throw new Error(`${label} is unsafe.`);
  }
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.uid !== before.uid ||
      after.size !== before.size ||
      after.size > BigInt(MAX_PROTOCOL_BYTES)
    ) {
      throw new Error(`${label} changed identity.`);
    }
    await handle.chmod(0o444);
    const frozen = await handle.stat({ bigint: true });
    if (
      frozen.dev !== before.dev ||
      frozen.ino !== before.ino ||
      frozen.uid !== before.uid ||
      frozen.size !== before.size ||
      (process.platform === "linux" && (Number(frozen.mode) & 0o777) !== 0o444)
    ) {
      throw new Error(`${label} changed identity while it was frozen.`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_PROTOCOL_BYTES) throw new Error(`${label} is unsafe.`);
    try {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const value = JSON.parse(text) as unknown;
      return { value, device: frozen.dev, inode: frozen.ino, sha256 };
    } finally {
      bytes.fill(0);
    }
  } finally {
    await handle.close();
  }
}

function exactObjectKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export async function awaitPrivateLinuxStartBarrierHeld(
  controller: PrivateLinuxStartBarrierController,
  prepared: PrivatePreparedLinuxStartBarrierRole,
) {
  const state = requiredPreparedState(controller, prepared);
  if (state.status !== "PREPARED") {
    throw new Error("The start-barrier held receipt can be observed exactly once.");
  }
  state.status = "AWAITING";
  const deadline = Date.now() + controller.holdTimeoutMs;
  try {
    for (;;) {
      let commitSize = 0n;
      try {
        const commit = await lstat(state.heldCommitPath, { bigint: true });
        if (
          !commit.isFile() ||
          commit.isSymbolicLink() ||
          commit.dev !== state.heldCommitIdentity.device ||
          commit.ino !== state.heldCommitIdentity.inode ||
          commit.uid !== state.heldCommitIdentity.uid ||
          commit.size > BigInt(HELD_COMMIT_FRAME_BYTES)
        ) {
          throw new Error("The start-barrier held commit slot is unsafe.");
        }
        commitSize = commit.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("The host-owned start-barrier held commit slot disappeared.");
        }
        throw error;
      }
      if (commitSize === BigInt(HELD_COMMIT_FRAME_BYTES)) break;
      if (Date.now() >= deadline) throw new Error("The role start barrier timed out before hold.");
      await delay(controller.pollIntervalMs);
    }
    const frozenCommit = await freezeAndReadBoundedNoFollowJson(
      state.heldCommitPath,
      "The start-barrier held commit",
      state.heldCommitIdentity,
    );
    const commitValue = frozenCommit.value;
    if (
      typeof commitValue !== "object" ||
      commitValue === null ||
      !exactObjectKeys(commitValue, ["receiptSha256", "schemaVersion", "status"])
    ) {
      throw new Error("The start-barrier held commit is invalid.");
    }
    const commit = commitValue as Record<string, unknown>;
    if (
      commit.schemaVersion !== "1" ||
      commit.status !== "HELD_RECEIPT_COMMITTED" ||
      typeof commit.receiptSha256 !== "string" ||
      !SHA256.test(commit.receiptSha256)
    ) {
      throw new Error("The start-barrier held commit is invalid.");
    }
    const frozenReceipt = await freezeAndReadBoundedNoFollowJson(
      state.heldPath,
      "The start-barrier held receipt",
      state.heldIdentity,
    );
    if (frozenReceipt.sha256 !== commit.receiptSha256) {
      throw new Error("The start-barrier held receipt does not match its commit.");
    }
    const value = frozenReceipt.value;
    if (
      typeof value !== "object" ||
      value === null ||
      !exactObjectKeys(value, [
        "barrierId",
        "namespacePid",
        "role",
        "runBindingSha256",
        "schemaVersion",
        "status",
      ])
    ) {
      throw new Error("The start-barrier held receipt is invalid.");
    }
    const receipt = value as Record<string, unknown>;
    if (
      receipt.schemaVersion !== "1" ||
      receipt.status !== "HELD_BEFORE_ROLE_EXECUTION" ||
      receipt.role !== prepared.roleProtocol.role ||
      receipt.barrierId !== prepared.roleProtocol.barrierId ||
      receipt.runBindingSha256 !== prepared.roleProtocol.runBindingSha256 ||
      !Number.isSafeInteger(receipt.namespacePid) ||
      (receipt.namespacePid as number) < 1
    ) {
      throw new Error("The start-barrier held receipt is invalid.");
    }
    await chmod(prepared.hostPaths.receiptDirectory, LOCKED_RECEIPT_DIRECTORY_MODE);
    const [receiptDirectoryAfter, heldAfter, heldCommitAfter] = await Promise.all([
      lstat(prepared.hostPaths.receiptDirectory, { bigint: true }),
      lstat(state.heldPath, { bigint: true }),
      lstat(state.heldCommitPath, { bigint: true }),
    ]);
    if (
      !receiptDirectoryAfter.isDirectory() ||
      receiptDirectoryAfter.isSymbolicLink() ||
      receiptDirectoryAfter.dev !== state.receiptDirectoryDevice ||
      receiptDirectoryAfter.ino !== state.receiptDirectoryInode ||
      (process.platform === "linux" && (Number(receiptDirectoryAfter.mode) & 0o222) !== 0) ||
      !heldAfter.isFile() ||
      heldAfter.isSymbolicLink() ||
      heldAfter.dev !== frozenReceipt.device ||
      heldAfter.ino !== frozenReceipt.inode ||
      !heldCommitAfter.isFile() ||
      heldCommitAfter.isSymbolicLink() ||
      heldCommitAfter.dev !== frozenCommit.device ||
      heldCommitAfter.ino !== frozenCommit.inode
    ) {
      throw new Error("The start-barrier receipt changed identity while its directory was locked.");
    }
    state.status = "HELD";
    return Object.freeze({
      schemaVersion: "1" as const,
      status: "HELD_BEFORE_ROLE_EXECUTION" as const,
      role: prepared.roleProtocol.role,
      barrierId: prepared.roleProtocol.barrierId,
      runBindingSha256: prepared.roleProtocol.runBindingSha256,
      namespacePid: receipt.namespacePid as number,
    });
  } catch (error) {
    state.status = "FAILED";
    throw error;
  }
}

async function writeAtomicProtocolFile(
  path: string,
  value: object,
  random: (size: number) => Buffer,
  beforePublish: () => Promise<void>,
) {
  const temporaryPath = `${path}.${token(random)}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.byteLength > MAX_PROTOCOL_BYTES) {
    throw new Error("The start-barrier protocol frame is too large.");
  }
  const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o444);
    const prepared = await handle.stat({ bigint: true });
    if (
      !prepared.isFile() ||
      prepared.size !== BigInt(bytes.byteLength) ||
      (process.platform === "linux" && (Number(prepared.mode) & 0o777) !== 0o444)
    ) {
      throw new Error("The start-barrier release frame was not prepared safely.");
    }
    await beforePublish();
  } finally {
    bytes.fill(0);
    await handle.close();
  }
  await rename(temporaryPath, path);
}

export async function releasePrivateLinuxStartBarrierRole(
  controller: PrivateLinuxStartBarrierController,
  prepared: PrivatePreparedLinuxStartBarrierRole,
) {
  const state = requiredPreparedState(controller, prepared);
  if (state.status === "RELEASED") {
    throw new Error("The role start barrier was already released.");
  }
  if (state.status === "RELEASING") {
    throw new Error("The role start barrier release is already in progress.");
  }
  if (state.status !== "HELD") {
    throw new Error("The role start barrier must be observed as held before release.");
  }
  state.status = "RELEASING";
  try {
    const release = Object.freeze({
      schemaVersion: "1" as const,
      status: "RELEASED_BY_HOST_SUPERVISOR" as const,
      role: prepared.roleProtocol.role,
      barrierId: prepared.roleProtocol.barrierId,
      runBindingSha256: prepared.roleProtocol.runBindingSha256,
      releaseNonce: token(state.controllerState.random),
    });
    await writeAtomicProtocolFile(
      state.releasePath,
      release,
      state.controllerState.random,
      state.controllerState.beforeReleasePublish,
    );
    state.status = "RELEASED";
    return release;
  } catch (error) {
    state.status = "FAILED";
    throw error;
  }
}

export async function destroyPrivateLinuxStartBarrierController(
  controller: PrivateLinuxStartBarrierController,
) {
  const state = requiredControllerState(controller);
  const current = await lstat(state.rootDirectory, { bigint: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  state.destroyed = true;
  if (current === undefined) return;
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== state.rootDevice ||
    current.ino !== state.rootInode ||
    (await realpath(state.rootDirectory)) !== state.rootRealPath ||
    resolve(state.rootDirectory) !== state.rootDirectory
  ) {
    throw new Error("The start-barrier root changed identity before cleanup.");
  }
  for (const prepared of state.preparedRoles.values()) {
    const preparedState = preparedRoleStates.get(prepared);
    if (preparedState === undefined) {
      throw new Error("The start-barrier role identity disappeared before cleanup.");
    }
    const receiptDirectory = prepared.hostPaths.receiptDirectory;
    const receiptDirectoryStat = await lstat(receiptDirectory, { bigint: true });
    if (
      !receiptDirectoryStat.isDirectory() ||
      receiptDirectoryStat.isSymbolicLink() ||
      receiptDirectoryStat.dev !== preparedState.receiptDirectoryDevice ||
      receiptDirectoryStat.ino !== preparedState.receiptDirectoryInode
    ) {
      throw new Error("The start-barrier receipt directory changed identity before cleanup.");
    }
    await chmod(receiptDirectory, 0o700);
  }
  await rm(state.rootDirectory, { recursive: true, force: false });
}
