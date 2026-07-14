import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
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
const MAX_TREE_ENTRIES = 256;
const MAX_TREE_FILE_BYTES = 1024 * 1024;
const MAX_TREE_TOTAL_BYTES = 8 * 1024 * 1024;

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

function inspectRepairFixtureTree(fixtureRoot) {
  const root = assertManagedFixtureRoot(fixtureRoot);
  const rootBefore = lstatSync(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) {
    throw new Error("Repair fixture root must be a real directory.");
  }
  const hash = createHash("sha256");
  hash.update("directory\0", "utf8");
  hash.update(".", "utf8");
  hash.update("\0", "utf8");
  hash.update(String(rootBefore.mode), "utf8");
  hash.update("\0", "utf8");
  hash.update(String(rootBefore.mtimeMs), "utf8");
  hash.update("\0", "utf8");
  const receiptFiles = [
    {
      path: ".",
      kind: "directory",
      mode: rootBefore.mode,
      mtimeMs: rootBefore.mtimeMs,
    },
  ];
  let entriesSeen = 0;
  let totalBytes = 0;

  function visit(directory, prefix) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      entriesSeen += 1;
      if (entriesSeen > MAX_TREE_ENTRIES) {
        throw new Error(`Repair fixture contains more than ${MAX_TREE_ENTRIES} entries.`);
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = (prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`).replaceAll(
        "\\",
        "/",
      );
      const before = lstatSync(absolutePath);
      if (before.isSymbolicLink()) {
        throw new Error(`Repair fixture symlinks are forbidden: ${relativePath}`);
      }
      if (before.isDirectory()) {
        hash.update("directory\0", "utf8");
        hash.update(relativePath, "utf8");
        hash.update("\0", "utf8");
        hash.update(String(before.mode), "utf8");
        hash.update("\0", "utf8");
        hash.update(String(before.mtimeMs), "utf8");
        hash.update("\0", "utf8");
        receiptFiles.push({
          path: relativePath,
          kind: "directory",
          mode: before.mode,
          mtimeMs: before.mtimeMs,
        });
        visit(absolutePath, relativePath);
        const after = lstatSync(absolutePath);
        if (
          !after.isDirectory() ||
          after.isSymbolicLink() ||
          after.mode !== before.mode ||
          after.mtimeMs !== before.mtimeMs
        ) {
          throw new Error(`Repair fixture directory changed while hashing: ${relativePath}`);
        }
        continue;
      }
      if (!before.isFile() || before.size > MAX_TREE_FILE_BYTES) {
        throw new Error(`Repair fixture entry is unsupported or too large: ${relativePath}`);
      }
      const content = readFileSync(absolutePath);
      const after = lstatSync(absolutePath);
      if (
        !after.isFile() ||
        after.size !== content.byteLength ||
        after.mtimeMs !== before.mtimeMs ||
        after.mode !== before.mode
      ) {
        throw new Error(`Repair fixture changed while hashing: ${relativePath}`);
      }
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TREE_TOTAL_BYTES) {
        throw new Error("Repair fixture exceeds the aggregate tree-hash size limit.");
      }
      hash.update("file\0", "utf8");
      hash.update(relativePath, "utf8");
      hash.update("\0", "utf8");
      hash.update(String(before.mode), "utf8");
      hash.update("\0", "utf8");
      hash.update(String(before.mtimeMs), "utf8");
      hash.update("\0", "utf8");
      hash.update(content);
      hash.update("\0", "utf8");
      receiptFiles.push({
        path: relativePath,
        kind: "file",
        mode: before.mode,
        mtimeMs: before.mtimeMs,
        bytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64"),
      });
    }
  }

  visit(root, "");
  const rootAfter = lstatSync(root);
  if (
    !rootAfter.isDirectory() ||
    rootAfter.isSymbolicLink() ||
    rootAfter.mode !== rootBefore.mode ||
    rootAfter.mtimeMs !== rootBefore.mtimeMs
  ) {
    throw new Error("Repair fixture root changed while hashing.");
  }
  return { treeSha256: hash.digest("hex"), files: receiptFiles };
}

export function repairFixtureTreeHash(fixtureRoot) {
  return inspectRepairFixtureTree(fixtureRoot).treeSha256;
}

export function repairFixtureTreeReceipt(fixtureRoot, runId) {
  if (typeof runId !== "string" || runId.length === 0 || runId.length > 256) {
    throw new Error("Repair fixture tree receipt requires a bounded run ID.");
  }
  const snapshot = inspectRepairFixtureTree(fixtureRoot);
  return {
    schemaVersion: "1",
    status: "PASS",
    runId,
    fixtureId: "seeded-refund-demo",
    treeSha256: snapshot.treeSha256,
    files: snapshot.files,
  };
}

export function runRepairCommand(fixtureRoot, commandId, executionMode) {
  if (executionMode === "LIVE_CODEX_SDK") {
    throw new Error(
      "Live Codex repair commands require an externally isolated, non-networked worker; host execution is forbidden.",
    );
  }
  if (executionMode !== "OFFLINE_TEST_DOUBLE") {
    throw new Error("Repair command execution mode must be explicit and supported.");
  }
  const definition = getRepairCommandDefinition(commandId);
  const cwd = assertManagedFixtureRoot(fixtureRoot);
  const fixtureTreeBeforeSha256 = repairFixtureTreeHash(cwd);
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
  const fixtureTreeAfterSha256 = repairFixtureTreeHash(cwd);
  const testMutatedFixture =
    definition.id === "fixture-test" && fixtureTreeBeforeSha256 !== fixtureTreeAfterSha256;
  const stdout = redactWorkerOutput(result.stdout ?? "");
  const stderr = redactWorkerOutput(
    `${result.stderr ?? ""}${result.error === undefined ? "" : `\n${result.error.message}`}${
      testMutatedFixture ? "\nTrusted fixture tests changed the verified file tree." : ""
    }`,
  );
  return {
    schemaVersion: "1",
    commandId: definition.id,
    exitCode: timedOut ? 124 : testMutatedFixture ? 1 : (result.status ?? 1),
    timedOut,
    durationMs,
    stdout: stdout.text,
    stderr: stderr.text,
    outputTruncated: stdout.truncated || stderr.truncated,
    fixtureTreeBeforeSha256,
    fixtureTreeAfterSha256,
  };
}
