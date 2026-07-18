import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { posix } from "node:path";
import { TextDecoder } from "node:util";

const DOCKER_ID = /^[0-9a-f]{64}$/u;
const SAFE_CGROUP_SEGMENT = /^[A-Za-z0-9_.:@-]+$/u;
const CGROUP_ROOT = "/sys/fs/cgroup";
const CGROUP2_SUPER_MAGIC = 0x6367_7270n;
const MAX_TEXT_BYTES = 64 * 1024;
const UINT64_MAX = (1n << 64n) - 1n;
const observations = new WeakMap();

function requiredLinuxOpenFlag(name) {
  const value = constants[name];
  if (!Number.isInteger(value)) {
    throw new Error(`The Linux ${name} file-open flag is unavailable.`);
  }
  return value;
}

export function readBoundedLinuxCgroupText(readChunk, label = "Cgroup text") {
  if (typeof readChunk !== "function" || typeof label !== "string" || label.length === 0) {
    throw new Error("The bounded cgroup text reader is invalid.");
  }
  const chunks = [];
  let totalBytes = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(Math.min(4096, MAX_TEXT_BYTES + 1 - totalBytes));
    const bytesRead = readChunk(buffer);
    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length) {
      throw new Error(`${label} is unsafe.`);
    }
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > MAX_TEXT_BYTES) throw new Error(`${label} is unsafe.`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
  } catch {
    throw new Error(`${label} is unsafe.`);
  }
}

function boundedTextFromOpenFile(fileDescriptor, label) {
  const stat = fstatSync(fileDescriptor);
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) {
    throw new Error(`${label} is unsafe.`);
  }
  return readBoundedLinuxCgroupText(
    (buffer) => readSync(fileDescriptor, buffer, 0, buffer.length, null),
    label,
  );
}

function boundedText(path, label) {
  const fileDescriptor = openSync(
    path,
    constants.O_RDONLY | requiredLinuxOpenFlag("O_NOFOLLOW"),
  );
  try {
    return boundedTextFromOpenFile(fileDescriptor, label);
  } finally {
    closeSync(fileDescriptor);
  }
}

function boundedCgroupText(state, name, label) {
  if (name !== "cgroup.events" && name !== "cgroup.procs" && name !== "cpu.stat") {
    throw new Error("The cgroup observation file is not allowlisted.");
  }
  return boundedText(`/proc/self/fd/${state.directoryFileDescriptor}/${name}`, label);
}

function parseProcessIds(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("The cgroup process list is invalid.");
  }
  const ids = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!/^[1-9][0-9]{0,9}$/u.test(line)) {
        throw new Error("The cgroup process list is invalid.");
      }
      const processId = Number(line);
      if (!Number.isSafeInteger(processId)) {
        throw new Error("The cgroup process list is invalid.");
      }
      return processId;
    });
  if (new Set(ids).size !== ids.length) {
    throw new Error("The cgroup process list contains duplicates.");
  }
  return Object.freeze(ids.sort((left, right) => left - right));
}

export function parseLinuxCgroupCpuUsageUsec(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("The cgroup CPU usage is invalid.");
  }
  const usageLines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("usage_usec "));
  if (usageLines.length !== 1) throw new Error("The cgroup CPU usage is invalid.");
  const raw = usageLines[0].slice("usage_usec ".length);
  if (!/^(?:0|[1-9][0-9]{0,19})$/u.test(raw)) {
    throw new Error("The cgroup CPU usage is invalid.");
  }
  const usageUsec = BigInt(raw);
  if (usageUsec > UINT64_MAX) throw new Error("The cgroup CPU usage is invalid.");
  return usageUsec;
}

export function parseLinuxCgroupPopulated(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("The cgroup populated state is invalid.");
  }
  const populatedLines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("populated "));
  if (populatedLines.length !== 1 || !/^populated [01]$/u.test(populatedLines[0])) {
    throw new Error("The cgroup populated state is invalid.");
  }
  return populatedLines[0] === "populated 1";
}

export function canonicalLinuxDockerCgroupRelativePath(relativePath, containerId) {
  if (!DOCKER_ID.test(containerId)) {
    throw new Error("The container cgroup identity is invalid.");
  }
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith("/") ||
    relativePath.length < 2 ||
    relativePath.endsWith("/") ||
    relativePath.includes("//") ||
    relativePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(relativePath)
  ) {
    throw new Error("The container cgroup identity is invalid.");
  }
  const segments = relativePath.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SAFE_CGROUP_SEGMENT.test(segment),
    )
  ) {
    throw new Error("The container cgroup identity is invalid.");
  }
  const directIdentityIndexes = segments.flatMap((segment, index) =>
    segment === containerId ? [index] : [],
  );
  const scopeIdentityIndexes = segments.flatMap((segment, index) =>
    segment === `docker-${containerId}.scope` ? [index] : [],
  );
  const directIdentityIsCanonical =
    directIdentityIndexes.length === 1 &&
    scopeIdentityIndexes.length === 0 &&
    directIdentityIndexes[0] === segments.length - 1 &&
    segments.at(-2) === "docker";
  const scopeIdentityIsCanonical =
    scopeIdentityIndexes.length === 1 &&
    directIdentityIndexes.length === 0 &&
    scopeIdentityIndexes[0] === segments.length - 1;
  if (!directIdentityIsCanonical && !scopeIdentityIsCanonical) {
    throw new Error("The container cgroup identity is not bound to its Docker ID.");
  }
  return `/${segments.join("/")}`;
}

