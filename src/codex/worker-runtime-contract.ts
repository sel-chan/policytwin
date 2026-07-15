import {
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

export const WORKER_WRITABLE_PATHS = [
  "src/refund.ts",
  "tests/refund.test.mjs",
] as const;
export const OBSERVED_WORKER_NETWORK_ID = "__POLICYTWIN_WORKER_NETWORK_ID__" as const;

const WORKER_PROXY_AUTHORITY = "policytwin-egress:8443";
const WORKER_USER = "10001:10001";
const VERIFIER_USER = "10002:10002";
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const OWNERSHIP_NONCE = /^[0-9a-f]{32}$/u;
const WORKER_NETWORK = /^policytwin-worker-[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IMMUTABLE_IMAGE = /^sha256:[0-9a-f]{64}$/u;
const MAX_LAYOUT_ENTRIES = 128;
const BASELINE_TREE = [
  "package.json",
  "src",
  "src/refund.ts",
  "tests",
  "tests/refund.test.mjs",
  "tsconfig.json",
] as const;
const REPAIR_TREE = ["src", "src/refund.ts", "tests", "tests/refund.test.mjs"] as const;
const VERIFICATION_TREE = [...BASELINE_TREE, "dist"].sort(compareText);

export interface WorkerRuntimeLayout {
  repositoryRoot: string;
  baselineRoot: string;
  managedRunsRoot: string;
  runRoot: string;
  repairRoot: string;
  verificationRoot: string;
  requestPath: string;
  responsePath: string;
  proxyTokenPath: string;
  proxyCaPath: string;
}

export interface WorkerRuntimeMount {
  source: string;
  target: string;
  readOnly: boolean;
}

export interface WorkerRuntimeTmpfsMount {
  target: string;
  sizeBytes: number;
}

export interface WorkerRuntimeResourceLimits {
  wallTimeMs: number;
  cpuTimeMs: number;
  memoryBytes: number;
  pids: number;
  outputBytes: number;
}

export interface WorkerContainerInvocation {
  image: string;
  name: string;
  user: string;
  entrypoint: readonly string[];
  workingDirectory: string;
  network: string;
  creationNetwork: "worker" | "none";
  labels: Readonly<Record<string, string>>;
  environment: Readonly<Record<string, string>>;
  imageEnvironment: Readonly<Record<string, string>>;
  mounts: readonly WorkerRuntimeMount[];
  tmpfsMounts: readonly WorkerRuntimeTmpfsMount[];
  pidsLimit: number;
  memoryBytes: number;
  memorySwapBytes: number;
  nanoCpus: number;
  fileSizeLimitBytes: number;
  logDriver: "local";
  logOptions: Readonly<Record<string, string>>;
  wallTimeMs: number;
  cpuTimeMs: number;
  outputBytes: number;
  cpuTimeEnforcement: "UNAVAILABLE_STATIC_DRIVER";
  commandArgs: readonly string[];
  dockerArgs: readonly string[];
}

export interface WorkerRuntimePlan {
  schemaVersion: "1";
  status: "STATIC_PLAN_ONLY";
  dynamicIsolationVerified: false;
  liveCodexExecuted: false;
  worker: WorkerContainerInvocation;
  verifier: WorkerContainerInvocation;
}

export interface WorkerRuntimePlanOptions {
  repositoryRoot: string;
  runId: string;
  workerImage: string;
  verifierImage: string;
  workerNetwork: string;
  ownershipNonce: string;
  requestSha256: string;
  limits: WorkerRuntimeResourceLimits;
}

function runtimeLayoutError(): Error {
  return new Error("Worker runtime layout is absent, unsafe, or incomplete.");
}

export function deriveSupervisorDockerResourceSuffix(
  requestSha256: string,
  runId: string,
  ownershipNonce: string,
): string {
  return supervisorDockerBindingSha256(requestSha256, runId, ownershipNonce).slice(0, 32);
}

export function supervisorDockerBindingSha256(
  requestSha256: string,
  runId: string,
  ownershipNonce: string,
): string {
  if (!SHA256.test(requestSha256)) {
    throw new Error("Worker request SHA-256 is invalid.");
  }
  if (!RUN_ID.test(runId)) throw new Error("Worker run ID is invalid.");
  if (!OWNERSHIP_NONCE.test(ownershipNonce)) {
    throw new Error("Worker ownership nonce is invalid.");
  }
  return createHash("sha256")
    .update("policytwin-docker-v2", "utf8")
    .update("\0", "utf8")
    .update(requestSha256, "utf8")
    .update("\0", "utf8")
    .update(runId, "utf8")
    .update("\0", "utf8")
    .update(ownershipNonce, "utf8")
    .digest("hex");
}

function comparePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertContained(parent: string, candidate: string): void {
  const path = relative(parent, candidate);
  if (path.length === 0 || path.startsWith("..") || isAbsolute(path)) {
    throw runtimeLayoutError();
  }
}

function assertMountSourceText(path: string): void {
  if (path.includes(",") || /[\r\n\0]/u.test(path)) throw runtimeLayoutError();
}

function assertRealDirectory(path: string): void {
  if (!existsSync(path)) throw runtimeLayoutError();
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw runtimeLayoutError();
  if (!comparePath(realpathSync.native(path), resolve(path))) throw runtimeLayoutError();
  assertMountSourceText(path);
}

function assertRealFile(path: string, maximumBytes: number): void {
  if (!existsSync(path)) throw runtimeLayoutError();
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw runtimeLayoutError();
  }
  if (!comparePath(realpathSync.native(path), resolve(path))) throw runtimeLayoutError();
  assertMountSourceText(path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertTreeHasNoLinks(root: string): string[] {
  let entriesSeen = 0;
  const paths: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareText(left.name, right.name),
    )) {
      entriesSeen += 1;
      if (entriesSeen > MAX_LAYOUT_ENTRIES) throw runtimeLayoutError();
      const path = join(directory, entry.name);
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw runtimeLayoutError();
      }
      paths.push(relativePath);
      if (stat.isDirectory()) visit(path, relativePath);
    }
  };
  visit(root, "");
  return paths.sort(compareText);
}

