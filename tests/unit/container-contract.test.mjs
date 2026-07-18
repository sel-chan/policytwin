import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { computeContainerBuildInput } from "../../scripts/container-build-inputs.mjs";
import { inspectStaticContainerContract } from "../../scripts/container-check.mjs";
import { inspectEgressContainerPrerequisites } from "../../scripts/egress-container-verify.mjs";
import { inspectWebContainerPrerequisites } from "../../scripts/web-container-runtime.mjs";
import {
  inspectWorkerContainerPrerequisites,
  prepareWorkerRunRoot,
  removeSafeWorkerRunRoot,
} from "../../scripts/worker-container-verify.mjs";

test("static web, worker, and verifier contracts remain non-live and fail closed", async () => {
  const report = inspectStaticContainerContract();
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.scope, "STATIC_WEB_WORKER_VERIFIER_EGRESS_HELPER_CONTAINERS");
  assert.equal(
    report.sourceInspectionMethod,
    "STRUCTURAL_JSON_TYPESCRIPT_AST_AND_REQUIRED_SOURCE_MARKERS",
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
  assert.equal(
    report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
    false,
  );
  assert.deepEqual(report.unsignedVerifierCorpusCandidateProductionImports, []);
  assert.deepEqual(
    report.unsignedVerifierCorpusCandidateUnapprovedDynamicModuleExpressions,
    [],
  );
  assert.equal(report.verifierReviewBridgeSupportedProductionModuleEdgeDetected, false);
  assert.deepEqual(report.verifierReviewBridgeProductionImports, []);
  assert.deepEqual(report.verifierReviewBridgeUnapprovedDynamicModuleExpressions, []);
  assert.equal(report.releaseReady, false);
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  assert.equal(contract.schemaVersion, "15");
  assert.equal(contract.nativeHelper.status, "STATIC_SOURCE_AND_PACKAGE_PREPARED");
  assert.equal(contract.nativeHelper.builderImage, null);
  assert.equal(contract.nativeHelper.image, null);
  assert.equal(contract.nativeHelper.binarySha256, null);
  assert.equal(contract.nativeHelper.localToolchainBuildStatus, "PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND");
  assert.equal(contract.nativeHelper.localToolchainPinned, false);
  assert.equal(contract.nativeHelper.localRepeatedBuildsByteIdentical, true);
  assert.equal(contract.nativeHelper.liveGateArtifactGateRequired, true);
  assert.equal(contract.nativeHelper.imageBuildVerified, false);
  assert.equal(contract.nativeHelper.hostInstallVerified, false);
  assert.equal(contract.nativeHelper.runtimeVerified, false);
  assert.equal(contract.nativeHelper.passSigningEligible, false);
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
    contract.workerContainer.unsignedVerifierCorpusCandidateTimeObservationAuthority,
    "UNVERIFIED_CALLER_SUPPLIED",
  );
  assert.equal(
    contract.workerContainer.unsignedVerifierCorpusCandidateCommandTreesStableRequired,
    true,
  );
  assert.equal(
    contract.workerContainer.unsignedVerifierCorpusCandidateProductionImportsAllowed,
    false,
  );
  assert.equal(
    contract.workerContainer.unsignedVerifierCorpusCandidateProductionImportInspection,
    "TYPESCRIPT_AST_MODULE_RESOLUTION_AND_UNSUPPORTED_LOADER_REJECTION",
  );
  assert.equal(
    contract.workerContainer.unsignedVerifierCorpusCandidateRuntimeConnectionStatus,
    "STATIC_GRAPH_NO_SUPPORTED_EDGE_DETECTED_NOT_RUNTIME_PROOF",
  );
  assert.equal(contract.workerContainer.verifierExchangeContractImplemented, true);
  assert.equal(
    contract.workerContainer.verifierExchangeStatus,
    "SUPERVISOR_REVALIDATED_LOCAL_SNAPSHOT_NOT_RUNTIME_IMMUTABILITY_PROOF",
  );
  assert.equal(contract.workerContainer.verifierExchangeDurableReplay, "DURABLE_SQLITE");
  assert.equal(
    contract.workerContainer.verifierExchangeDurableRequestAttemptUniqueness,
    true,
  );
  assert.equal(contract.workerContainer.verifierExchangeDurableClockHighWater, true);
  assert.equal(contract.workerContainer.verifierExchangeExactSqliteSchemaRequired, true);
  assert.equal(contract.workerContainer.verifierExchangeRootExported, false);
  assert.equal(contract.workerContainer.verifierExchangeRuntimeConnected, false);
  assert.equal(contract.workerContainer.verifierExchangePassSigningEligible, false);
  assert.equal(
    contract.workerContainer.verifierCapabilityDeliveryStatus,
    "IN_PROCESS_PORT_HANDOFF_TESTABLE_NOT_VERIFIER_PROCESS_PROOF",
  );
  assert.equal(contract.workerContainer.verifierReviewBridgeImplemented, true);
  assert.equal(
    contract.workerContainer.verifierReviewBridgeStatus,
    "BOUND_NOT_RUNTIME_FINALIZED",
  );
  assert.equal(
    contract.workerContainer.verifierReviewBridgeReviewAuthority,
    "CALLER_SUPPLIED_REVIEW_ECHO_BOUND_NOT_RUNTIME_REVIEW_PROOF",
  );
  assert.equal(contract.workerContainer.verifierReviewBridgeRootExported, false);
  assert.equal(contract.workerContainer.verifierReviewBridgeRuntimeConnected, false);
  assert.equal(contract.workerContainer.verifierReviewBridgeProductionImportsAllowed, false);
  assert.equal(
    contract.workerContainer.verifierReviewBridgeProductionImportInspection,
    "TYPESCRIPT_AST_STATIC_AND_COMMON_LOADER_EDGE_SCAN_NOT_RUNTIME_OR_CODEGEN_PROOF",
  );
  assert.equal(contract.workerContainer.verifierReviewBridgePassSigningEligible, false);
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
  assert.equal(contract.workerContainer.liveCpuNativeHelperFullRoleSessionImplemented, true);
  assert.equal(contract.workerContainer.liveCpuNativeHelperArtifactPackagingImplemented, true);
  assert.equal(
    contract.workerContainer.liveCpuNativeHelperLocalBuildReproducibilityVerified,
    true,
  );
  assert.equal(contract.workerContainer.liveCpuDockerBarrierRolePlanImplemented, true);
  assert.equal(contract.workerContainer.liveCpuSupervisorSealedLifecyclePlanRequired, true);
  assert.equal(contract.workerContainer.liveCpuDockerOwnerFactoryImplemented, true);
  assert.equal(contract.workerContainer.liveCpuDockerOwnedNetworkFactoryImplemented, true);
  assert.equal(contract.workerContainer.liveCpuDockerNetworkAbsenceRequired, true);
  assert.equal(contract.workerContainer.liveCpuDockerReobservationReceiptsImplemented, true);
  assert.equal(contract.workerContainer.liveCpuDockerRemovalReceiptsImplemented, true);
  assert.equal(contract.workerContainer.liveCpuNativeHelperBuildVerified, false);
  assert.equal(contract.workerContainer.liveCpuNativeHelperRuntimeVerified, false);
  assert.equal(contract.workerContainer.liveCpuStartBarrierRuntimeImplemented, true);
  assert.equal(contract.workerContainer.liveCpuLinuxSystemAdapterImplemented, true);
  assert.equal(contract.workerContainer.liveCpuDedicatedLifecycleImplemented, true);
  assert.equal(contract.workerContainer.liveCpuPrivateRuntimeDynamicVerified, false);
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
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxSupervisorSealedLifecyclePlanRequired,
    true,
  );
  assert.equal(contract.supervisorDockerExecutor.linuxDockerOwnerFactoryImplemented, true);
  assert.equal(
    contract.supervisorDockerExecutor.linuxDockerOwnedNetworkFactoryImplemented,
    true,
  );
  assert.equal(contract.supervisorDockerExecutor.linuxDockerNetworkAbsenceRequired, true);
  assert.equal(contract.supervisorDockerExecutor.linuxDockerBindReobservationRequired, true);
  assert.equal(
    contract.supervisorDockerExecutor.linuxDockerRemovalReceiptRequiredBeforeCgroupRelease,
    true,
  );
  assert.equal(contract.supervisorDockerExecutor.linuxCgroupCpuActuationImplemented, true);
  assert.equal(
    contract.supervisorDockerExecutor.linuxNativeHelperFixedBinaryProtocolImplemented,
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxNativeHelperArtifactPackagingImplemented,
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxNativeHelperLocalBuildReproducibilityVerified,
    true,
  );
  assert.equal(
    contract.supervisorDockerExecutor.linuxNativeHelperArtifactImageBuildVerified,
    false,
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

test("web dynamic verification rejects an unset base before Docker", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectWebContainerPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.equal(report.dockerInvoked, false);
  assert.deepEqual(report.failures, ["immutable Node base image is unset"]);
});