function canonicalCgroupPath(relativePath, containerId) {
  const canonicalRelativePath = canonicalLinuxDockerCgroupRelativePath(relativePath, containerId);
  const candidate = posix.resolve(CGROUP_ROOT, `.${canonicalRelativePath}`);
  const containment = posix.relative(CGROUP_ROOT, candidate);
  if (containment.length === 0 || containment.startsWith("..") || posix.isAbsolute(containment)) {
    throw new Error("The container cgroup path escapes the cgroup root.");
  }
  return candidate;
}

function validateCgroupV2RootIdentity(realPath, fileSystemType) {
  if (realPath !== CGROUP_ROOT) {
    throw new Error("The cgroup root is not canonical.");
  }
  if (fileSystemType !== CGROUP2_SUPER_MAGIC) {
    throw new Error("The supervisor requires a cgroup v2 filesystem.");
  }
}

function validateCgroupV2Root() {
  validateCgroupV2RootIdentity(
    realpathSync.native(CGROUP_ROOT),
    statfsSync(CGROUP_ROOT, { bigint: true }).type,
  );
}

export function validateLinuxCgroupV2SupervisorPreflight({
  platform,
  cgroupRootRealPath,
  cgroupFileSystemType,
  supervisorMembership,
}) {
  if (platform !== "linux") {
    throw new Error("Cgroup process-tree observation requires a Linux supervisor.");
  }
  validateCgroupV2RootIdentity(cgroupRootRealPath, cgroupFileSystemType);
  if (
    typeof supervisorMembership !== "string" ||
    Buffer.byteLength(supervisorMembership, "utf8") > MAX_TEXT_BYTES
  ) {
    throw new Error("The supervisor cgroup membership is invalid.");
  }
  const membership = supervisorMembership
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    membership.length !== 1 ||
    !/^0::\/[A-Za-z0-9_.:@\/-]*$/u.test(membership[0]) ||
    membership[0].includes("//") ||
    membership[0].includes("/../") ||
    membership[0].endsWith("/..")
  ) {
    throw new Error("The supervisor requires a single cgroup v2 hierarchy.");
  }
  return true;
}

export function assertLinuxCgroupV2SupervisorPreflight() {
  if (process.platform !== "linux") {
    throw new Error("Cgroup process-tree observation requires a Linux supervisor.");
  }
  return validateLinuxCgroupV2SupervisorPreflight({
    platform: process.platform,
    cgroupRootRealPath: realpathSync.native(CGROUP_ROOT),
    cgroupFileSystemType: statfsSync(CGROUP_ROOT, { bigint: true }).type,
    supervisorMembership: boundedText("/proc/self/cgroup", "Supervisor cgroup membership"),
  });
}

function openPinnedCgroupDirectory(path) {
  const pathStat = lstatSync(path, { bigint: true });
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new Error("The container cgroup path is unsafe.");
  }
  const directoryFileDescriptor = openSync(
    path,
    constants.O_RDONLY |
      requiredLinuxOpenFlag("O_DIRECTORY") |
      requiredLinuxOpenFlag("O_NOFOLLOW"),
  );
  try {
    const descriptorStat = fstatSync(directoryFileDescriptor, { bigint: true });
    if (
      !descriptorStat.isDirectory() ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino ||
      realpathSync.native(path) !== path ||
      realpathSync.native(`/proc/self/fd/${directoryFileDescriptor}`) !== path ||
      statfsSync(path, { bigint: true }).type !== CGROUP2_SUPER_MAGIC
    ) {
      throw new Error("The container cgroup path changed identity during observation.");
    }
    return {
      directoryFileDescriptor,
      device: descriptorStat.dev,
      inode: descriptorStat.ino,
    };
  } catch (error) {
    closeSync(directoryFileDescriptor);
    throw error;
  }
}

function requiredObservationState(observation) {
  const state =
    typeof observation === "object" && observation !== null
      ? observations.get(observation)
      : undefined;
  if (state === undefined || state.closed) {
    throw new Error("The cgroup observation was not issued by this observer or was already finalized.");
  }
  return state;
}

function observePinnedPath(state) {
  const stat = lstatSync(state.path, { bigint: true, throwIfNoEntry: false });
  if (stat === undefined) return "ABSENT";
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.dev !== state.device ||
    stat.ino !== state.inode ||
    realpathSync.native(state.path) !== state.path
  ) {
    throw new Error("The observed cgroup path changed identity.");
  }
  return "PRESENT";
}

function closeObservationState(state) {
  if (state.closed) {
    throw new Error("The cgroup observation was already finalized.");
  }
  state.closed = true;
  closeSync(state.directoryFileDescriptor);
}

