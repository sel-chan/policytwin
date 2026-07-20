import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const LOCK_ROOT_NAME = "local-challenge-lock";
const ACTIVE_NAME = "active";
const OWNER_FILE_NAME = "owner.json";
const CANDIDATE_PATTERN = /^candidate-([0-9a-f]{32})$/u;
const RETIRED_PATTERN = /^retired-([0-9a-f]{32})$/u;
const activeHandles = new WeakMap();

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function realDirectory(path, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return { path: realpathSync.native(path), stat };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function repositoryLockState(repositoryRoot) {
  const repository = realDirectory(resolve(repositoryRoot), "Local challenge repository root");
  const temporaryPath = resolve(repository.path, ".tmp");
  try {
    mkdirSync(temporaryPath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const temporary = realDirectory(temporaryPath, "Local challenge temporary root");
  if (
    !samePath(dirname(temporary.path), repository.path) ||
    basename(temporary.path) !== ".tmp"
  ) {
    throw new Error("Local challenge temporary root must be the repository .tmp directory.");
  }

  const rootPath = resolve(temporary.path, LOCK_ROOT_NAME);
  try {
    mkdirSync(rootPath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const lockRoot = realDirectory(rootPath, "Local challenge lock root");
  if (
    !samePath(dirname(lockRoot.path), temporary.path) ||
    basename(lockRoot.path) !== LOCK_ROOT_NAME
  ) {
    throw new Error("Local challenge lock root escaped the fixed repository path.");
  }
  return {
    activePath: resolve(lockRoot.path, ACTIVE_NAME),
    lockRoot: lockRoot.path,
    repositoryId: createHash("sha256").update(repository.path).digest("hex"),
  };
}

function exactOwner(value, repositoryId) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Local challenge lock owner record must be an object.");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "nonce,pid,repositoryId,schemaVersion,startedAt") {
    throw new Error("Local challenge lock owner record has an invalid field set.");
  }
  if (
    value.schemaVersion !== "1" ||
    value.repositoryId !== repositoryId ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !/^[0-9a-f]{32}$/u.test(value.nonce) ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt))
  ) {
    throw new Error("Local challenge lock owner record is invalid.");
  }
  return value;
}

function observeOwnedDirectory(path, expectedPattern, repositoryId, label) {
  const directory = realDirectory(path, label);
  const nameMatch = expectedPattern.exec(basename(directory.path));
  if (nameMatch === null) {
    throw new Error(`${label} name is invalid.`);
  }
  const entries = readdirSync(directory.path, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== OWNER_FILE_NAME ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) {
    throw new Error(`${label} must contain only its regular owner record.`);
  }
  const ownerPath = resolve(directory.path, OWNER_FILE_NAME);
  const ownerStat = lstatSync(ownerPath);
  if (
    !ownerStat.isFile() ||
    ownerStat.isSymbolicLink() ||
    ownerStat.size < 64 ||
    ownerStat.size > 1_024
  ) {
    throw new Error(`${label} owner record is not a bounded regular file.`);
  }
  const ownerBytes = readFileSync(ownerPath, "utf8");
  const owner = exactOwner(JSON.parse(ownerBytes), repositoryId);
  if (nameMatch[1] !== undefined && nameMatch[1] !== owner.nonce) {
    throw new Error(`${label} name does not match its owner nonce.`);
  }
  return {
    directory: directory.path,
    directoryStat: directory.stat,
    owner,
    ownerBytes,
    ownerPath,
    ownerStat,
  };
}

function writeOwner(directory, owner) {
  const ownerPath = resolve(directory, OWNER_FILE_NAME);
  const ownerBytes = `${JSON.stringify(owner)}\n`;
  const descriptor = openSync(ownerPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, ownerBytes, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return ownerBytes;
}

function removeOwnedCandidate(observed) {
  const current = observeOwnedDirectory(
    observed.directory,
    CANDIDATE_PATTERN,
    observed.owner.repositoryId,
    "Local challenge lock candidate",
  );
  if (
    !sameIdentity(current.directoryStat, observed.directoryStat) ||
    current.ownerBytes !== observed.ownerBytes
  ) {
    throw new Error("Refusing to remove a changed local challenge lock candidate.");
  }
  unlinkSync(current.ownerPath);
  rmdirSync(current.directory);
}

function ownerIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw new Error("Local challenge lock owner liveness is ambiguous; refusing recovery.", {
      cause: error,
    });
  }
}

