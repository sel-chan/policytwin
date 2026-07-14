import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { getRepairCommandDefinition, redactWorkerOutput } from "../dist/index.js";
import { REPAIR_RUNS_ROOT } from "./repair-workspace.mjs";

const ENVIRONMENT_KEYS = new Set([
  "ci",
  "comspec",
  "force_color",
  "no_color",
  "path",
  "pathext",
  "systemroot",
  "temp",
  "tmp",
  "tmpdir",
  "windir",
]);

export function buildSanitizedEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => ENVIRONMENT_KEYS.has(key.toLowerCase()) && typeof value === "string",
    ),
  );
}

function assertManagedFixtureRoot(fixtureRoot) {
  const resolved = resolve(fixtureRoot);
  const relativePath = relative(REPAIR_RUNS_ROOT, resolved);
  if (
    relativePath.startsWith("..") ||
    resolve(REPAIR_RUNS_ROOT, relativePath) !== resolved ||
    basename(resolved) !== "fixture" ||
    !existsSync(resolved)
  ) {
    throw new Error(`Repair command cwd is not a managed fixture: ${resolved}`);
  }
  return resolved;
}

export function runRepairCommand(fixtureRoot, commandId) {
  const definition = getRepairCommandDefinition(commandId);
  const cwd = assertManagedFixtureRoot(fixtureRoot);
  const startedAt = performance.now();
  const command =
    definition.executable === "node"
      ? process.execPath
      : process.platform === "win32"
        ? `${definition.executable}.cmd`
        : definition.executable;
  const usesWindowsShim = process.platform === "win32" && command.endsWith(".cmd");
  const result = spawnSync(command, [...definition.args], {
    cwd,
    env: buildSanitizedEnvironment(),
    encoding: "utf8",
    timeout: definition.timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    shell: usesWindowsShim,
    windowsHide: true,
  });
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const timedOut = result.error?.code === "ETIMEDOUT";
  const stdout = redactWorkerOutput(result.stdout ?? "");
  const stderr = redactWorkerOutput(
    `${result.stderr ?? ""}${result.error === undefined ? "" : `\n${result.error.message}`}`,
  );
  return {
    schemaVersion: "1",
    commandId: definition.id,
    exitCode: timedOut ? 124 : (result.status ?? 1),
    timedOut,
    durationMs,
    stdout: stdout.text,
    stderr: stderr.text,
    outputTruncated: stdout.truncated || stderr.truncated,
  };
}
