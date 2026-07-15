import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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
import { ROOT } from "./process.mjs";

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
  if (contract?.schemaVersion !== "4") failures.push("container schema v4 is required");
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

function docker(args, timeoutMs = 60_000, allowFailure = false) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (!allowFailure && (result.error !== undefined || result.status !== 0)) {
    throw new Error(`Docker ${args[0] ?? "command"} failed.`);
  }
  return result;
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
  mkdirSync(candidate, { recursive: false });
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
    nodeBaseImagePresent: false,
    workerImageBuilt: false,
    workerImageId: null,
    workerBuildInputSha256: buildInputs.worker.sha256,
    verifierImageBuilt: false,
    verifierImageId: null,
    verifierBuildInputSha256: buildInputs.verifier.sha256,
    egressProxyBuildInputSha256: buildInputs.egress.sha256,
    workerNetworkInternal: false,
    workerStaticPreflight: false,
    verificationReconstructed: false,
    reconstructedPaths: [],
    baselineContentSha256: null,
    repairOverlaySha256: null,
    verificationContentSha256: null,
    verifierCommandsPassed: false,
    cleanupPassed: false,
    egressProxyVerified: false,
    dynamicIsolationVerified: false,
    liveCodexExecuted: false,
  };
  const failures = [...readiness.failures];
  let dockerInvoked = false;
  let runRoot = null;
  let workerName = null;
  let verifierName = null;
  let workerTag = null;
  let verifierTag = null;
  let cleanupFailed = false;

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
    const network = JSON.parse(
      docker(["network", "inspect", contract.workerContainer.network]).stdout,
    );
    if (network?.[0]?.Internal !== true) {
      throw new Error("Worker network is not internal-only.");
    }
    facts.workerNetworkInternal = true;

    const runId = `runtime-${suffix}`;
    runRoot = prepareWorkerRunRoot({ repositoryRoot: ROOT, runId });
    workerName = `policytwin-worker-${runId}`;
    verifierName = `policytwin-verifier-${runId}`;
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

    const {
      buildWorkerRuntimePlan,
      createWorkerRuntimeLayout,
      reconstructVerificationWorkspace,
    } = await import("../dist/codex/worker-runtime-contract.js");
    const runtimeLayout = createWorkerRuntimeLayout({ repositoryRoot: ROOT, runId });
    const plan = buildWorkerRuntimePlan({
      repositoryRoot: ROOT,
      runId,
      workerImage: facts.workerImageId,
      verifierImage: facts.verifierImageId,
    });
    const worker = docker([...plan.worker.dockerArgs], 60_000);
    parsePreflight(worker.stdout, "STATIC_PREFLIGHT_PASS");
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
    const verifier = docker([...plan.verifier.dockerArgs, "--verify"], 60_000);
    const verifierReceipt = parsePreflight(verifier.stdout, "FIXTURE_COMMANDS_PASS");
    if (verifierReceipt.credentialsPresent !== false) {
      throw new Error("Verifier reported credential exposure.");
    }
    facts.verifierCommandsPassed = true;
  } catch (error) {
    if (failures.length === 0) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (dockerInvoked) {
      for (const name of [workerName, verifierName]) {
        if (name === null) continue;
        const inspect = docker(["container", "inspect", name], 10_000, true);
        if (inspect.status === 0) {
          const removed = docker(["rm", "--force", name], 30_000, true);
          if (removed.status !== 0 || removed.error !== undefined) {
            cleanupFailed = true;
            failures.push("Worker container cleanup failed.");
          }
        }
      }
      for (const tag of [workerTag, verifierTag]) {
        if (tag === null) continue;
        const inspect = docker(["image", "inspect", tag], 10_000, true);
        if (inspect.status === 0) {
          const removed = docker(["image", "rm", "--force", tag], 60_000, true);
          if (removed.status !== 0 || removed.error !== undefined) {
            cleanupFailed = true;
            failures.push("Worker image cleanup failed.");
          }
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
    facts.cleanupPassed = dockerInvoked && !cleanupFailed;
  }

  const report = {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    scope: "DYNAMIC_WORKER_VERIFIER_SMOKE_NOT_LIVE_CODEX",
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