function retireObservedActiveLock(state, observed, label) {
  const retiredPath = resolve(state.lockRoot, `retired-${observed.owner.nonce}`);
  if (lstatIfPresent(retiredPath) !== null) {
    throw new Error("A retired local challenge lock tombstone already exists; refusing recovery.");
  }
  try {
    renameSync(state.activePath, retiredPath);
  } catch (error) {
    if (lstatIfPresent(retiredPath) !== null) return false;
    throw error;
  }
  const retired = observeOwnedDirectory(
    retiredPath,
    RETIRED_PATTERN,
    state.repositoryId,
    label,
  );
  if (
    !sameIdentity(retired.ownerStat, observed.ownerStat) ||
    retired.ownerBytes !== observed.ownerBytes
  ) {
    throw new Error("Recovered local challenge lock tombstone changed during recovery.");
  }
  return retired;
}

function createCandidate(state) {
  const nonce = randomBytes(16).toString("hex");
  const candidatePath = resolve(state.lockRoot, `candidate-${nonce}`);
  mkdirSync(candidatePath, { recursive: false, mode: 0o700 });
  const candidateDirectory = realDirectory(candidatePath, "New local challenge lock candidate");
  if (
    !samePath(candidateDirectory.path, candidatePath) ||
    !samePath(dirname(candidateDirectory.path), state.lockRoot)
  ) {
    throw new Error("New local challenge lock candidate escaped the fixed lock root.");
  }
  const owner = {
    schemaVersion: "1",
    repositoryId: state.repositoryId,
    pid: process.pid,
    nonce,
    startedAt: new Date().toISOString(),
  };
  writeOwner(candidateDirectory.path, owner);
  return observeOwnedDirectory(
    candidateDirectory.path,
    CANDIDATE_PATTERN,
    state.repositoryId,
    "New local challenge lock candidate",
  );
}

export function acquireLocalChallengeRunLock(repositoryRoot) {
  const state = repositoryLockState(repositoryRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (lstatIfPresent(state.activePath) !== null) {
      const observed = observeOwnedDirectory(
        state.activePath,
        /^active$/u,
        state.repositoryId,
        "Active local challenge run lock",
      );
      if (ownerIsAlive(observed.owner.pid)) {
        throw new Error("Another LOCAL_CHALLENGE operation is active.");
      }
      throw new Error(
        `An unrecovered LOCAL_CHALLENGE lock remains for nonce ${observed.owner.nonce}; explicit operator-reviewed retirement is required.`,
      );
    }
    const candidate = createCandidate(state);
    try {
      renameSync(candidate.directory, state.activePath);
    } catch (error) {
      try {
        removeOwnedCandidate(candidate);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Local challenge lock publication failed and its owned candidate was preserved.",
        );
      }
      if (lstatIfPresent(state.activePath) !== null) continue;
      throw error;
    }
    const active = observeOwnedDirectory(
      state.activePath,
      /^active$/u,
      state.repositoryId,
      "Published local challenge run lock",
    );
    if (
      !sameIdentity(active.ownerStat, candidate.ownerStat) ||
      active.ownerBytes !== candidate.ownerBytes
    ) {
      throw new Error("Published local challenge run lock changed during acquisition.");
    }
    const handle = Object.freeze({
      schemaVersion: "1",
      scope: "LOCAL_CHALLENGE_RUN_LOCK",
    });
    activeHandles.set(handle, { ...state, active });
    return handle;
  }
  throw new Error("Local challenge run lock could not be acquired after bounded recovery.");
}

