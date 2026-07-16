import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { computeContainerBuildInput } from "../../scripts/container-build-inputs.mjs";
import { inspectStaticContainerContract } from "../../scripts/container-check.mjs";
import { inspectEgressContainerPrerequisites } from "../../scripts/egress-container-verify.mjs";
import {
  inspectWorkerContainerPrerequisites,
  prepareWorkerRunRoot,
  removeSafeWorkerRunRoot,
} from "../../scripts/worker-container-verify.mjs";

test("static web, worker, and verifier contracts remain non-live and fail closed", async () => {
  const report = inspectStaticContainerContract();
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.scope, "STATIC_WEB_WORKER_VERIFIER_EGRESS_CONTAINERS");
  assert.equal(
    report.sourceInspectionMethod,
    "STRUCTURAL_JSON_AND_REQUIRED_SOURCE_MARKERS",
  );
  assert.equal(report.behavioralVerification, "SEPARATE_UNIT_AND_INTEGRATION_TESTS");
  assert.equal(report.baseImagePinned, false);
  assert.equal(report.workerImagePinned, false);
  assert.equal(report.verifierImagePinned, false);
  assert.equal(report.egressProxyImagePinned, false);
  assert.equal(report.dynamicContainerVerified, false);
  assert.equal(report.webContainerIncludesLiveCodexWorker, false);
  assert.equal(report.workerContainerStatus, "STATIC_PREPARED");
  assert.equal(report.verifierContainerStatus, "STATIC_PREPARED");
  assert.equal(report.egressProxyStatus, "STATIC_PREPARED");
  assert.equal(report.releaseReady, false);
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  assert.equal(contract.schemaVersion, "12");
  assert.equal(contract.workerContainer.liveCpuEvidenceProducerStateMachineImplemented, true);
  assert.equal(
    contract.workerContainer.liveCpuEvidenceProducerCandidateStatus,
    "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE",
  );
  assert.equal(
    contract.workerContainer.liveCpuEvidenceProducerProvenance,
    "SYNTHETIC_CONTRACT_ONLY",
  );
  assert.equal(contract.workerContainer.liveCpuEvidenceProducerPassSigningEligible, false);
  assert.equal(
    contract.workerContainer.liveCpuPrivateAdapterCapabilityScaffoldImplemented,
    true,
  );
  assert.equal(
    contract.workerContainer.liveCpuFinalizedEvidenceIdentityGuardScaffoldImplemented,
    true,
  );
  assert.equal(contract.workerContainer.liveCpuFinalizedEvidenceIssuanceImplemented, false);
  assert.equal(contract.workerContainer.liveCpuSignerFinalizedCapabilityRequired, true);
  assert.equal(
    contract.workerContainer.liveCpuSignerFinalizedCapabilityAdmissionImplemented,
    false,
  );
  assert.equal(contract.workerContainer.liveCpuDedicatedLifecycleContractImplemented, true);
  assert.equal(contract.workerContainer.liveCpuDedicatedLifecycleSuccessStageCount, 28);
  assert.equal(contract.workerContainer.liveCpuStartBarrierProtocolImplemented, true);
  assert.equal(
    contract.workerContainer.liveCpuStartBarrierHostOwnedReceiptSlotsImplemented,
    true,
  );
  assert.equal(
    contract.workerContainer.liveCpuStartBarrierReceiptCommitBindingImplemented,
    true,
  );
  assert.equal(
    contract.workerContainer.liveCpuStartBarrierConcurrentReleaseGuardImplemented,
    true,
  );
  assert.equal(contract.workerContainer.liveCpuStartBarrierRoleLauncherBundled, true);
  assert.equal(contract.workerContainer.liveCpuStartBarrierNodeOptionsLocked, true);
  assert.equal(contract.workerContainer.liveCpuDedicatedLifecycleHarnessImplemented, true);
  assert.equal(
    contract.workerContainer.liveCpuDedicatedLifecycleHarnessProvenance,
    "NON_PRIVILEGED_TEST_PORT",
  );
  assert.equal(
    contract.workerContainer.liveCpuDedicatedLifecycleQuiescentFinalSamplingImplemented,
    true,
  );
  assert.equal(contract.workerContainer.liveCpuNativeHelperProtocolImplemented, true);
  assert.equal(contract.workerContainer.liveCpuNativeHelperSourceImplemented, true);
  assert.equal(contract.workerContainer.liveCpuNativeHelperClientImplemented, true);
  assert.equal(contract.workerContainer.liveCpuNativeHelperBuildVerified, false);
  assert.equal(contract.workerContainer.liveCpuNativeHelperRuntimeVerified, false);
  assert.equal(contract.workerContainer.liveCpuStartBarrierRuntimeImplemented, false);
  assert.equal(contract.workerContainer.liveCpuLinuxSystemAdapterImplemented, false);
  assert.equal(contract.workerContainer.liveCpuDedicatedLifecycleImplemented, false);
  assert.equal(
    contract.supervisorDockerExecutor.linuxCgroupObserverPurpose,
    "NON_LIVE_DYNAMIC_GATE_ONLY",
  );
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupObserverPrivateHandleRequired, true);
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupObserverDirectoryFdPinned, true);
  assert.equal(
    contract.supervisorDockerExecutor.linuxCgroupObserverDescendantQuiescenceRequired,
    true,
  );
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupObserverRuntimeVerified, false);
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupObserverStartBarrierImplemented, false);
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupObserverLiveEvidenceAdapter, false);
  assert.equal(contract.supervisorDockerExecutor.linuxStartBarrierProtocolImplemented, true);
  assert.equal(
    contract.supervisorDockerExecutor.linuxStartBarrierHostOwnedReceiptSlotsImplemented,
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxStartBarrierConcurrentReleaseGuardImplemented,
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxStartBarrierDockerIntegrationImplemented,
    false,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxNativeHelperFixedBinaryProtocolImplemented,
    true,
  );
  assert.equal(contract.supervisorDockerExecutor.linuxNativeHelperRuntimeVerified, false);
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupCpuActuationSourceImplemented, true);
});

