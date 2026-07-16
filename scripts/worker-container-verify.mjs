import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cpSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
import {
  assertLinuxCgroupProcessTreeEmpty,
  observeLinuxCgroupV2,
  readLinuxCgroupCpuUsageUsec,
} from "./linux-cgroup-observer.mjs";
import { ROOT } from "./process.mjs";
import { createPinnedDockerSync } from "./pinned-docker-cli.mjs";

const NODE_IMAGE = /^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u;
const RUN_ID = /^runtime-[0-9a-f]{16}$/u;

export function inspectWorkerContainerPrerequisites(
  contract,
  buildInputs = {
    worker: computeContainerBuildInput("worker"),
    verifier: computeContainerBuildInput("verifier"),
    egress: computeContainerBuildInput("egress"),
  },
) {
  const failures = [];
  if (contract?.schemaVersion !== "9") failures.push("container schema v9 is required");
  if (!NODE_IMAGE.test(contract?.nodeBaseImage ?? "")) {
    failures.push("immutable Node base image is unset");
  }
  if (contract?.workerBuildInputSha256 !== buildInputs.worker.sha256) {
    failures.push("worker build inputs do not match the contract");
  }
  if (contract?.verifierBuildInputSha256 !== buildInputs.verifier.sha256) {
    failures.push("verifier build inputs do not match the contract");
  }
  if (contract?.egressProxyBuildInputSha256 !== buildInputs.egress.sha256) {
    failures.push("egress proxy build inputs do not match the contract");
  }
  if (
    contract?.workerContainer?.status !== "STATIC_PREPARED" ||
    contract?.workerContainer?.dynamicVerified !== false ||
    contract?.workerContainer?.liveCodexExecuted !== false
  ) {
    failures.push("worker static boundary is invalid");
  }
  if (
    contract?.verifierContainer?.status !== "STATIC_PREPARED" ||
    contract?.verifierContainer?.dynamicVerified !== false ||
    contract?.verifierContainer?.liveCodexExecuted !== false
  ) {
    failures.push("verifier static boundary is invalid");
  }
  if (
    contract?.egressProxy?.status !== "STATIC_PREPARED" ||
    contract?.egressProxy?.dynamicVerified !== false ||
    contract?.egressProxy?.liveCodexExecuted !== false
  ) {
    failures.push("egress proxy static boundary is invalid");
  }
  return {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    dockerInvoked: false,
    failures,
  };
}

let pinnedDocker = null;

function docker(args, timeoutMs = 60_000, allowFailure = false) {
  if (pinnedDocker === null) throw new Error("The pinned Docker CLI is not initialized.");
  return pinnedDocker(args, timeoutMs, allowFailure);
}

function requiredDockerId(value, label) {
  const id = value.trim();
  if (!/^[0-9a-f]{64}$/u.test(id)) {
    throw new Error(`${label} did not return one canonical Docker ID.`);
  }
  return id;
}

function assertRunningContainerInstance(observation, label) {
  if (
    !observation.running ||
    observation.pid < 1 ||
    observation.startedAt === "0001-01-01T00:00:00Z" ||
    observation.restartCount !== 0
  ) {
    throw new Error(`${label} did not expose one valid zero-restart running instance.`);
  }
}

function assertStoppedSameContainerInstance(running, stopped, label) {
  if (
    stopped.id !== running.id ||
    stopped.running ||
    stopped.pid !== 0 ||
    stopped.startedAt !== running.startedAt ||
    stopped.restartCount !== 0
  ) {
    throw new Error(`${label} container instance changed before its result was trusted.`);
  }
}

function outputLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function containerRoleAbsent(id, bindingSha256, role) {
  const inspected = id === null
    ? null
    : docker(["container", "inspect", id], 10_000, true);
  const listed = docker(
    [
      "ps",
      "--all",
      "--no-trunc",
      "--filter",
      `label=com.policytwin.binding-sha256=${bindingSha256}`,
      "--filter",
      `label=com.policytwin.role=${role}`,
      "--format",
      "{{.ID}}",
    ],
    10_000,
    true,
  );
  const listedById = id === null
    ? null
    : docker(
        [
          "ps",
          "--all",
          "--no-trunc",
          "--filter",
          `id=${id}`,
          "--format",
          "{{.ID}}",
        ],
        10_000,
        true,
      );
  return (
    (inspected === null || (inspected.error === undefined && inspected.status !== 0)) &&
    (listedById === null ||
      (listedById.error === undefined &&
        listedById.status === 0 &&
        outputLines(listedById.stdout).length === 0)) &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function networkRoleAbsent(id, bindingSha256, role) {
  const inspected = id === null ? null : docker(["network", "inspect", id], 10_000, true);
  const listed = docker(
    [
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `label=com.policytwin.binding-sha256=${bindingSha256}`,
      "--filter",
      `label=com.policytwin.role=${role}`,
      "--format",
      "{{.ID}}",
    ],
    10_000,
    true,
  );
  const listedById = id === null
    ? null
    : docker(
        [
          "network",
          "ls",
          "--no-trunc",
          "--filter",
          `id=${id}`,
          "--format",
          "{{.ID}}",
        ],
        10_000,
        true,
      );
  return (
    (inspected === null || (inspected.error === undefined && inspected.status !== 0)) &&
    (listedById === null ||
      (listedById.error === undefined &&
        listedById.status === 0 &&
        outputLines(listedById.stdout).length === 0)) &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function imageTagAbsent(tag) {
  const inspected = docker(["image", "inspect", tag], 10_000, true);
  const listed = docker(
    ["image", "ls", "--no-trunc", "--filter", `reference=${tag}`, "--format", "{{.ID}}"],
    10_000,
    true,
  );
  return (
    inspected.error === undefined &&
    inspected.status !== 0 &&
    listed.error === undefined &&
    listed.status === 0 &&
    outputLines(listed.stdout).length === 0
  );
}

function parsePreflight(stdout, expectedStatus) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Container preflight returned invalid JSON.");
  }
  if (
    value?.schemaVersion !== "1" ||
    value?.status !== expectedStatus ||
    value?.dynamicIsolationVerified !== false ||
    value?.liveCodexExecuted !== false
  ) {
    throw new Error("Container preflight returned an invalid static receipt.");
  }
  return value;
}

function assertPlainDirectory(path, label) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry === undefined || !entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a plain directory.`);
  }
  return realpathSync.native(path);
}

function assertPhysicalChild(parent, candidate, label) {
  const path = relative(parent, candidate);
  if (path.length === 0 || path.startsWith("..") || isAbsolute(path)) {
    throw new Error(`${label} escapes its managed parent.`);
  }
  return path;
}

function ensureManagedDirectory(path, physicalParent, label) {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
    mkdirSync(path, { recursive: false });
  }
  const physicalPath = assertPlainDirectory(path, label);
  assertPhysicalChild(physicalParent, physicalPath, label);
  return physicalPath;
}

function assertExactMode(path, mode, label) {
  if (process.platform !== "linux") return;
  const stat = lstatSync(path);
  if ((stat.mode & 0o777) !== mode) {
    throw new Error(`${label} permissions are not exact.`);
  }
}

export function assertSafeRunRoot(runRoot, repositoryRoot = ROOT) {
  const root = resolve(repositoryRoot);
  const physicalRoot = assertPlainDirectory(root, "Repository root");
  const temporaryRoot = resolve(root, ".tmp");
  const physicalTemporaryRoot = assertPlainDirectory(temporaryRoot, "Managed .tmp directory");
  assertPhysicalChild(physicalRoot, physicalTemporaryRoot, "Managed .tmp directory");
  const managedRoot = resolve(temporaryRoot, "worker-runs");
  const physicalManagedRoot = assertPlainDirectory(
    managedRoot,
    "Managed worker-runs directory",
  );
  assertPhysicalChild(
    physicalTemporaryRoot,
    physicalManagedRoot,
    "Managed worker-runs directory",
  );
  const candidate = resolve(runRoot);
  const path = relative(managedRoot, candidate);
  if (!RUN_ID.test(path)) {
    throw new Error("Refusing to manage an unsafe worker run path.");
  }
  const physicalCandidate = assertPlainDirectory(candidate, "Worker run directory");
  const physicalPath = assertPhysicalChild(
    physicalManagedRoot,
    physicalCandidate,
    "Worker run directory",
  );
  if (!RUN_ID.test(physicalPath)) {
    throw new Error("Worker run directory is not a direct managed child.");
  }
  return candidate;
}

export function prepareWorkerRunRoot({ repositoryRoot = ROOT, runId }) {
  if (!RUN_ID.test(runId)) {
    throw new Error("Worker run ID is invalid.");
  }
  const root = resolve(repositoryRoot);
  const physicalRoot = assertPlainDirectory(root, "Repository root");
  const temporaryRoot = resolve(root, ".tmp");
  const physicalTemporaryRoot = ensureManagedDirectory(
    temporaryRoot,
    physicalRoot,
    "Managed .tmp directory",
  );
  const managedRoot = resolve(temporaryRoot, "worker-runs");
  ensureManagedDirectory(
    managedRoot,
    physicalTemporaryRoot,
    "Managed worker-runs directory",
  );
  const candidate = resolve(managedRoot, runId);
  if (lstatSync(candidate, { throwIfNoEntry: false }) !== undefined) {
    throw new Error("Worker run directory already exists.");
  }
  mkdirSync(candidate, { recursive: false, mode: 0o700 });
  chmodSync(candidate, 0o700);
  assertExactMode(candidate, 0o700, "Worker run directory");
  return assertSafeRunRoot(candidate, root);
}

export function removeSafeWorkerRunRoot(runRoot, repositoryRoot = ROOT) {
  const safe = assertSafeRunRoot(runRoot, repositoryRoot);
  rmSync(safe, { recursive: true, force: true });
  if (existsSync(safe)) {
    throw new Error("Worker run workspace still exists.");
  }
}

async function main() {
  const contract = JSON.parse(readFileSync(resolve(ROOT, "container-contract.json"), "utf8"));
  const buildInputs = {
    worker: computeContainerBuildInput("worker"),
    verifier: computeContainerBuildInput("verifier"),
    egress: computeContainerBuildInput("egress"),
  };
  const readiness = inspectWorkerContainerPrerequisites(contract, buildInputs);
  const facts = {
    dockerServerVersion: null,
    canonicalDockerCliVerified: false,
    platformLocalDaemonSelected: false,
    nodeBaseImagePresent: false,
    workerImageBuilt: false,
    workerImageId: null,
    workerBuildInputSha256: buildInputs.worker.sha256,
    verifierImageBuilt: false,
    verifierImageId: null,
    verifierBuildInputSha256: buildInputs.verifier.sha256,
    egressProxyBuildInputSha256: buildInputs.egress.sha256,
    workerNetworkId: null,
    workerNetworkOwnershipVerified: false,
    workerNetworkInternal: false,
    workerStaticPreflight: false,
    verificationReconstructed: false,
    reconstructedPaths: [],
    baselineContentSha256: null,
    repairOverlaySha256: null,
    verificationContentSha256: null,
    verifierCommandsPassed: false,
    requestLimitsBound: false,
    workerCgroupObserved: false,
    verifierCgroupObserved: false,
    restartPolicyVerified: false,
    runningInstanceIdentityVerified: false,
    roleCpuBudgetsPostExitObserved: false,
    cumulativeCpuTimeEnforced: false,
    processTreesReaped: false,
    cleanupPassed: false,
    egressProxyVerified: false,
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  };
  const failures = [...readiness.failures];
  let dockerInvoked = false;
  let runRoot = null;
  let workerId = null;
  let verifierId = null;
  let workerNetworkId = null;
  let workerTag = null;
  let verifierTag = null;
  let cleanupFailed = false;
  let plan = null;
  let bindingSha256 = null;
  let workerCgroup = null;
  let verifierCgroup = null;
  let workerCpuBudgetVerified = false;
  let verifierCpuBudgetVerified = false;

  try {
    if (failures.length > 0) throw new Error("Worker container prerequisites are incomplete.");
    const build = spawnSync(process.execPath, ["scripts/build-core.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 120_000,
      windowsHide: true,
    });
    if (build.error !== undefined || build.status !== 0) {
      throw new Error("Worker runtime plan build failed.");
    }
    pinnedDocker = createPinnedDockerSync({
      repositoryRoot: ROOT,
      dockerExecutablePath: process.env.POLICYTWIN_DOCKER_CLI,
    });
    facts.canonicalDockerCliVerified = true;
    facts.platformLocalDaemonSelected = true;
    dockerInvoked = true;
    facts.dockerServerVersion = docker(["info", "--format", "{{.ServerVersion}}"], 10_000)
      .stdout.trim();
    docker(["image", "inspect", contract.nodeBaseImage]);
    facts.nodeBaseImagePresent = true;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    workerTag = `policytwin-worker-verify:${suffix}`;
    verifierTag = `policytwin-verifier-verify:${suffix}`;
    docker(
      [
        "build",
        "--platform",
        contract.targetPlatform,
        "--build-arg",
        `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
        "--file",
        "Dockerfile.worker",
        "--tag",
        workerTag,
        ".",
      ],
      20 * 60_000,
    );
    facts.workerImageId = docker(["image", "inspect", "--format", "{{.Id}}", workerTag])
      .stdout.trim();
    facts.workerImageBuilt = true;
    docker(
      [
        "build",
        "--platform",
        contract.targetPlatform,
        "--build-arg",
        `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
        "--file",
        "Dockerfile.verifier",
        "--tag",
        verifierTag,
        ".",
      ],
      20 * 60_000,
    );
    facts.verifierImageId = docker([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      verifierTag,
    ]).stdout.trim();
    facts.verifierImageBuilt = true;
    const runId = `runtime-${suffix}`;
    const ownershipNonce = randomBytes(16).toString("hex");
    const requestSha256 = createHash("sha256")
      .update("policytwin-worker-dynamic-smoke", "utf8")
      .update("\0", "utf8")
      .update(runId, "utf8")
      .digest("hex");
    const {
      buildWorkerRuntimePlan,
      createWorkerRuntimeLayout,
      OBSERVED_WORKER_NETWORK_ID,
      reconstructVerificationWorkspace,
      supervisorDockerBindingSha256,
    } = await import("../dist/codex/worker-runtime-contract.js");
    const {
      parseDockerContainerInspection,
      parseDockerContainerOwnershipInspection,
      parseDockerNetworkInspection,
      parseDockerNetworkOwnershipInspection,
    } = await import("../dist/codex/docker-observer.js");
    bindingSha256 = supervisorDockerBindingSha256(
      requestSha256,
      runId,
      ownershipNonce,
    );
    const workerNetwork = `policytwin-worker-${bindingSha256.slice(0, 32)}`;
    const networkLabels = {
      "com.policytwin.managed": "true",
      "com.policytwin.contract-version": "2",
      "com.policytwin.binding-sha256": bindingSha256,
      "com.policytwin.request-sha256": requestSha256,
      "com.policytwin.run-id": runId,
      "com.policytwin.role": "worker-internal",
    };
    const existingNetwork = docker([
      "network",
      "ls",
      "--no-trunc",
      "--filter",
      `name=^${workerNetwork}$`,
      "--format",
      "{{.ID}}",
    ]).stdout.trim();
    if (existingNetwork.length !== 0) {
      throw new Error("Worker dynamic network name already exists.");
    }
    const workerNetworkCandidateId = requiredDockerId(
      docker([
        "network",
        "create",
        "--driver",
        "bridge",
        "--scope",
        "local",
        "--attachable=false",
        "--internal",
        ...Object.entries(networkLabels)
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        workerNetwork,
      ]).stdout,
      "Worker network creation",
    );
    const workerNetworkOwnership = docker(["network", "inspect", workerNetworkCandidateId]);
    parseDockerNetworkOwnershipInspection(workerNetworkOwnership.stdout, {
      id: workerNetworkCandidateId,
      name: workerNetwork,
      labels: networkLabels,
    });
    parseDockerNetworkInspection(workerNetworkOwnership.stdout, {
      id: workerNetworkCandidateId,
      name: workerNetwork,
      internal: true,
      labels: networkLabels,
      containerIds: [],
    });
    workerNetworkId = workerNetworkCandidateId;
    facts.workerNetworkId = workerNetworkId;
    facts.workerNetworkInternal = true;
    facts.workerNetworkOwnershipVerified = true;

    runRoot = prepareWorkerRunRoot({ repositoryRoot: ROOT, runId });
    const baseline = resolve(ROOT, "fixtures", "refund-demo", "baseline");
    mkdirSync(resolve(runRoot, "repair", "src"), { recursive: true });
    mkdirSync(resolve(runRoot, "repair", "tests"), { recursive: true });
    copyFileSync(
      resolve(baseline, "src", "refund.ts"),
      resolve(runRoot, "repair", "src", "refund.ts"),
    );
    copyFileSync(
      resolve(baseline, "tests", "refund.test.mjs"),
      resolve(runRoot, "repair", "tests", "refund.test.mjs"),
    );
    cpSync(baseline, resolve(runRoot, "verify"), { recursive: true, errorOnExist: true });
    mkdirSync(resolve(runRoot, "verify", "dist"), { recursive: true });
    const repairSource = resolve(runRoot, "repair", "src", "refund.ts");
    const repairTest = resolve(runRoot, "repair", "tests", "refund.test.mjs");
    const requestPath = resolve(runRoot, "request.json");
    const responsePath = resolve(runRoot, "response.json");
    const tokenPath = resolve(runRoot, "proxy-token");
    const proxyCaPath = resolve(runRoot, "proxy-ca.pem");
    writeFileSync(requestPath, "{}\n", "utf8");
    writeFileSync(responsePath, "", "utf8");
    writeFileSync(tokenPath, randomBytes(32).toString("base64url"), {
      encoding: "utf8",
      mode: 0o444,
    });
    writeFileSync(
      proxyCaPath,
      "-----BEGIN CERTIFICATE-----\nSTATIC-SMOKE-PLACEHOLDER\n-----END CERTIFICATE-----\n",
      { encoding: "utf8", mode: 0o444 },
    );
    chmodSync(repairSource, 0o666);
    chmodSync(repairTest, 0o666);
    chmodSync(requestPath, 0o444);
    chmodSync(responsePath, 0o666);
    chmodSync(tokenPath, 0o444);
    chmodSync(proxyCaPath, 0o444);
    assertExactMode(runRoot, 0o700, "Worker run directory");
    assertExactMode(requestPath, 0o444, "Worker request");
    assertExactMode(tokenPath, 0o444, "Worker proxy capability");
    assertExactMode(proxyCaPath, 0o444, "Worker proxy CA");

    const runtimeLayout = createWorkerRuntimeLayout({ repositoryRoot: ROOT, runId });
    plan = buildWorkerRuntimePlan({
      repositoryRoot: ROOT,
      runId,
      workerImage: facts.workerImageId,
      verifierImage: facts.verifierImageId,
      workerNetwork,
      ownershipNonce,
      requestSha256,
      limits: {
        wallTimeMs: 60_000,
        cpuTimeMs: 30_000,
        memoryBytes: 1_073_741_824,
        pids: 64,
        outputBytes: 4_194_304,
      },
    });
    if (
      plan.worker.memoryBytes !== 1_073_741_824 ||
      plan.worker.pidsLimit !== 64 ||
      plan.worker.wallTimeMs !== 60_000 ||
      plan.worker.cpuTimeMs !== 30_000 ||
      plan.worker.outputBytes !== 4_194_304 ||
      plan.worker.cpuTimeEnforcement !== "UNAVAILABLE_STATIC_DRIVER"
    ) {
      throw new Error("Worker request limits are not bound to the runtime plan.");
    }
    facts.requestLimitsBound = true;
    const workerCreateArgs = ["create", ...plan.worker.dockerArgs.slice(2)].map((argument) =>
      argument === OBSERVED_WORKER_NETWORK_ID ? workerNetworkId : argument,
    );
    workerCreateArgs.push("--observation-hold-ms=5000");
    const workerCandidateId = requiredDockerId(
      docker(workerCreateArgs).stdout,
      "Worker container creation",
    );
    const workerOwnership = docker(["container", "inspect", workerCandidateId]);
    parseDockerContainerOwnershipInspection(workerOwnership.stdout, {
      id: workerCandidateId,
      name: plan.worker.name,
      labels: plan.worker.labels,
    });
    workerId = workerCandidateId;
    parseDockerNetworkInspection(docker(["network", "inspect", workerNetworkId]).stdout, {
      id: workerNetworkId,
      name: workerNetwork,
      internal: true,
      labels: networkLabels,
      containerIds: [workerId],
    });
    const workerInspectionExpectation = {
      id: workerId,
      name: plan.worker.name,
      image: plan.worker.image,
      user: plan.worker.user,
      entrypoint: plan.worker.entrypoint,
      workingDirectory: plan.worker.workingDirectory,
      labels: plan.worker.labels,
      pidsLimit: plan.worker.pidsLimit,
      memoryBytes: plan.worker.memoryBytes,
      memorySwapBytes: plan.worker.memorySwapBytes,
      nanoCpus: plan.worker.nanoCpus,
      fileSizeLimitBytes: plan.worker.fileSizeLimitBytes,
      logDriver: plan.worker.logDriver,
      logOptions: plan.worker.logOptions,
      creationNetwork: { name: workerNetwork, id: workerNetworkId },
      requiredEnvironment: plan.worker.environment,
      imageEnvironment: plan.worker.imageEnvironment,
      commandArgs: [...plan.worker.commandArgs, "--observation-hold-ms=5000"],
      bindMounts: plan.worker.mounts.map((mount) => ({
        source: mount.source,
        destination: mount.target,
        readOnly: mount.readOnly,
      })),
      tmpfsMounts: plan.worker.tmpfsMounts.map((mount) => ({
        destination: mount.target,
        sizeBytes: mount.sizeBytes,
      })),
      networks: [{ name: workerNetwork, id: workerNetworkId, requiredAliases: [] }],
    };
    parseDockerContainerInspection(
      docker(["container", "inspect", workerId]).stdout,
      workerInspectionExpectation,
    );
    if (docker(["port", workerId]).stdout.trim().length !== 0) {
      throw new Error("Worker container published a host port.");
    }
    docker(["start", workerId]);
    const runningWorker = parseDockerContainerInspection(
      docker(["container", "inspect", workerId]).stdout,
      workerInspectionExpectation,
    );
    assertRunningContainerInstance(runningWorker, "Worker");
    workerCgroup = observeLinuxCgroupV2(runningWorker.pid, workerId);
    facts.workerCgroupObserved = true;
    if (docker(["wait", workerId], 60_000).stdout.trim() !== "0") {
      throw new Error("Worker static preflight exited unsuccessfully.");
    }
    const stoppedWorkerBeforeLogs = parseDockerContainerInspection(
      docker(["container", "inspect", workerId]).stdout,
      workerInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningWorker, stoppedWorkerBeforeLogs, "Worker");
    try {
      const finalCpuUsageUsec = readLinuxCgroupCpuUsageUsec(workerCgroup);
      workerCpuBudgetVerified =
        finalCpuUsageUsec - workerCgroup.initialCpuUsageUsec <= plan.worker.cpuTimeMs * 1_000;
    } catch {
      workerCpuBudgetVerified = false;
    }
    const workerLogs = docker(["logs", workerId]);
    const stoppedWorkerAfterLogs = parseDockerContainerInspection(
      docker(["container", "inspect", workerId]).stdout,
      workerInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningWorker, stoppedWorkerAfterLogs, "Worker");
    parsePreflight(workerLogs.stdout, "STATIC_PREFLIGHT_PASS");
    docker(["network", "disconnect", "--force", workerNetworkId, workerId]);
    docker(["rm", "--force", workerId]);
    parseDockerNetworkInspection(docker(["network", "inspect", workerNetworkId]).stdout, {
      id: workerNetworkId,
      name: workerNetwork,
      internal: true,
      labels: networkLabels,
      containerIds: [],
    });
    const response = JSON.parse(readFileSync(responsePath, "utf8"));
    if (response?.schemaVersion !== "1" || response?.status !== "STATIC_PREFLIGHT_PASS") {
      throw new Error("Worker response overlay was not writable.");
    }
    facts.workerStaticPreflight = true;
    const reconstruction = reconstructVerificationWorkspace(runtimeLayout);
    facts.verificationReconstructed = true;
    facts.reconstructedPaths = reconstruction.copiedPaths;
    facts.baselineContentSha256 = reconstruction.baselineContentSha256;
    facts.repairOverlaySha256 = reconstruction.repairOverlaySha256;
    facts.verificationContentSha256 = reconstruction.verificationContentSha256;
    const verifierCreateArgs = ["create", ...plan.verifier.dockerArgs.slice(2)];
    verifierCreateArgs.push("--observation-hold-ms=5000");
    const verifierCandidateId = requiredDockerId(
      docker(verifierCreateArgs).stdout,
      "Verifier container creation",
    );
    const verifierOwnership = docker(["container", "inspect", verifierCandidateId]);
    parseDockerContainerOwnershipInspection(verifierOwnership.stdout, {
      id: verifierCandidateId,
      name: plan.verifier.name,
      labels: plan.verifier.labels,
    });
    verifierId = verifierCandidateId;
    const verifierInspectionExpectation = {
      id: verifierId,
      name: plan.verifier.name,
      image: plan.verifier.image,
      user: plan.verifier.user,
      entrypoint: plan.verifier.entrypoint,
      workingDirectory: plan.verifier.workingDirectory,
      labels: plan.verifier.labels,
      pidsLimit: plan.verifier.pidsLimit,
      memoryBytes: plan.verifier.memoryBytes,
      memorySwapBytes: plan.verifier.memorySwapBytes,
      nanoCpus: plan.verifier.nanoCpus,
      fileSizeLimitBytes: plan.verifier.fileSizeLimitBytes,
      logDriver: plan.verifier.logDriver,
      logOptions: plan.verifier.logOptions,
      creationNetwork: "none",
      requiredEnvironment: plan.verifier.environment,
      imageEnvironment: plan.verifier.imageEnvironment,
      commandArgs: [...plan.verifier.commandArgs, "--observation-hold-ms=5000"],
      bindMounts: plan.verifier.mounts.map((mount) => ({
        source: mount.source,
        destination: mount.target,
        readOnly: mount.readOnly,
      })),
      tmpfsMounts: plan.verifier.tmpfsMounts.map((mount) => ({
        destination: mount.target,
        sizeBytes: mount.sizeBytes,
      })),
      networks: [],
    };
    parseDockerContainerInspection(
      docker(["container", "inspect", verifierId]).stdout,
      verifierInspectionExpectation,
    );
    if (docker(["port", verifierId]).stdout.trim().length !== 0) {
      throw new Error("Verifier container published a host port.");
    }
    docker(["start", verifierId]);
    const runningVerifier = parseDockerContainerInspection(
      docker(["container", "inspect", verifierId]).stdout,
      verifierInspectionExpectation,
    );
    assertRunningContainerInstance(runningVerifier, "Verifier");
    verifierCgroup = observeLinuxCgroupV2(runningVerifier.pid, verifierId);
    facts.verifierCgroupObserved = true;
    if (docker(["wait", verifierId], 60_000).stdout.trim() !== "0") {
      throw new Error("Verifier exited unsuccessfully.");
    }
    const stoppedVerifierBeforeLogs = parseDockerContainerInspection(
      docker(["container", "inspect", verifierId]).stdout,
      verifierInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningVerifier, stoppedVerifierBeforeLogs, "Verifier");
    try {
      const finalCpuUsageUsec = readLinuxCgroupCpuUsageUsec(verifierCgroup);
      verifierCpuBudgetVerified =
        finalCpuUsageUsec - verifierCgroup.initialCpuUsageUsec <= plan.verifier.cpuTimeMs * 1_000;
    } catch {
      verifierCpuBudgetVerified = false;
    }
    const verifierLogs = docker(["logs", verifierId]);
    const stoppedVerifierAfterLogs = parseDockerContainerInspection(
      docker(["container", "inspect", verifierId]).stdout,
      verifierInspectionExpectation,
    );
    assertStoppedSameContainerInstance(runningVerifier, stoppedVerifierAfterLogs, "Verifier");
    const verifierReceipt = parsePreflight(verifierLogs.stdout, "FIXTURE_COMMANDS_PASS");
    if (verifierReceipt.credentialsPresent !== false) {
      throw new Error("Verifier reported credential exposure.");
    }
    docker(["rm", "--force", verifierId]);
    facts.restartPolicyVerified = true;
    facts.runningInstanceIdentityVerified = true;
    facts.verifierCommandsPassed = true;
  } catch (error) {
    if (failures.length === 0) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (dockerInvoked) {
      for (const id of [workerId, verifierId]) {
        if (id === null) continue;
        const inspect = docker(["container", "inspect", id], 10_000, true);
        if (inspect.status === 0) {
          docker(["stop", "--time", "5", id], 15_000, true);
          if (workerNetworkId !== null) {
            docker(["network", "disconnect", "--force", workerNetworkId, id], 15_000, true);
          }
          const removed = docker(["rm", "--force", id], 30_000, true);
          if (removed.status !== 0 || removed.error !== undefined) {
            cleanupFailed = true;
            failures.push("Worker container cleanup failed.");
          }
        }
      }
      if (workerNetworkId !== null) {
        const inspected = docker(["network", "inspect", workerNetworkId], 10_000, true);
        if (inspected.status === 0) {
          try {
            const network = JSON.parse(inspected.stdout)?.[0];
            if (Object.keys(network?.Containers ?? {}).length !== 0) {
              cleanupFailed = true;
              failures.push("Worker network still has an unexpected endpoint.");
            } else {
              const removed = docker(["network", "rm", workerNetworkId], 30_000, true);
              if (removed.status !== 0 || removed.error !== undefined) {
                cleanupFailed = true;
                failures.push("Worker network cleanup failed.");
              }
            }
          } catch {
            cleanupFailed = true;
            failures.push("Worker network cleanup observation failed.");
          }
        }
      }
      for (const tag of [workerTag, verifierTag]) {
        if (tag === null) continue;
        const inspect = docker(["image", "inspect", tag], 10_000, true);
        if (inspect.status === 0) {
          const removed = docker(["image", "rm", tag], 60_000, true);
          if (removed.status !== 0 || removed.error !== undefined) {
            cleanupFailed = true;
            failures.push("Worker image cleanup failed.");
          }
        }
        if (!imageTagAbsent(tag)) {
          cleanupFailed = true;
          failures.push("Worker image tag cleanup was not independently observed.");
        }
      }
    }
    if (runRoot !== null) {
      try {
        removeSafeWorkerRunRoot(runRoot);
      } catch {
        cleanupFailed = true;
        failures.push("Worker run workspace cleanup failed.");
      }
    }
    if (bindingSha256 !== null) {
      for (const [id, role] of [[workerId, "worker"], [verifierId, "verifier"]]) {
        if (!containerRoleAbsent(id, bindingSha256, role)) {
          cleanupFailed = true;
          failures.push(`Docker ${role} absence was not independently observed.`);
        }
      }
      if (!networkRoleAbsent(workerNetworkId, bindingSha256, "worker-internal")) {
        cleanupFailed = true;
        failures.push("Docker worker network absence was not independently observed.");
      }
    }
    let processTreesReaped = workerCgroup !== null && verifierCgroup !== null;
    for (const cgroup of [workerCgroup, verifierCgroup]) {
      if (cgroup === null) continue;
      try {
        assertLinuxCgroupProcessTreeEmpty(cgroup);
      } catch {
        processTreesReaped = false;
        cleanupFailed = true;
        failures.push("A container cgroup still has an unobserved process tree.");
      }
    }
    facts.processTreesReaped = processTreesReaped;
    facts.roleCpuBudgetsPostExitObserved =
      workerCpuBudgetVerified && verifierCpuBudgetVerified;
    facts.cleanupPassed = dockerInvoked && !cleanupFailed;
    facts.dynamicIsolationVerified =
      failures.length === 0 &&
      facts.requestLimitsBound &&
      facts.workerNetworkOwnershipVerified &&
      facts.workerCgroupObserved &&
      facts.verifierCgroupObserved &&
      facts.restartPolicyVerified &&
      facts.runningInstanceIdentityVerified &&
      facts.processTreesReaped &&
      facts.roleCpuBudgetsPostExitObserved &&
      facts.workerStaticPreflight &&
      facts.verifierCommandsPassed &&
      facts.cleanupPassed;
  }

  const report = {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    scope: "DYNAMIC_WORKER_VERIFIER_ISOLATION_SMOKE_CPU_TIME_UNAVAILABLE_NOT_LIVE_CODEX",
    dockerInvoked,
    facts,
    releaseReady: false,
    failures: [...new Set(failures)],
  };
  const directory = resolve(ROOT, "artifacts", "security");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "worker-container-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (report.status !== "PASS") {
    console.error(`Worker container verification failed: ${report.failures.join(" ")}`);
    process.exit(1);
  }
  console.log(
    "Worker/verifier dynamic smoke passed without live Codex; egress proxy and live evidence remain unverified.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