export function retireLocalChallengeRunLockAfterOperatorReview(
  repositoryRoot,
  {
    expectedNonce,
    confirmedNoDescendantProcesses = false,
  } = {},
) {
  if (
    confirmedNoDescendantProcesses !== true ||
    typeof expectedNonce !== "string" ||
    !/^[0-9a-f]{32}$/u.test(expectedNonce)
  ) {
    throw new Error(
      "Operator-reviewed lock retirement requires the exact nonce and explicit confirmation that no descendant process remains.",
    );
  }
  const state = repositoryLockState(repositoryRoot);
  if (lstatIfPresent(state.activePath) === null) {
    throw new Error("No active local challenge run lock exists for operator retirement.");
  }
  const observed = observeOwnedDirectory(
    state.activePath,
    /^active$/u,
    state.repositoryId,
    "Operator-reviewed local challenge run lock",
  );
  if (observed.owner.nonce !== expectedNonce) {
    throw new Error("Operator-reviewed local challenge lock nonce does not match.");
  }
  if (ownerIsAlive(observed.owner.pid)) {
    throw new Error("Operator-reviewed local challenge lock owner is still alive.");
  }
  retireObservedActiveLock(
    state,
    observed,
    "Operator-retired local challenge lock tombstone",
  );
  return Object.freeze({
    schemaVersion: "1",
    status: "RETIRED_AFTER_OPERATOR_REVIEW",
    nonce: observed.owner.nonce,
    automatedDescendantProof: false,
  });
}

export function releaseLocalChallengeRunLock(handle) {
  const state = activeHandles.get(handle);
  if (state === undefined) {
    throw new Error("Local challenge run lock handle is unknown or already released.");
  }
  const current = observeOwnedDirectory(
    state.activePath,
    /^active$/u,
    state.repositoryId,
    "Active local challenge run lock",
  );
  if (
    current.owner.pid !== process.pid ||
    !sameIdentity(current.ownerStat, state.active.ownerStat) ||
    current.ownerBytes !== state.active.ownerBytes
  ) {
    throw new Error("Local challenge run lock ownership changed before release.");
  }
  const retiredPath = resolve(state.lockRoot, `retired-${current.owner.nonce}`);
  if (lstatIfPresent(retiredPath) !== null) {
    throw new Error("Local challenge run lock retirement tombstone already exists.");
  }
  renameSync(state.activePath, retiredPath);
  const retired = observeOwnedDirectory(
    retiredPath,
    RETIRED_PATTERN,
    state.repositoryId,
    "Released local challenge lock tombstone",
  );
  if (
    !sameIdentity(retired.ownerStat, current.ownerStat) ||
    retired.ownerBytes !== current.ownerBytes
  ) {
    throw new Error("Released local challenge lock tombstone changed during release.");
  }
  activeHandles.delete(handle);
}

function combinedFailure(operationError, releaseError) {
  if (operationError === undefined) return releaseError;
  return new AggregateError(
    [operationError, releaseError],
    "Local challenge operation and run-lock release both failed.",
  );
}

export async function withLocalChallengeRunLock(repositoryRoot, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Local challenge run lock operation must be a function.");
  }
  const handle = acquireLocalChallengeRunLock(repositoryRoot);
  let operationError;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseLocalChallengeRunLock(handle);
    } catch (releaseError) {
      throw combinedFailure(operationError, releaseError);
    }
  }
}

export function withLocalChallengeRunLockSync(repositoryRoot, operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Local challenge run lock operation must be a function.");
  }
  const handle = acquireLocalChallengeRunLock(repositoryRoot);
  let operationError;
  try {
    return operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      releaseLocalChallengeRunLock(handle);
    } catch (releaseError) {
      throw combinedFailure(operationError, releaseError);
    }
  }
}