test("egress dynamic verification rejects missing base and build-input tampering before Docker", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectEgressContainerPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.deepEqual(report.failures, [
    "immutable Node base image is unset",
    "sealed native helper artifact identity is unset",
  ]);
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
    "Dockerfile.cgroup-helper",
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
    "scripts/native-helper-contract.mjs",
    "scripts/native-helper-build.mjs",
    "scripts/native-helper-container-verify.mjs",
    "scripts/linux-cgroup-observer.mjs",
    "native/policytwin-linux-cgroup-helper.c",
    "artifacts/security/native-helper-local-build-report.json",
    "scripts/container-verify.mjs",
    "scripts/web-container-runtime.mjs",
    "scripts/live-gate-contract.mjs",
    "scripts/pinned-docker-cli.mjs",
  ]) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(path), destination, { recursive: true });
  }
}

test("static container contract admits safely pinned native helper identities", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-helper-pinned-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const contractPath = join(target, "container-contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  contract.nativeHelper.builderImage = `gcc:15@sha256:${"a".repeat(64)}`;
  contract.nativeHelper.image = `sha256:${"b".repeat(64)}`;
  contract.nativeHelper.binarySha256 = "c".repeat(64);
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");

  const report = inspectStaticContainerContract(target);
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.nativeHelperBuilderImagePinned, true);
  assert.equal(report.nativeHelperImagePinned, true);
  assert.equal(report.nativeHelperBinaryPinned, true);
});