function assertExactTree(root: string, expected: readonly string[]): void {
  const actual = assertTreeHasNoLinks(root);
  const required = [...expected].sort(compareText);
  if (
    actual.length !== required.length ||
    actual.some((path, index) => path !== required[index])
  ) {
    throw runtimeLayoutError();
  }
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function contentBinding(root: string, paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...paths].sort(compareText)) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(resolve(root, path)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function immutableImage(value: string, label: string): string {
  if (!IMMUTABLE_IMAGE.test(value)) {
    throw new Error(`${label} must be an immutable image digest reference.`);
  }
  return value;
}

export function createWorkerRuntimeLayout(options: {
  repositoryRoot: string;
  runId: string;
}): WorkerRuntimeLayout {
  if (!isAbsolute(options.repositoryRoot) || !RUN_ID.test(options.runId)) {
    throw new Error("Worker runtime repository root or run ID is invalid.");
  }
  const repositoryRoot = resolve(options.repositoryRoot);
  const managedRunsRoot = resolve(repositoryRoot, ".tmp", "worker-runs");
  const runRoot = resolve(managedRunsRoot, options.runId);
  assertContained(managedRunsRoot, runRoot);
  return {
    repositoryRoot,
    baselineRoot: resolve(repositoryRoot, "fixtures", "refund-demo", "baseline"),
    managedRunsRoot,
    runRoot,
    repairRoot: resolve(runRoot, "repair"),
    verificationRoot: resolve(runRoot, "verify"),
    requestPath: resolve(runRoot, "request.json"),
    responsePath: resolve(runRoot, "response.json"),
    proxyTokenPath: resolve(runRoot, "proxy-token"),
    proxyCaPath: resolve(runRoot, "proxy-ca.pem"),
  };
}

export function assertWorkerRuntimeLayout(layout: WorkerRuntimeLayout): void {
  assertRealDirectory(layout.repositoryRoot);
  assertRealDirectory(layout.baselineRoot);
  assertRealDirectory(layout.managedRunsRoot);
  assertRealDirectory(layout.runRoot);
  assertRealDirectory(layout.repairRoot);
  assertRealDirectory(layout.verificationRoot);
  assertContained(layout.repositoryRoot, layout.baselineRoot);
  assertContained(layout.repositoryRoot, layout.managedRunsRoot);
  assertContained(layout.managedRunsRoot, layout.runRoot);
  for (const [root, path] of [
    [layout.runRoot, layout.repairRoot],
    [layout.runRoot, layout.verificationRoot],
    [layout.runRoot, layout.requestPath],
    [layout.runRoot, layout.responsePath],
    [layout.runRoot, layout.proxyTokenPath],
    [layout.runRoot, layout.proxyCaPath],
  ] as const) {
    assertContained(root, path);
  }
  for (const required of [
    resolve(layout.baselineRoot, "package.json"),
    resolve(layout.baselineRoot, "tsconfig.json"),
    ...WORKER_WRITABLE_PATHS.map((path) => resolve(layout.baselineRoot, path)),
    ...WORKER_WRITABLE_PATHS.map((path) => resolve(layout.repairRoot, path)),
    resolve(layout.verificationRoot, "package.json"),
    resolve(layout.verificationRoot, "tsconfig.json"),
    ...WORKER_WRITABLE_PATHS.map((path) => resolve(layout.verificationRoot, path)),
  ]) {
    assertRealFile(required, 1024 * 1024);
  }
  assertRealDirectory(resolve(layout.verificationRoot, "dist"));
  assertRealFile(layout.requestPath, 1024 * 1024);
  assertRealFile(layout.responsePath, 4 * 1024 * 1024);
  assertRealFile(layout.proxyTokenPath, 4_096);
  assertRealFile(layout.proxyCaPath, 64 * 1024);
  assertExactTree(layout.baselineRoot, BASELINE_TREE);
  assertExactTree(layout.repairRoot, REPAIR_TREE);
  assertExactTree(layout.verificationRoot, VERIFICATION_TREE);
}

export function reconstructVerificationWorkspace(layout: WorkerRuntimeLayout): {
  schemaVersion: "1";
  copiedPaths: readonly ["src/refund.ts", "tests/refund.test.mjs"];
  baselineContentSha256: string;
  repairOverlaySha256: string;
  verificationContentSha256: string;
} {
  assertWorkerRuntimeLayout(layout);
  const baselinePaths = ["package.json", "src/refund.ts", "tests/refund.test.mjs", "tsconfig.json"];
  for (const path of baselinePaths) {
    if (
      fileSha256(resolve(layout.baselineRoot, path)) !==
      fileSha256(resolve(layout.verificationRoot, path))
    ) {
      throw new Error("Verification workspace must begin as the exact canonical baseline.");
    }
  }
  for (const path of WORKER_WRITABLE_PATHS) {
    copyFileSync(resolve(layout.repairRoot, path), resolve(layout.verificationRoot, path));
  }
  for (const path of ["package.json", "tsconfig.json"]) {
    if (
      fileSha256(resolve(layout.baselineRoot, path)) !==
      fileSha256(resolve(layout.verificationRoot, path))
    ) {
      throw new Error("Verification reconstruction changed an immutable fixture file.");
    }
  }
  for (const path of WORKER_WRITABLE_PATHS) {
    if (
      fileSha256(resolve(layout.repairRoot, path)) !==
      fileSha256(resolve(layout.verificationRoot, path))
    ) {
      throw new Error("Verification reconstruction did not bind an approved repair overlay.");
    }
  }
  return {
    schemaVersion: "1",
    copiedPaths: WORKER_WRITABLE_PATHS,
    baselineContentSha256: contentBinding(layout.baselineRoot, baselinePaths),
    repairOverlaySha256: contentBinding(layout.repairRoot, WORKER_WRITABLE_PATHS),
    verificationContentSha256: contentBinding(layout.verificationRoot, baselinePaths),
  };
}

export function verifierEnvironment(
  _source: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  return Object.freeze({
    HOME: "/tmp",
    PATH: "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin",
  });
}

function workerEnvironment(): Readonly<Record<string, string>> {
  return Object.freeze({
    HOME: "/worker-home",
    CODEX_HOME: "/worker-home/.codex",
    POLICYTWIN_WORKER_REQUEST: "/run/policytwin/request.json",
    POLICYTWIN_WORKER_RESPONSE: "/run/policytwin/response.json",
    POLICYTWIN_PROXY_TOKEN_FILE: "/run/secrets/policytwin-proxy-token",
    POLICYTWIN_OPENAI_PROXY: `https://${WORKER_PROXY_AUTHORITY}/v1`,
    CODEX_CA_CERTIFICATE: "/run/secrets/policytwin-egress-ca.pem",
  });
}

function nodeImageEnvironment(path: string): Readonly<Record<string, string>> {
  return Object.freeze({
    PATH: path,
    NODE_VERSION: "22.22.2",
    YARN_VERSION: "1.22.22",
    NODE_ENV: "production",
  });
}

function assertWorkerResourceLimits(limits: WorkerRuntimeResourceLimits): void {
  const values = Object.values(limits);
  if (values.some((value) => !Number.isSafeInteger(value))) {
    throw new Error("Worker runtime resource limits are invalid.");
  }
  if (
    limits.wallTimeMs < 1_000 ||
    limits.wallTimeMs > 15 * 60_000 ||
    limits.cpuTimeMs < 1_000 ||
    limits.cpuTimeMs > 10 * 60_000 ||
    limits.memoryBytes < 256 * 1024 * 1024 ||
    limits.memoryBytes > 4 * 1024 * 1024 * 1024 ||
    limits.pids < 8 ||
    limits.pids > 128 ||
    limits.outputBytes < 1024 * 1024 ||
    limits.outputBytes > 4 * 1024 * 1024
  ) {
    throw new Error("Worker runtime resource limits are invalid.");
  }
}

function mountArgument(mount: WorkerRuntimeMount): string {
  return `type=bind,source=${mount.source},target=${mount.target}${
    mount.readOnly ? ",readonly" : ""
  }`;
}

function environmentArguments(environment: Readonly<Record<string, string>>): string[] {
  return Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}

function commonArguments(options: {
  name: string;
  user: string;
  pids: number;
  memoryBytes: number;
  outputBytes: number;
  cpus: number;
  network: string;
  labels: Readonly<Record<string, string>>;
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    options.name,
    "--read-only",
    "--user",
    options.user,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    String(options.pids),
    "--memory",
    String(options.memoryBytes),
    "--memory-swap",
    String(options.memoryBytes),
    "--ulimit",
    `fsize=${options.outputBytes}:${options.outputBytes}`,
    "--log-driver",
    "local",
    "--log-opt",
    `max-size=${options.outputBytes}`,
    "--log-opt",
    "max-file=1",
    "--cpus",
    String(options.cpus),
    "--stop-timeout",
    "5",
    "--network",
    options.network,
    ...Object.entries(options.labels)
      .sort(([left], [right]) => compareText(left, right))
      .flatMap(([key, value]) => ["--label", `${key}=${value}`]),
  ];
}

export function buildWorkerRuntimePlan(options: WorkerRuntimePlanOptions): WorkerRuntimePlan {
  if (!WORKER_NETWORK.test(options.workerNetwork)) {
    throw new Error("Worker network name is invalid.");
  }
  assertWorkerResourceLimits(options.limits);
  const resourceSuffix = deriveSupervisorDockerResourceSuffix(
    options.requestSha256,
    options.runId,
    options.ownershipNonce,
  );
  const layout = createWorkerRuntimeLayout(options);
  assertWorkerRuntimeLayout(layout);
  const workerImage = immutableImage(options.workerImage, "Worker image");
  const verifierImage = immutableImage(options.verifierImage, "Verifier image");
  const workerMounts: WorkerRuntimeMount[] = [
    { source: layout.baselineRoot, target: "/workspace", readOnly: true },
    {
      source: resolve(layout.repairRoot, WORKER_WRITABLE_PATHS[0]),
      target: `/workspace/${WORKER_WRITABLE_PATHS[0]}`,
      readOnly: false,
    },
    {
      source: resolve(layout.repairRoot, WORKER_WRITABLE_PATHS[1]),
      target: `/workspace/${WORKER_WRITABLE_PATHS[1]}`,
      readOnly: false,
    },
    { source: layout.requestPath, target: "/run/policytwin/request.json", readOnly: true },
    { source: layout.responsePath, target: "/run/policytwin/response.json", readOnly: false },
    {
      source: layout.proxyTokenPath,
      target: "/run/secrets/policytwin-proxy-token",
      readOnly: true,
    },
    {
      source: layout.proxyCaPath,
      target: "/run/secrets/policytwin-egress-ca.pem",
      readOnly: true,
    },
  ];
  const verificationMounts: WorkerRuntimeMount[] = [
    { source: layout.verificationRoot, target: "/fixture", readOnly: true },
  ];
  const workerEnv = workerEnvironment();
  const verifierEnv = verifierEnvironment();
  const workerImageEnv = nodeImageEnvironment(
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  );
  const verifierImageEnv = nodeImageEnvironment(
    "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin",
  );
  const bindingSha256 = supervisorDockerBindingSha256(
    options.requestSha256,
    options.runId,
    options.ownershipNonce,
  );
  const commonLabels = {
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "2",
    "com.policytwin.binding-sha256": bindingSha256,
    "com.policytwin.request-sha256": options.requestSha256,
    "com.policytwin.run-id": options.runId,
  } as const;
  const workerLabels = { ...commonLabels, "com.policytwin.role": "worker" } as const;
  const verifierLabels = { ...commonLabels, "com.policytwin.role": "verifier" } as const;
  const workerArgs = [
    ...commonArguments({
      name: `policytwin-worker-${resourceSuffix}`,
      user: WORKER_USER,
      pids: options.limits.pids,
      memoryBytes: options.limits.memoryBytes,
      outputBytes: options.limits.outputBytes,
      cpus: 1,
      network: OBSERVED_WORKER_NETWORK_ID,
      labels: workerLabels,
    }),
    ...environmentArguments(workerEnv),
    "--tmpfs",
    "/worker-home:rw,noexec,nosuid,nodev,size=67108864",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=67108864",
    ...workerMounts.flatMap((mount) => ["--mount", mountArgument(mount)]),
    workerImage,
    "--static-preflight",
  ];
  const verifierArgs = [
    ...commonArguments({
      name: `policytwin-verifier-${resourceSuffix}`,
      user: VERIFIER_USER,
      pids: 32,
      memoryBytes: 536_870_912,
      outputBytes: options.limits.outputBytes,
      cpus: 1,
      network: "none",
      labels: verifierLabels,
    }),
    ...environmentArguments(verifierEnv),
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=67108864",
    "--tmpfs",
    "/fixture/dist:rw,noexec,nosuid,nodev,size=67108864",
    ...verificationMounts.flatMap((mount) => ["--mount", mountArgument(mount)]),
    verifierImage,
    "--verify",
  ];
  return {
    schemaVersion: "1",
    status: "STATIC_PLAN_ONLY",
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
    worker: {
      image: workerImage,
      name: `policytwin-worker-${resourceSuffix}`,
      user: WORKER_USER,
      entrypoint: ["node", "scripts/worker-preflight.mjs"],
      workingDirectory: "/opt/policytwin",
      network: options.workerNetwork,
      creationNetwork: "worker",
      labels: workerLabels,
      environment: workerEnv,
      imageEnvironment: workerImageEnv,
      mounts: workerMounts,
      tmpfsMounts: [
        { target: "/worker-home", sizeBytes: 67_108_864 },
        { target: "/tmp", sizeBytes: 67_108_864 },
      ],
      pidsLimit: options.limits.pids,
      memoryBytes: options.limits.memoryBytes,
      memorySwapBytes: options.limits.memoryBytes,
      nanoCpus: 1_000_000_000,
      fileSizeLimitBytes: options.limits.outputBytes,
      logDriver: "local",
      logOptions: Object.freeze({
        "max-size": String(options.limits.outputBytes),
        "max-file": "1",
      }),
      wallTimeMs: options.limits.wallTimeMs,
      cpuTimeMs: options.limits.cpuTimeMs,
      outputBytes: options.limits.outputBytes,
      cpuTimeEnforcement: "UNAVAILABLE_STATIC_DRIVER",
      commandArgs: ["--static-preflight"],
      dockerArgs: workerArgs,
    },
    verifier: {
      image: verifierImage,
      name: `policytwin-verifier-${resourceSuffix}`,
      user: VERIFIER_USER,
      entrypoint: ["node", "scripts/verifier-preflight.mjs"],
      workingDirectory: "/opt/policytwin",
      network: "none",
      creationNetwork: "none",
      labels: verifierLabels,
      environment: verifierEnv,
      imageEnvironment: verifierImageEnv,
      mounts: verificationMounts,
      tmpfsMounts: [
        { target: "/tmp", sizeBytes: 67_108_864 },
        { target: "/fixture/dist", sizeBytes: 67_108_864 },
      ],
      pidsLimit: 32,
      memoryBytes: 536_870_912,
      memorySwapBytes: 536_870_912,
      nanoCpus: 1_000_000_000,
      fileSizeLimitBytes: options.limits.outputBytes,
      logDriver: "local",
      logOptions: Object.freeze({
        "max-size": String(options.limits.outputBytes),
        "max-file": "1",
      }),
      wallTimeMs: options.limits.wallTimeMs,
      cpuTimeMs: options.limits.cpuTimeMs,
      outputBytes: options.limits.outputBytes,
      cpuTimeEnforcement: "UNAVAILABLE_STATIC_DRIVER",
      commandArgs: ["--verify"],
      dockerArgs: verifierArgs,
    },
  };
}
