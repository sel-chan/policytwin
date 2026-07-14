import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { BASELINE_FIXTURE, directoryHash } from "./fixture.mjs";
import { ROOT } from "./process.mjs";

export const REPAIR_RUNS_ROOT = resolve(ROOT, ".tmp", "refund-demo", "repair-runs");
const TRANSIENT_DIRECTORIES = new Set([".tmp", "dist", "node_modules"]);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

function validateRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) {
    throw new Error("Repair run ID must use 1-64 safe ASCII letters, digits, underscores, or hyphens.");
  }
  return runId;
}

function assertContainedRunPath(path, expectedBasename) {
  const resolved = resolve(path);
  const relativePath = relative(REPAIR_RUNS_ROOT, resolved);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    resolve(REPAIR_RUNS_ROOT, relativePath) !== resolved ||
    (expectedBasename !== undefined && basename(resolved) !== expectedBasename)
  ) {
    throw new Error(`Refusing to access an unmanaged repair path: ${resolved}`);
  }
  return resolved;
}

export function getRepairWorkspacePaths(runId) {
  const safeRunId = validateRunId(runId);
  const runRoot = assertContainedRunPath(join(REPAIR_RUNS_ROOT, safeRunId), safeRunId);
  const fixtureRoot = assertContainedRunPath(join(runRoot, "fixture"), "fixture");
  return { runId: safeRunId, runRoot, fixtureRoot };
}

export function createRepairWorkspace(runId) {
  const paths = getRepairWorkspacePaths(runId);
  if (existsSync(paths.runRoot)) {
    throw new Error(`Repair workspace already exists: ${paths.runId}`);
  }

  const baselineHashBefore = directoryHash(BASELINE_FIXTURE);
  mkdirSync(REPAIR_RUNS_ROOT, { recursive: true });
  mkdirSync(paths.runRoot, { recursive: false });
  cpSync(BASELINE_FIXTURE, paths.fixtureRoot, {
    recursive: true,
    errorOnExist: true,
    filter: (source) => !TRANSIENT_DIRECTORIES.has(source.split(/[\\/]/u).at(-1)),
  });
  const workspaceHashAtCreation = directoryHash(paths.fixtureRoot);
  if (workspaceHashAtCreation !== baselineHashBefore) {
    removeRepairWorkspace(paths.runId);
    throw new Error("Fresh repair workspace does not match the canonical baseline hash.");
  }

  return { ...paths, baselineHashBefore, workspaceHashAtCreation };
}

export function assertCanonicalFixtureUnchanged(expectedHash) {
  const actualHash = directoryHash(BASELINE_FIXTURE);
  if (actualHash !== expectedHash) {
    throw new Error("Canonical buggy fixture changed during a repair run.");
  }
  return actualHash;
}

export function removeRepairWorkspace(runId) {
  const { runRoot } = getRepairWorkspacePaths(runId);
  const checked = assertContainedRunPath(runRoot, validateRunId(runId));
  rmSync(checked, { recursive: true, force: true });
}
