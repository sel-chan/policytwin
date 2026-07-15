import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const DOCKER_ID = /^[0-9a-f]{64}$/u;
const CGROUP_ROOT = "/sys/fs/cgroup";
const MAX_TEXT_BYTES = 64 * 1024;

function boundedText(path, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TEXT_BYTES) {
    throw new Error(`${label} is unsafe.`);
  }
  return readFileSync(path, "utf8");
}

function parseProcessIds(value) {
  const ids = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!/^[1-9][0-9]{0,9}$/u.test(line)) {
        throw new Error("The cgroup process list is invalid.");
      }
      return Number(line);
    });
  if (new Set(ids).size !== ids.length) {
    throw new Error("The cgroup process list contains duplicates.");
  }
  return ids.sort((left, right) => left - right);
}

function parseCpuUsageUsec(value) {
  const usageLines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("usage_usec "));
  if (usageLines.length !== 1) throw new Error("The cgroup CPU usage is invalid.");
  const raw = usageLines[0].slice("usage_usec ".length);
  if (!/^(?:0|[1-9][0-9]{0,18})$/u.test(raw)) {
    throw new Error("The cgroup CPU usage is invalid.");
  }
  const usageUsec = Number(raw);
  if (!Number.isSafeInteger(usageUsec)) throw new Error("The cgroup CPU usage is invalid.");
  return usageUsec;
}

function canonicalCgroupPath(relativePath, containerId) {
  if (
    !relativePath.startsWith("/") ||
    relativePath.includes("\0") ||
    relativePath.split("/").includes("..") ||
    !relativePath.includes(containerId)
  ) {
    throw new Error("The container cgroup identity is not bound to its Docker ID.");
  }
  const candidate = resolve(CGROUP_ROOT, `.${relativePath}`);
  const containment = relative(CGROUP_ROOT, candidate);
  if (containment.length === 0 || containment.startsWith("..") || isAbsolute(containment)) {
    throw new Error("The container cgroup path escapes the cgroup root.");
  }
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(candidate) !== candidate) {
    throw new Error("The container cgroup path is unsafe.");
  }
  return candidate;
}

export function observeLinuxCgroupV2(pid, containerId) {
  if (process.platform !== "linux") {
    throw new Error("Cgroup process-tree observation requires a Linux supervisor.");
  }
  if (!Number.isInteger(pid) || pid < 1 || !DOCKER_ID.test(containerId)) {
    throw new Error("The container process identity is invalid.");
  }
  const membership = boundedText(`/proc/${pid}/cgroup`, "Container cgroup membership")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (membership.length !== 1 || !membership[0].startsWith("0::")) {
    throw new Error("The supervisor requires a single cgroup v2 hierarchy.");
  }
  const path = canonicalCgroupPath(membership[0].slice(3), containerId);
  const processIds = parseProcessIds(boundedText(resolve(path, "cgroup.procs"), "Cgroup processes"));
  if (!processIds.includes(pid)) {
    throw new Error("The observed container PID is not in its bound cgroup.");
  }
  const cpuUsageUsec = parseCpuUsageUsec(
    boundedText(resolve(path, "cpu.stat"), "Cgroup CPU statistics"),
  );
  return Object.freeze({
    schemaVersion: "1",
    containerId,
    initialPid: pid,
    path,
    initialProcessIds: processIds,
    initialCpuUsageUsec: cpuUsageUsec,
  });
}

export function readLinuxCgroupCpuUsageUsec(observation) {
  if (observation?.schemaVersion !== "1" || !DOCKER_ID.test(observation.containerId)) {
    throw new Error("The cgroup observation is invalid.");
  }
  return parseCpuUsageUsec(
    boundedText(resolve(observation.path, "cpu.stat"), "Cgroup CPU statistics"),
  );
}

export function assertLinuxCgroupProcessTreeEmpty(observation) {
  if (observation?.schemaVersion !== "1" || !DOCKER_ID.test(observation.containerId)) {
    throw new Error("The cgroup observation is invalid.");
  }
  if (lstatSync(`/proc/${observation.initialPid}`, { throwIfNoEntry: false }) !== undefined) {
    throw new Error("The original container init PID still exists or was reused.");
  }
  const stat = lstatSync(observation.path, { throwIfNoEntry: false });
  if (stat === undefined) return true;
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(observation.path) !== observation.path) {
    throw new Error("The observed cgroup path changed identity.");
  }
  const processIds = parseProcessIds(
    boundedText(resolve(observation.path, "cgroup.procs"), "Cgroup processes"),
  );
  if (processIds.length !== 0) {
    throw new Error("The container cgroup still contains processes.");
  }
  return true;
}