test("worker dynamic verification rejects missing base and build-input tampering before Docker", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectWorkerContainerPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.equal(report.dockerInvoked, false);
  assert.deepEqual(report.failures, ["immutable Node base image is unset"]);
  const worker = computeContainerBuildInput("worker");
  const verifier = computeContainerBuildInput("verifier");
  const egress = computeContainerBuildInput("egress");
  const tampered = inspectWorkerContainerPrerequisites(contract, {
    worker: { ...worker, sha256: "0".repeat(64) },
    verifier,
    egress,
  });
  assert.equal(tampered.dockerInvoked, false);
  assert.match(tampered.failures.join(" "), /worker build inputs do not match/u);
});

test("egress dynamic verification rejects missing base and build-input tampering before Docker", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectEgressContainerPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.deepEqual(report.failures, ["immutable Node base image is unset"]);
  const worker = computeContainerBuildInput("worker");
  const egress = computeContainerBuildInput("egress");
  const tampered = inspectEgressContainerPrerequisites(contract, {
    worker,
    egress: { ...egress, sha256: "0".repeat(64) },
  });
  assert.match(tampered.failures.join(" "), /egress proxy build inputs do not match/u);
});

test("worker verification rejects linked managed roots before writes or cleanup", async (t) => {
  const roots = [];
  t.after(async () => {
    for (const root of roots.reverse()) {
      await rm(root, { recursive: true, force: true });
    }
  });
  const runId = "runtime-0123456789abcdef";
  for (const linkedSegment of [".tmp", "worker-runs"]) {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-root-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-outside-"));
    roots.push(repositoryRoot, outsideRoot);
    if (linkedSegment === ".tmp") {
      await symlink(
        outsideRoot,
        join(repositoryRoot, ".tmp"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } else {
      await mkdir(join(repositoryRoot, ".tmp"));
      await symlink(
        outsideRoot,
        join(repositoryRoot, ".tmp", "worker-runs"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    assert.throws(
      () => prepareWorkerRunRoot({ repositoryRoot, runId }),
      /must be a plain directory/u,
    );
    await assert.rejects(lstat(join(outsideRoot, runId)), { code: "ENOENT" });
  }

  const cleanupRepositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-cleanup-"));
  const cleanupOutsideRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-sentinel-"));
  roots.push(cleanupRepositoryRoot, cleanupOutsideRoot);
  const managedRoot = join(cleanupRepositoryRoot, ".tmp", "worker-runs");
  await mkdir(managedRoot, { recursive: true });
  const sentinelPath = join(cleanupOutsideRoot, "sentinel.txt");
  await writeFile(sentinelPath, "preserve\n", "utf8");
  await symlink(
    cleanupOutsideRoot,
    join(managedRoot, runId),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => removeSafeWorkerRunRoot(join(managedRoot, runId), cleanupRepositoryRoot),
    /must be a plain directory/u,
  );
  assert.equal(await readFile(sentinelPath, "utf8"), "preserve\n");
});

async function copyStaticContainerInputs(target) {
  for (const path of [
    "container-contract.json",
    "Dockerfile",
    "Dockerfile.worker",
    "Dockerfile.verifier",
    "Dockerfile.egress-proxy",
    ".dockerignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prompts",
    "schemas/live-linux-cgroup-cpu-proof.v1.schema.json",
    "schemas/live-linux-cgroup-cpu-evidence.v2.schema.json",
    "src",
    "tsconfig.build.json",
    "tsconfig.json",
    "next.config.ts",
    "app/api/health/route.ts",
    "scripts/build-core.mjs",
    "scripts/process.mjs",
    "scripts/worker-preflight.mjs",
    "scripts/role-start-barrier.mjs",
    "scripts/egress-tls-probe.mjs",
    "scripts/worker-entrypoint.mjs",
    "scripts/proxy-token-helper.mjs",
    "scripts/openai-egress-proxy.mjs",
    "scripts/verifier-preflight.mjs",
    "scripts/worker-container-verify.mjs",
    "scripts/egress-container-verify.mjs",
    "scripts/linux-cgroup-observer.mjs",
    "native/policytwin-linux-cgroup-helper.c",
    "scripts/container-verify.mjs",
    "scripts/live-gate-contract.mjs",
    "scripts/pinned-docker-cli.mjs",
  ]) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(path), destination, { recursive: true });
  }
}

test("static container inspection detects weakened verifier networking and fixture bundling", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-contract-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const contractPath = join(target, "container-contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  let report = inspectStaticContainerContract(target);
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");

  contract.workerContainer.liveRpcV2PassSigningEnabled = true;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);
  contract.workerContainer.liveRpcV2PassSigningEnabled = false;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  contract.workerContainer.liveCpuV2TransportFactoryCapabilityRequired = false;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);
  contract.workerContainer.liveCpuV2TransportFactoryCapabilityRequired = true;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  contract.workerContainer.liveCpuV2TransportInputsSnapshotted = false;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);
  contract.workerContainer.liveCpuV2TransportInputsSnapshotted = true;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  contract.supervisorDockerExecutor.linuxCgroupObserverRuntimeVerified = true;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);
  contract.supervisorDockerExecutor.linuxCgroupObserverRuntimeVerified = false;
  contract.supervisorDockerExecutor.linuxCgroupObserverCleanupActionFailureSticky = false;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);
  contract.supervisorDockerExecutor.linuxCgroupObserverCleanupActionFailureSticky = true;
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  const liveCpuSchemaPath = join(
    target,
    "schemas/live-linux-cgroup-cpu-proof.v1.schema.json",
  );
  const liveCpuSchema = JSON.parse(await readFile(liveCpuSchemaPath, "utf8"));
  liveCpuSchema.additionalProperties = true;
  await writeFile(liveCpuSchemaPath, `${JSON.stringify(liveCpuSchema, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /structurally weakened/u);
  await cp(
    resolve("schemas/live-linux-cgroup-cpu-proof.v1.schema.json"),
    liveCpuSchemaPath,
  );

  const liveCpuEvidenceSchemaPath = join(
    target,
    "schemas/live-linux-cgroup-cpu-evidence.v2.schema.json",
  );
  const liveCpuEvidenceSchema = JSON.parse(
    await readFile(liveCpuEvidenceSchemaPath, "utf8"),
  );
  liveCpuEvidenceSchema.oneOf.pop();
  await writeFile(
    liveCpuEvidenceSchemaPath,
    `${JSON.stringify(liveCpuEvidenceSchema, null, 2)}\n`,
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(
    report.failures.join(" "),
    /CPU evidence v2 JSON Schema is structurally weakened/u,
  );
  await cp(
    resolve("schemas/live-linux-cgroup-cpu-evidence.v2.schema.json"),
    liveCpuEvidenceSchemaPath,
  );

  const linuxCgroupObserverPath = join(target, "scripts/linux-cgroup-observer.mjs");
  const linuxCgroupObserver = await readFile(linuxCgroupObserverPath, "utf8");
  await writeFile(
    linuxCgroupObserverPath,
    linuxCgroupObserver.replace("const observations = new WeakMap();", "const observations = new Map();"),
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /Linux cgroup observer/u);
  await writeFile(linuxCgroupObserverPath, linuxCgroupObserver, "utf8");

  contract.verifierContainer.network = "bridge";
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /static web\/worker split/u);

  contract.verifierContainer.network = "none";
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  await writeFile(
    join(target, "Dockerfile.worker"),
    `${await readFile(join(target, "Dockerfile.worker"), "utf8")}\nCOPY fixtures/refund-demo/baseline /workspace\n`,
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /must not bundle fixtures/u);
});
