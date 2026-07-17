import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT } from "./process.mjs";

const COMMON_INPUTS = [
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];
const ROLE_INPUTS = {
  worker: [
    "Dockerfile.worker",
    "prompts",
    "scripts/build-core.mjs",
    "scripts/process.mjs",
    "scripts/worker-preflight.mjs",
    "scripts/egress-tls-probe.mjs",
    "scripts/worker-entrypoint.mjs",
    "scripts/role-start-barrier.mjs",
    "scripts/proxy-token-helper.mjs",
    "src",
    "tsconfig.build.json",
    "tsconfig.json",
  ],
  verifier: [
    "Dockerfile.verifier",
    "scripts/verifier-preflight.mjs",
    "scripts/role-start-barrier.mjs",
  ],
  egress: [
    "Dockerfile.egress-proxy",
    "scripts/build-core.mjs",
    "scripts/openai-egress-proxy.mjs",
    "scripts/role-start-barrier.mjs",
    "scripts/process.mjs",
    "src",
    "tsconfig.build.json",
    "tsconfig.json",
  ],
  helper: [
    "Dockerfile.cgroup-helper",
    "native/policytwin-linux-cgroup-helper.c",
    "scripts/native-helper-contract.mjs",
  ],
};
const MAX_FILES = 512;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelative(root, path) {
  const value = relative(root, path).replaceAll("\\", "/");
  if (value.length === 0 || value.startsWith("../") || value === "..") {
    throw new Error("Container build input escaped the repository root.");
  }
  return value;
}

function collectInput(root, input, files) {
  const path = resolve(root, input);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Container build inputs cannot contain links.");
  if (stat.isFile()) {
    files.push(path);
    return;
  }
  if (!stat.isDirectory()) throw new Error("Container build input type is unsupported.");
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    collectInput(root, join(path, entry.name), files);
  }
}

export function computeContainerBuildInput(role, root = ROOT) {
  if (role !== "worker" && role !== "verifier" && role !== "egress" && role !== "helper") {
    throw new Error("Container build role is invalid.");
  }
  const repositoryRoot = resolve(root);
  const files = [];
  for (const input of [...COMMON_INPUTS, ...ROLE_INPUTS[role]]) {
    collectInput(repositoryRoot, input, files);
  }
  const unique = [...new Set(files.map((path) => resolve(path)))].sort((left, right) =>
    compareText(normalizeRelative(repositoryRoot, left), normalizeRelative(repositoryRoot, right)),
  );
  if (unique.length === 0 || unique.length > MAX_FILES) {
    throw new Error("Container build input file count is invalid.");
  }
  const hash = createHash("sha256");
  let totalBytes = 0;
  const relativeFiles = [];
  for (const path of unique) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
      throw new Error("Container build input file is invalid.");
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Container build inputs exceed the aggregate byte limit.");
    }
    const relativePath = normalizeRelative(repositoryRoot, path);
    const body = readFileSync(path);
    relativeFiles.push(relativePath);
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(body);
    hash.update("\0", "utf8");
  }
  return {
    schemaVersion: "1",
    role,
    sha256: hash.digest("hex"),
    files: relativeFiles,
    totalBytes,
  };
}