export function isLinuxCgroupCpuUsageWithinBudget(initialUsageUsec, finalUsageUsec, budgetMs) {
  if (
    typeof initialUsageUsec !== "bigint" ||
    typeof finalUsageUsec !== "bigint" ||
    initialUsageUsec < 0n ||
    initialUsageUsec > UINT64_MAX ||
    finalUsageUsec < 0n ||
    finalUsageUsec > UINT64_MAX ||
    !Number.isSafeInteger(budgetMs) ||
    budgetMs < 0
  ) {
    throw new Error("The cgroup CPU budget is invalid.");
  }
  return (
    finalUsageUsec >= initialUsageUsec &&
    finalUsageUsec - initialUsageUsec <= BigInt(budgetMs) * 1_000n
  );
}

export function observeLinuxCgroupV2(pid, containerId) {
  if (process.platform !== "linux") {
    throw new Error("Cgroup process-tree observation requires a Linux supervisor.");
  }
  if (!Number.isSafeInteger(pid) || pid < 1 || !DOCKER_ID.test(containerId)) {
    throw new Error("The container process identity is invalid.");
  }
  validateCgroupV2Root();
  const membership = boundedText(`/proc/${pid}/cgroup`, "Container cgroup membership")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (membership.length !== 1 || !membership[0].startsWith("0::")) {
    throw new Error("The supervisor requires a single cgroup v2 hierarchy.");
  }
  const path = canonicalCgroupPath(membership[0].slice(3), containerId);
  const pinned = openPinnedCgroupDirectory(path);
  const state = {
    closed: false,
    containerId,
    initialPid: pid,
    path,
    ...pinned,
  };
  try {
    const processIds = parseProcessIds(
      boundedCgroupText(state, "cgroup.procs", "Cgroup processes"),
    );
    if (!processIds.includes(pid)) {
      throw new Error("The observed container PID is not in its bound cgroup.");
    }
    if (!parseLinuxCgroupPopulated(boundedCgroupText(state, "cgroup.events", "Cgroup events"))) {
      throw new Error("The observed container cgroup is not populated.");
    }
    const cpuUsageUsec = parseLinuxCgroupCpuUsageUsec(
      boundedCgroupText(state, "cpu.stat", "Cgroup CPU statistics"),
    );
    if (observePinnedPath(state) !== "PRESENT") {
      throw new Error("The observed cgroup path disappeared during observation.");
    }
    const observation = Object.freeze({
      schemaVersion: "2",
      containerId,
      initialPid: pid,
      path,
      cgroupDevice: state.device.toString(),
      cgroupInode: state.inode.toString(),
      initialProcessIds: processIds,
      initialCpuUsageUsec: cpuUsageUsec,
    });
    observations.set(observation, state);
    return observation;
  } catch (error) {
    closeObservationState(state);
    throw error;
  }
}

export function readLinuxCgroupCpuUsageUsec(observation) {
  const state = requiredObservationState(observation);
  if (observePinnedPath(state) !== "PRESENT") {
    throw new Error("The observed cgroup path disappeared before its final CPU sample.");
  }
  const populated = parseLinuxCgroupPopulated(
    boundedCgroupText(state, "cgroup.events", "Cgroup events"),
  );
  const processIds = parseProcessIds(
    boundedCgroupText(state, "cgroup.procs", "Cgroup processes"),
  );
  if (populated || processIds.length !== 0) {
    throw new Error("The cgroup subtree is not quiescent before its final CPU sample.");
  }
  const usageUsec = parseLinuxCgroupCpuUsageUsec(
    boundedCgroupText(state, "cpu.stat", "Cgroup CPU statistics"),
  );
  if (observePinnedPath(state) !== "PRESENT") {
    throw new Error("The observed cgroup path changed during its final CPU sample.");
  }
  return usageUsec;
}

export function assertLinuxCgroupSubtreeQuiescent(observation) {
  const state = requiredObservationState(observation);
  try {
    if (lstatSync(`/proc/${state.initialPid}`, { throwIfNoEntry: false }) !== undefined) {
      throw new Error("The original container init PID still exists or was reused.");
    }
    const before = observePinnedPath(state);
    if (before === "ABSENT") {
      if (observePinnedPath(state) !== "ABSENT") {
        throw new Error("The observed cgroup path reappeared during teardown observation.");
      }
      return Object.freeze({
        subtreeQuiescent: true,
        initialPidAbsent: true,
        originalCgroupReleased: true,
      });
    }
    const populated = parseLinuxCgroupPopulated(
      boundedCgroupText(state, "cgroup.events", "Cgroup events"),
    );
    const processIds = parseProcessIds(
      boundedCgroupText(state, "cgroup.procs", "Cgroup processes"),
    );
    if (observePinnedPath(state) !== "PRESENT") {
      throw new Error("The observed cgroup path changed during teardown observation.");
    }
    if (populated || processIds.length !== 0) {
      throw new Error("The container cgroup or one of its descendants still contains processes.");
    }
    return Object.freeze({
      subtreeQuiescent: true,
      initialPidAbsent: true,
      originalCgroupReleased: false,
    });
  } finally {
    closeObservationState(state);
  }
}