test("static container inspection rejects an external web Dockerfile frontend", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-frontend-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const dockerfilePath = join(target, "Dockerfile");
  const dockerfile = await readFile(dockerfilePath, "utf8");
  await writeFile(
    dockerfilePath,
    `# syntax=docker/dockerfile:1.7\n${dockerfile}`,
    "utf8",
  );

  const report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /daemon-built frontend/iu);
});

test("static container inspection rejects commented, indirect, and computed candidate imports", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-verifier-import-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const healthRoutePath = join(target, "app/api/health/route.ts");
  const healthRoute = await readFile(healthRoutePath, "utf8");
  const candidateSpecifier = "../../../../src/codex/unsigned-verifier-corpus-candidate.js";
  for (const attack of [
    {
      name: "candidate-import.ts",
      source: `import { executeUnsignedVerifierCorpusCandidate } from "${candidateSpecifier}";\nvoid executeUnsignedVerifierCorpusCandidate;\n`,
    },
    {
      name: "candidate-bridge.mts",
      source: `export { executeUnsignedVerifierCorpusCandidate } from /* bridge */ "${candidateSpecifier}?bridge#v1";\n`,
    },
    {
      name: "candidate-bridge.cts",
      source: `import candidate = require("${candidateSpecifier}");\nexport = candidate;\n`,
    },
    {
      name: "candidate-require.cjs",
      source: `require("${candidateSpecifier}");\n`,
    },
    {
      name: "candidate-dynamic.mjs",
      source: `void import("${candidateSpecifier}");\n`,
    },
    {
      name: "candidate-bridge.jsx",
      source: `export { executeUnsignedVerifierCorpusCandidate } from "${candidateSpecifier}";\n`,
    },
  ]) {
    const bridgePath = join(target, "app/api/health", attack.name);
    await writeFile(bridgePath, attack.source, "utf8");
    await writeFile(healthRoutePath, `${healthRoute}\nimport "./${attack.name}";\n`, "utf8");
    const report = inspectStaticContainerContract(target);
    assert.equal(report.status, "FAIL");
    assert.equal(
      report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
      true,
    );
    assert.ok(
      report.unsignedVerifierCorpusCandidateProductionImports.includes(
        `app/api/health/${attack.name}`,
      ),
    );
    assert.deepEqual(
      report.unsignedVerifierCorpusCandidateUnapprovedDynamicModuleExpressions,
      [],
    );
    assert.match(report.failures.join(" "), /production module references/iu);
    await rm(bridgePath);
  }

  await writeFile(
    healthRoutePath,
    `${healthRoute}\nconst candidateModule = "../../../../src/codex/" + "unsigned-verifier-corpus-candidate.js";\nawait import(candidateModule);\n`,
    "utf8",
  );
  let report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.equal(
    report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
    true,
  );
  assert.deepEqual(report.unsignedVerifierCorpusCandidateProductionImports, []);
  assert.deepEqual(
    report.unsignedVerifierCorpusCandidateUnapprovedDynamicModuleExpressions,
    ["app/api/health/route.ts:NON_LITERAL_IMPORT"],
  );
  assert.match(report.failures.join(" "), /unapproved dynamic module expressions/iu);

  for (const attack of [
    {
      source: `${healthRoute}\nmodule.require("${candidateSpecifier}");\n`,
      marker: "PROPERTY_REQUIRE",
    },
    {
      source: `${healthRoute}\nconst load = require;\nload("${candidateSpecifier}");\n`,
      marker: "INDIRECT_REQUIRE",
    },
    {
      source: `${healthRoute}\nimport { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nload("${candidateSpecifier}");\n`,
      marker: "CREATE_REQUIRE",
    },
    {
      source: `${healthRoute}\nconst load = Reflect.get(module, "require");\nload("${candidateSpecifier}");\n`,
      marker: "REFLECTIVE_REQUIRE",
    },
    {
      source: `${healthRoute}\nawait import(candidateModule;\n`,
      marker: "SOURCE_PARSE_ERROR",
    },
  ]) {
    await writeFile(healthRoutePath, attack.source, "utf8");
    report = inspectStaticContainerContract(target);
    assert.equal(report.status, "FAIL");
    assert.equal(
      report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
      true,
    );
    assert.ok(
      report.unsignedVerifierCorpusCandidateUnapprovedDynamicModuleExpressions.includes(
        `app/api/health/route.ts:${attack.marker}`,
      ),
    );
  }

  const packagePath = join(target, "package.json");
  const originalPackageBody = await readFile(packagePath, "utf8");
  const packageJson = JSON.parse(originalPackageBody);
  packageJson.imports = { "#candidate": "./src/codex/unsigned-verifier-corpus-candidate.ts" };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(healthRoutePath, `${healthRoute}\nimport "#candidate";\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.equal(
    report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
    true,
  );
  assert.ok(report.unsignedVerifierCorpusCandidateProductionImports.includes("package.json"));
  assert.ok(
    report.unsignedVerifierCorpusCandidateProductionImports.includes(
      "app/api/health/route.ts",
    ),
  );

  await writeFile(packagePath, originalPackageBody, "utf8");
  const tsconfigPath = join(target, "tsconfig.json");
  const originalTsconfigBody = await readFile(tsconfigPath, "utf8");
  const tsconfig = JSON.parse(originalTsconfigBody);
  tsconfig.compilerOptions.baseUrl = ".";
  tsconfig.compilerOptions.paths = {
    "@candidate": ["src/codex/unsigned-verifier-corpus-candidate.ts"],
  };
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
  await writeFile(healthRoutePath, `${healthRoute}\nimport "@candidate";\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.equal(
    report.unsignedVerifierCorpusCandidateSupportedProductionModuleEdgeDetected,
    true,
  );
  assert.ok(report.unsignedVerifierCorpusCandidateProductionImports.includes("tsconfig.json"));
  assert.ok(
    report.unsignedVerifierCorpusCandidateProductionImports.includes(
      "app/api/health/route.ts",
    ),
  );

  await writeFile(tsconfigPath, originalTsconfigBody, "utf8");
  const reviewBridgeSpecifier = "../../../../src/codex/repair-verifier-review-bridge.js";
  await writeFile(
    healthRoutePath,
    `${healthRoute}\nimport { createRepairVerifierReviewBridge } from "${reviewBridgeSpecifier}";\nvoid createRepairVerifierReviewBridge;\n`,
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.equal(report.verifierReviewBridgeSupportedProductionModuleEdgeDetected, true);
  assert.ok(
    report.verifierReviewBridgeProductionImports.includes("app/api/health/route.ts"),
  );
  assert.match(report.failures.join(" "), /review bridge has production module references/iu);

  const authoritySpecifier = "../../../../src/codex/verifier-exchange-authority.js";
  const evalIdentifier = "ev" + "al";
  const functionConstructor = "Fun" + "ction";
  await writeFile(
    healthRoutePath,
    `${healthRoute}\nimport { takeVerifierCapability } from "${authoritySpecifier}";\nvoid takeVerifierCapability;\n`,
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.ok(
    report.verifierReviewBridgeProductionImports.includes("app/api/health/route.ts"),
  );

  for (const attack of [
    {
      source: `${healthRoute}\nconst bridgeTarget = "../../../../src/codex/" + "repair-verifier-review-bridge.js";\nawait import(bridgeTarget);\n`,
      marker: "NON_LITERAL_IMPORT",
    },
    {
      source: `${healthRoute}\nmodule.require("${reviewBridgeSpecifier}");\n`,
      marker: "PROPERTY_REQUIRE",
    },
    {
      source: `${healthRoute}\nconst load = require;\nload("${reviewBridgeSpecifier}");\n`,
      marker: "INDIRECT_REQUIRE",
    },
    {
      source: `${healthRoute}\nimport { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nload("${reviewBridgeSpecifier}");\n`,
      marker: "CREATE_REQUIRE",
    },
    {
      source: `${healthRoute}\nconst load = Reflect.get(module, "require");\nload("${reviewBridgeSpecifier}");\n`,
      marker: "REFLECTIVE_REQUIRE",
    },
    {
      source: `${healthRoute}\nconst load = new ${functionConstructor}("path", "return import(path)");\nawait load("${authoritySpecifier}");\n`,
      marker: "FUNCTION_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nawait ${evalIdentifier}('import("${authoritySpecifier}")');\n`,
      marker: "EVAL_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nimport vm from "node:vm";\nvm.runInThisContext('import("${authoritySpecifier}")');\n`,
      marker: "VM_CODE_GENERATION_MODULE",
    },
    {
      source: `${healthRoute}\nconst vm = process.getBuiltinModule("vm");\nvm.runInThisContext('import("${authoritySpecifier}")');\n`,
      marker: "PROCESS_GET_BUILTIN_MODULE",
    },
    {
      source: `${healthRoute}\nconst load = (() => {}).constructor("path", "return import(path)");\nawait load("${authoritySpecifier}");\n`,
      marker: "CONSTRUCTOR_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nconst load = globalThis["Function"]("path", "return import(path)");\nawait load("${authoritySpecifier}");\n`,
      marker: "FUNCTION_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nawait globalThis["eval"]('import("${authoritySpecifier}")');\n`,
      marker: "EVAL_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nconst load = Reflect.get(globalThis, "Function");\nawait load("path", "return import(path)")("${authoritySpecifier}");\n`,
      marker: "FUNCTION_CODE_GENERATION",
    },
    {
      source: `${healthRoute}\nconst vm = process["getBuiltinModule"]("vm");\nvm.runInThisContext('import("${authoritySpecifier}")');\n`,
      marker: "PROCESS_GET_BUILTIN_MODULE",
    },
    {
      source: `${healthRoute}\nconst key = "Fun" + "ction";\nconst load = globalThis[key]("path", "return import(path)");\nawait load("${authoritySpecifier}");\n`,
      marker: "GLOBALTHIS_COMPUTED_PROPERTY_ACCESS",
    },
    {
      source: `${healthRoute}\nconst key = "get" + "BuiltinModule";\nconst vm = process[key]("vm");\nvm.runInThisContext('import("${authoritySpecifier}")');\n`,
      marker: "PROCESS_COMPUTED_PROPERTY_ACCESS",
    },
    {
      source: `${healthRoute}\nconst key = "Fun" + "ction";\nconst load = Reflect.get(globalThis, key);\nawait load("path", "return import(path)")("${authoritySpecifier}");\n`,
      marker: "REFLECTIVE_PROPERTY_ACCESS",
    },
    {
      source: `${healthRoute}\nawait import(bridgeTarget;\n`,
      marker: "SOURCE_PARSE_ERROR",
    },
  ]) {
    await writeFile(healthRoutePath, attack.source, "utf8");
    report = inspectStaticContainerContract(target);
    assert.equal(report.status, "FAIL");
    assert.equal(report.verifierReviewBridgeSupportedProductionModuleEdgeDetected, true);
    assert.ok(
      report.verifierReviewBridgeUnapprovedDynamicModuleExpressions.includes(
        `app/api/health/route.ts:${attack.marker}`,
      ),
    );
  }
});

test("static container inspection detects weakened verifier networking and fixture bundling", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-contract-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const contractPath = join(target, "container-contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  let report = inspectStaticContainerContract(target);
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");

  const helperDockerfilePath = join(target, "Dockerfile.cgroup-helper");
  const helperDockerfile = await readFile(helperDockerfilePath, "utf8");
  await writeFile(
    helperDockerfilePath,
    helperDockerfile.replace("--chmod=0555", "--chmod=0755"),
    "utf8",
  );
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /native helper Dockerfile/iu);
  await writeFile(helperDockerfilePath, helperDockerfile, "utf8");

  const helperReportPath = join(
    target,
    "artifacts/security/native-helper-local-build-report.json",
  );
  const helperReport = JSON.parse(await readFile(helperReportPath, "utf8"));
  helperReport.passClaim = true;
  await writeFile(helperReportPath, `${JSON.stringify(helperReport, null, 2)}\n`, "utf8");
  report = inspectStaticContainerContract(target);
  assert.equal(report.status, "FAIL");
  assert.match(report.failures.join(" "), /local build report overclaims/u);
  helperReport.passClaim = false;
  await writeFile(helperReportPath, `${JSON.stringify(helperReport, null, 2)}\n`, "utf8");

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
