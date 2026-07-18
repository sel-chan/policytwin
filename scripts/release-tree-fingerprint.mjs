import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

export const RELEASE_TREE_EXCLUDED_PATHS = Object.freeze([
  "PROGRESS.md",
  "artifacts/security/offline-verify-report.json",
  "artifacts/submission/submission-check-report.json",
]);
const EXCLUDED_PATHS = new Set(RELEASE_TREE_EXCLUDED_PATHS);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

function gitOutput(root, args) {
  const result = spawnSync(
    "git",
    args,
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`Unable to enumerate release inputs: ${result.stderr}`);
  return result.stdout;
}

function requireExcludedReleaseArtifactsTracked(root) {
  const tracked = new Set(
    gitOutput(root, ["ls-files", "--cached", "-z", "--", ...RELEASE_TREE_EXCLUDED_PATHS])
      .split("\0")
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/")),
  );
  if (RELEASE_TREE_EXCLUDED_PATHS.some((path) => !tracked.has(path))) {
    throw new Error("Every excluded mutable ledger or self-report path must remain tracked.");
  }
}

function requireSafeIndexFlags(root, trackedPaths) {
  for (const option of ["-v", "-f"]) {
    const observedPaths = new Set();
    const records = gitOutput(root, ["ls-files", option, "-z"])
      .split("\0")
      .filter(Boolean);
    for (const record of records) {
      const path = record.slice(2).replaceAll("\\", "/");
      if (EXCLUDED_PATHS.has(path)) continue;
      if (record.length < 3 || record[1] !== " " || record[0] !== "H") {
        throw new Error(`Tracked release input has an unsafe Git index flag: ${record}`);
      }
      observedPaths.add(path);
    }
    if (
      observedPaths.size !== trackedPaths.size ||
      [...trackedPaths].some((path) => !observedPaths.has(path))
    ) {
      throw new Error("Git index flag enumeration does not match the tracked release inputs.");
    }
  }
}

function requireWorktreeObjectsMatchIndex(root, tracked) {
  if (tracked.length === 0) return;
  for (const { path } of tracked) {
    if (/[\u0000-\u001f\u007f]/u.test(path)) {
      throw new Error(`Release input path contains a control character: ${path}`);
    }
  }
  const result = spawnSync("git", ["hash-object", "--stdin-paths", "--no-filters"], {
    cwd: root,
    encoding: "utf8",
    input: `${tracked.map(({ path }) => path).join("\n")}\n`,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to hash tracked release inputs: ${result.stderr}`);
  }
  const objectIds = result.stdout.split(/\r?\n/u).filter(Boolean);
  if (
    objectIds.length !== tracked.length ||
    tracked.some(({ indexObjectId }, index) => objectIds[index] !== indexObjectId)
  ) {
    throw new Error("Tracked release input content does not match the Git index object.");
  }
}

function trackedEntries(root) {
  return gitOutput(root, ["ls-files", "--stage", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t");
      const metadata = separator >= 0 ? record.slice(0, separator).split(" ") : [];
      const path = separator >= 0 ? record.slice(separator + 1).replaceAll("\\", "/") : "";
      if (
        metadata.length !== 3 ||
        !/^(?:100644|100755)$/u.test(metadata[0]) ||
        !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(metadata[1]) ||
        metadata[2] !== "0"
      ) {
        throw new Error(`Unable to parse a tracked release input: ${record}`);
      }
      return {
        path,
        tracked: true,
        indexMode: metadata[0],
        indexObjectId: metadata[1],
      };
    })
    .filter(({ path }) => !EXCLUDED_PATHS.has(path));
}

function untrackedPaths(root) {
  return gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !EXCLUDED_PATHS.has(path));
}

function managedPaths(root) {
  const tracked = trackedEntries(root);
  const trackedPaths = new Set(tracked.map(({ path }) => path));
  requireSafeIndexFlags(root, trackedPaths);
  requireWorktreeObjectsMatchIndex(root, tracked);
  const entries = [
    ...tracked,
    ...untrackedPaths(root)
      .filter((path) => !trackedPaths.has(path))
      .map((path) => ({ path, tracked: false, indexMode: null, indexObjectId: null })),
  ];
  return entries
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

export function computeReleaseTreeFingerprint(root = ROOT) {
  const hash = createHash("sha256");
  let totalBytes = 0;
  requireExcludedReleaseArtifactsTracked(root);
  const paths = managedPaths(root);
  let trackedFileCount = 0;
  let untrackedFileCount = 0;
  for (const entry of paths) {
    const { path, tracked, indexMode, indexObjectId } = entry;
    if (
      path.length === 0 ||
      path.startsWith("/") ||
      /^[A-Za-z]:/u.test(path) ||
      path.split("/").some((segment) => segment === "..")
    ) {
      throw new Error(`Unsafe release input path: ${path}`);
    }
    const absolute = resolve(root, path);
    const managedRelative = relative(root, absolute);
    if (
      isAbsolute(managedRelative) ||
      managedRelative === ".." ||
      managedRelative.startsWith("../") ||
      managedRelative.startsWith("..\\")
    ) {
      throw new Error(`Release input escapes its root: ${path}`);
    }
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
      throw new Error(`Release input must be a bounded regular file: ${path}`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Release inputs exceed the aggregate byte limit.");
    const pathBytes = Buffer.from(path, "utf8");
    const content = readFileSync(absolute);
    const workingMode = stat.mode & 0o111 ? "100755" : "100644";
    const objectIdBytes = Buffer.from(indexObjectId ?? "", "ascii");
    const header = Buffer.alloc(22);
    header.writeUInt32BE(pathBytes.length, 0);
    header.writeBigUInt64BE(BigInt(content.length), 4);
    header.writeUInt32BE(indexMode === null ? 0 : Number.parseInt(indexMode, 8), 12);
    header.writeUInt32BE(Number.parseInt(workingMode, 8), 16);
    header[20] = tracked ? 1 : 0;
    header[21] = objectIdBytes.length;
    hash.update(header);
    hash.update(pathBytes);
    hash.update(objectIdBytes);
    hash.update(content);
    if (tracked) trackedFileCount += 1;
    else untrackedFileCount += 1;
  }
  requireWorktreeObjectsMatchIndex(
    root,
    paths.filter(({ tracked }) => tracked),
  );
  return {
    scope: "GIT_MANAGED_RELEASE_INPUTS_EXCLUDING_MUTABLE_LEDGER_AND_SELF_REPORTS",
    excludedPaths: [...RELEASE_TREE_EXCLUDED_PATHS].sort(),
    algorithm: "SHA-256",
    fileCount: paths.length,
    trackedFileCount,
    untrackedFileCount,
    totalBytes,
    sha256: hash.digest("hex"),
  };
}
