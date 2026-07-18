import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
import {
  computeNativeHelperSource,
  inspectNativeHelperDockerfile,
} from "./native-helper-contract.mjs";
import { ROOT } from "./process.mjs";

const REQUIRED_DOCKERIGNORE_LINES = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  ".tools",
  ".data",
  ".tmp",
  ".env*",
  "*.pem",
  "*.key",
  "artifacts/runs",
  "artifacts/tmp",
  "artifacts/submission-draft",
  "artifacts/demo-draft",
  "fixtures/refund-demo/baseline",
  "fixtures/refund-demo/expected-fixed",
];

function read(path, failures, label) {
  if (!existsSync(path)) {
    failures.push(`${label} is absent.`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireText(body, text, failures, label) {
  if (!body.includes(text)) failures.push(`${label} must contain ${JSON.stringify(text)}.`);
}

function requireOrderedText(body, fragments, failures, label) {
  let offset = 0;
  for (const fragment of fragments) {
    const index = body.indexOf(fragment, offset);
    if (index < 0) {
      failures.push(`${label} must preserve stopped-instance observation around logs.`);
      return;
    }
    offset = index + fragment.length;
  }
}

function requireStageOrder(body, fragments, failures, label) {
  let offset = 0;
  for (const fragment of fragments) {
    const index = body.indexOf(fragment, offset);
    if (index < 0) {
      failures.push(`${label} must preserve the required lifecycle stage order.`);
      return;
    }
    offset = index + fragment.length;
  }
}

export function inspectStaticContainerContract(root = ROOT) {
  const failures = [];
  const contractPath = resolve(root, "container-contract.json");
  const dockerfilePath = resolve(root, "Dockerfile");
  const workerDockerfilePath = resolve(root, "Dockerfile.worker");
  const verifierDockerfilePath = resolve(root, "Dockerfile.verifier");
  const egressDockerfilePath = resolve(root, "Dockerfile.egress-proxy");
  const nativeHelperDockerfilePath = resolve(root, "Dockerfile.cgroup-helper");
  const dockerignorePath = resolve(root, ".dockerignore");
  const nextConfigPath = resolve(root, "next.config.ts");
  const healthRoutePath = resolve(root, "app", "api", "health", "route.ts");
  const workerPreflightPath = resolve(root, "scripts", "worker-preflight.mjs");
  const workerEntrypointPath = resolve(root, "scripts", "worker-entrypoint.mjs");
  const verifierPreflightPath = resolve(root, "scripts", "verifier-preflight.mjs");
  const proxyTokenHelperPath = resolve(root, "scripts", "proxy-token-helper.mjs");
  const egressProxyPath = resolve(root, "scripts", "openai-egress-proxy.mjs");
  const egressContractPath = resolve(root, "src", "codex", "openai-egress-contract.ts");
  const dockerRunnerPath = resolve(root, "src", "codex", "docker-command-runner.ts");
  const dockerObserverPath = resolve(root, "src", "codex", "docker-observer.ts");
  const dockerDriverPath = resolve(root, "src", "codex", "supervisor-docker-driver.ts");
  const cpuBudgetContractPath = resolve(root, "src", "codex", "cpu-budget-contract.ts");
  const liveCpuProofContractPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-cgroup-cpu-proof.ts",
  );
  const liveCpuProofSchemaPath = resolve(
    root,
    "schemas",
    "live-linux-cgroup-cpu-proof.v1.schema.json",
  );
  const liveCpuEvidenceContractPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-cgroup-cpu-evidence-v2.ts",
  );
  const liveCpuEvidenceProducerPath = resolve(
    root,
    "src",
    "codex",
    "linux-cgroup-cpu-evidence-producer.ts",
  );
  const liveCpuAdapterCapabilityPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-cgroup-cpu-adapter-capability.ts",
  );
  const liveCpuAdapterPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-cgroup-cpu-adapter.ts",
  );
  const liveCpuEvidenceSchemaPath = resolve(
    root,
    "schemas",
    "live-linux-cgroup-cpu-evidence.v2.schema.json",
  );
  const workerRpcContractPath = resolve(root, "src", "codex", "worker-rpc-contract.ts");
  const workerRpcClientPath = resolve(root, "src", "codex", "worker-rpc-client.ts");
  const workerRpcMtlsPath = resolve(root, "src", "codex", "worker-rpc-mtls.ts");
  const workerRpcMtlsTransportPath = resolve(
    root,
    "src",
    "codex",
    "worker-rpc-mtls-transport.ts",
  );
  const workerRpcTransportCapabilityPath = resolve(
    root,
    "src",
    "codex",
    "worker-rpc-transport-capability.ts",
  );
  const rootIndexPath = resolve(root, "src", "index.ts");
  const liveGateContractPath = resolve(root, "scripts", "live-gate-contract.mjs");
  const pinnedDockerCliPath = resolve(root, "scripts", "pinned-docker-cli.mjs");
  const containerVerifyPath = resolve(root, "scripts", "container-verify.mjs");
  const webContainerRuntimePath = resolve(root, "scripts", "web-container-runtime.mjs");
  const workerVerifyPath = resolve(root, "scripts", "worker-container-verify.mjs");
  const egressVerifyPath = resolve(root, "scripts", "egress-container-verify.mjs");
  const nativeHelperContractPath = resolve(root, "scripts", "native-helper-contract.mjs");
  const nativeHelperBuildPath = resolve(root, "scripts", "native-helper-build.mjs");
  const nativeHelperVerifyPath = resolve(
    root,
    "scripts",
    "native-helper-container-verify.mjs",
  );
  const nativeHelperLocalReportPath = resolve(
    root,
    "artifacts",
    "security",
    "native-helper-local-build-report.json",
  );
  const linuxCgroupObserverPath = resolve(root, "scripts", "linux-cgroup-observer.mjs");
  const roleStartBarrierPath = resolve(root, "scripts", "role-start-barrier.mjs");
  const linuxStartBarrierPath = resolve(root, "src", "codex", "linux-start-barrier.ts");
  const dedicatedLifecyclePath = resolve(
    root,
    "src",
    "codex",
    "live-linux-cgroup-cpu-dedicated-lifecycle.ts",
  );
  const liveLinuxDockerRolePlanPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-docker-role-plan.ts",
  );
  const liveLinuxDockerOwnerPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-docker-owned-container.ts",
  );
  const liveLinuxSystemAdapterPath = resolve(
    root,
    "src",
    "codex",
    "live-linux-docker-cgroup-system-adapter.ts",
  );
  const nativeHelperProtocolPath = resolve(
    root,
    "src",
    "codex",
    "linux-cgroup-helper-protocol.ts",
  );
  const nativeHelperClientPath = resolve(
    root,
    "src",
    "codex",
    "linux-cgroup-helper-client.ts",
  );
  const nativeHelperSourcePath = resolve(
    root,
    "native",
    "policytwin-linux-cgroup-helper.c",
  );
  const contractBody = read(contractPath, failures, "Container contract");
  let contract = null;
  try {
    contract = contractBody.length === 0 ? null : JSON.parse(contractBody);
  } catch {
    failures.push("Container contract is not valid JSON.");
  }
  let workerBuildInput = null;
  let verifierBuildInput = null;
  let egressBuildInput = null;
  let helperBuildInput = null;
  let helperSource = null;
  try {
    workerBuildInput = computeContainerBuildInput("worker", root);
    verifierBuildInput = computeContainerBuildInput("verifier", root);
    egressBuildInput = computeContainerBuildInput("egress", root);
    helperBuildInput = computeContainerBuildInput("helper", root);
    helperSource = computeNativeHelperSource(root);
  } catch {
    failures.push("Container build inputs are absent or unsafe.");
  }
  const nativeHelperBuilderImagePinned =
    typeof contract?.nativeHelper?.builderImage === "string" &&
    /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/u.test(
      contract.nativeHelper.builderImage,
    );
  const nativeHelperImagePinned =
    typeof contract?.nativeHelper?.image === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(contract.nativeHelper.image);
  const nativeHelperBinaryPinned =
    typeof contract?.nativeHelper?.binarySha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(contract.nativeHelper.binarySha256);
  const dockerCliSha256Pinned =
    typeof contract?.supervisorDockerExecutor?.dockerCliSha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(contract.supervisorDockerExecutor.dockerCliSha256);
  const nativeHelperIdentityStateValid =
    (contract?.nativeHelper?.builderImage === null &&
      contract?.nativeHelper?.image === null &&
      contract?.nativeHelper?.binarySha256 === null) ||
    (nativeHelperBuilderImagePinned &&
      contract?.nativeHelper?.image === null &&
      contract?.nativeHelper?.binarySha256 === null) ||
    (nativeHelperBuilderImagePinned && nativeHelperImagePinned && nativeHelperBinaryPinned);
  if (
    contract === null ||
    contract.schemaVersion !== "15" ||
    contract.status !== "STATIC_PREPARED" ||
    contract.targetPlatform !== "linux/amd64" ||
    contract.dockerfileFrontend !== "DAEMON_BUILTIN_NO_EXTERNAL_FRONTEND" ||
    contract.nodeVersion !== "22.22.2" ||
    contract.opaVersion !== "1.18.2" ||
    !/^[0-9a-f]{64}$/u.test(contract.opaLinuxAmd64StaticSha256 ?? "") ||
    contract.applicationPort !== 3000 ||
    contract.healthPath !== "/api/health" ||
    contract.dataPath !== "/data/policytwin.sqlite" ||
    contract.nativeHelper?.status !== "STATIC_SOURCE_AND_PACKAGE_PREPARED" ||
    contract.nativeHelper?.dockerfile !== "Dockerfile.cgroup-helper" ||
    contract.nativeHelper?.sourcePath !== "native/policytwin-linux-cgroup-helper.c" ||
    contract.nativeHelper?.sourceSha256 !== helperSource?.sha256 ||
    contract.nativeHelper?.buildInputSha256 !== helperBuildInput?.sha256 ||
    !nativeHelperIdentityStateValid ||
    contract.nativeHelper?.imagePath !== "/policytwin-linux-cgroup-helper" ||
    contract.nativeHelper?.maximumBinaryBytes !== 4_194_304 ||
    contract.nativeHelper?.localToolchainBuildStatus !==
      "PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND" ||
    !/^[0-9a-f]{64}$/u.test(contract.nativeHelper?.localToolchainBinarySha256 ?? "") ||
    contract.nativeHelper?.localToolchainPinned !== false ||
    contract.nativeHelper?.localRepeatedBuildsByteIdentical !== true ||
    contract.nativeHelper?.liveGateArtifactGateRequired !== true ||
    contract.nativeHelper?.imageBuildVerified !== false ||
    contract.nativeHelper?.hostInstallVerified !== false ||
    contract.nativeHelper?.runtimeVerified !== false ||
    contract.nativeHelper?.passSigningEligible !== false ||
    contract.webContainer?.includesLiveCodexWorker !== false ||
    contract.webContainer?.runtimeUser !== "node" ||
    contract.webContainer?.readOnlyRootRequired !== true ||
    contract.webContainer?.canonicalDockerExecutableRequired !== true ||
    contract.webContainer?.reviewedDockerExecutableSha256Required !== true ||
    contract.webContainer?.platformLocalDaemonRequired !== true ||
    contract.webContainer?.dockerCliEnvironmentVariable !== "POLICYTWIN_DOCKER_CLI" ||
    contract.webContainer?.pathSearchAllowed !== false ||
    contract.webContainer?.remoteDaemonAllowed !== false ||
    contract.webContainer?.baseImagePullAllowed !== false ||
    contract.webContainer?.resourceOwnership !==
      "NONCE_BOUND_LABELS_AND_OBSERVED_IDENTITIES" ||
    contract.webContainer?.restartPolicy !== "no" ||
    contract.webContainer?.restartCountMustRemainZero !== true ||
    contract.webContainer?.pidsLimit !== 64 ||
    contract.webContainer?.memoryBytes !== 1_073_741_824 ||
    contract.webContainer?.memorySwapBytes !== 1_073_741_824 ||
    contract.webContainer?.cpus !== 1 ||
    contract.webContainer?.fileSizeLimitBytes !== 16_777_216 ||
    contract.webContainer?.logDriver !== "local" ||
    contract.webContainer?.maximumLogFiles !== 1 ||
    contract.webContainer?.maximumLogBytes !== 16_777_216 ||
    contract.webContainer?.volumeInitialization !== "ROOT_CHOWN_THEN_NODE_RUNTIME" ||
    contract.webContainer?.persistenceVerification !== "API_MUTATION_RESTART_READ" ||
    JSON.stringify(contract.webContainer?.handledCleanupSignals) !==
      JSON.stringify(["SIGINT", "SIGTERM"]) ||
    contract.workerContainer?.status !== "STATIC_PREPARED" ||
    contract.workerContainer?.dockerfile !== "Dockerfile.worker" ||
    contract.workerContainer?.entrypoint !== "scripts/worker-preflight.mjs" ||
    contract.workerContainer?.preparedEntrypoint !== "scripts/worker-entrypoint.mjs" ||
    contract.workerContainer?.preparedEntrypointStatus !== "VALIDATE_ONLY_LIVE_DISABLED" ||
    contract.workerContainer?.rpcProtocol !== "policytwin.codex.repair.v1" ||
    contract.workerContainer?.liveRpcProtocolPrepared !== "policytwin.codex.repair.v2" ||
    contract.workerContainer?.liveRpcV2Status !== "CONTRACT_ONLY_NO_LINUX_CONTROLLER" ||
    contract.workerContainer?.liveRpcV2PassSigningEnabled !== false ||
    contract.workerContainer?.liveCpuEvidenceProducerStateMachineImplemented !== true ||
    contract.workerContainer?.liveCpuEvidenceProducerCandidateStatus !==
      "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE" ||
    contract.workerContainer?.liveCpuEvidenceProducerProvenance !==
      "SYNTHETIC_CONTRACT_ONLY" ||
    contract.workerContainer?.liveCpuEvidenceProducerPassSigningEligible !== false ||
    contract.workerContainer?.liveCpuPrivateAdapterCapabilityScaffoldImplemented !== true ||
    contract.workerContainer?.liveCpuFinalizedEvidenceIdentityGuardScaffoldImplemented !== true ||
    contract.workerContainer?.liveCpuFinalizedEvidenceIssuanceImplemented !== false ||
    contract.workerContainer?.liveCpuSignerFinalizedCapabilityRequired !== true ||
    contract.workerContainer?.liveCpuSignerFinalizedCapabilityAdmissionImplemented !== false ||
    contract.workerContainer?.liveCpuDedicatedLifecycleContractImplemented !== true ||
    contract.workerContainer?.liveCpuDedicatedLifecycleSuccessStageCount !== 28 ||
    contract.workerContainer?.liveCpuStartBarrierProtocolImplemented !== true ||
    contract.workerContainer?.liveCpuStartBarrierHostOwnedReceiptSlotsImplemented !== true ||
    contract.workerContainer?.liveCpuStartBarrierReceiptCommitBindingImplemented !== true ||
    contract.workerContainer?.liveCpuStartBarrierConcurrentReleaseGuardImplemented !== true ||
    contract.workerContainer?.liveCpuStartBarrierRoleLauncherBundled !== true ||
    contract.workerContainer?.liveCpuStartBarrierNodeOptionsLocked !== true ||
    contract.workerContainer?.liveCpuDedicatedLifecycleHarnessImplemented !== true ||
    contract.workerContainer?.liveCpuDedicatedLifecycleHarnessProvenance !==
      "NON_PRIVILEGED_TEST_PORT" ||
    contract.workerContainer?.liveCpuDedicatedLifecycleSerialSamplingImplemented !== true ||
    contract.workerContainer?.liveCpuDedicatedLifecycleQuiescentFinalSamplingImplemented !==
      true ||
    contract.workerContainer?.liveCpuIndependentCleanupTerminationContractImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperProtocolImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperSourceImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperClientImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperFullRoleSessionImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperArtifactPackagingImplemented !== true ||
    contract.workerContainer?.liveCpuNativeHelperLocalBuildReproducibilityVerified !== true ||
    contract.workerContainer?.liveCpuDockerBarrierRolePlanImplemented !== true ||
    contract.workerContainer?.liveCpuSupervisorSealedLifecyclePlanRequired !== true ||
    contract.workerContainer?.liveCpuDockerOwnerFactoryImplemented !== true ||
    contract.workerContainer?.liveCpuDockerOwnedNetworkFactoryImplemented !== true ||
    contract.workerContainer?.liveCpuDockerNetworkAbsenceRequired !== true ||
    contract.workerContainer?.liveCpuDockerReobservationReceiptsImplemented !== true ||
    contract.workerContainer?.liveCpuDockerRemovalReceiptsImplemented !== true ||
    contract.workerContainer?.liveCpuPrivateRuntimeExecutionProvenance !==
      "PRIVATE_LINUX_DOCKER_CGROUP_ADAPTER" ||
    contract.workerContainer?.liveCpuPrivateRuntimeDynamicVerified !== false ||
    contract.workerContainer?.liveCpuNativeHelperBuildVerified !== false ||
    contract.workerContainer?.liveCpuNativeHelperRuntimeVerified !== false ||
    contract.workerContainer?.liveCpuStartBarrierRuntimeImplemented !== true ||
    contract.workerContainer?.liveCpuLinuxSystemAdapterImplemented !== true ||
    contract.workerContainer?.liveCpuDedicatedLifecycleImplemented !== true ||
    contract.workerContainer?.liveCpuLegacyProofSchema !==
      "schemas/live-linux-cgroup-cpu-proof.v1.schema.json" ||
    contract.workerContainer?.liveCpuLegacyProofType !== "LIVE_LINUX_CGROUP_V2_THREE_ROLE" ||
    contract.workerContainer?.liveCpuEvidenceSchema !==
      "schemas/live-linux-cgroup-cpu-evidence.v2.schema.json" ||
    contract.workerContainer?.liveCpuEvidenceType !==
      "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2" ||
    contract.workerContainer?.liveCpuPassEvidenceRequired !== true ||
    contract.workerContainer?.liveCpuFailEvidenceRequired !== true ||
    contract.workerContainer?.liveCpuFailMayCarrySuccessEvidence !== false ||
    contract.workerContainer?.liveCpuExecutionBindingClientDerived !== true ||
    contract.workerContainer?.liveCpuDockerBindingDerivedFromRequestAndRoles !== true ||
    contract.workerContainer?.liveCpuKeyPurposePrefix !== "live-cpu-" ||
    contract.workerContainer?.liveCpuDedicatedKeyMaterialRequired !== true ||
    contract.workerContainer?.liveCpuUnifiedTrustBundleRequired !== true ||
    contract.workerContainer?.liveCpuV2TransportFactoryCapabilityRequired !== true ||
    contract.workerContainer?.liveCpuV2TransportInputsSnapshotted !== true ||
    contract.workerContainer?.liveCpuDurableReplayRequired !== true ||
    contract.workerContainer?.liveCpuMtlsAlpn !== "policytwin-worker-rpc/2" ||
    contract.workerContainer?.liveCpuMtlsRequestMagic !== "PTQ2" ||
    contract.workerContainer?.liveCpuMtlsResponseMagic !== "PTS2" ||
    contract.workerContainer?.liveCpuHardLimitClaim !== false ||
    contract.workerContainer?.liveCpuOvershootBoundClaim !== false ||
    contract.workerContainer?.liveCpuGlobalEventTranscriptContractImplemented !== true ||
    contract.workerContainer?.liveCpuGlobalEventTranscriptObserved !== false ||
    contract.workerContainer?.liveCpuFailureEvidenceContractImplemented !== true ||
    contract.workerContainer?.liveCpuFailureEvidenceObserved !== false ||
    contract.workerContainer?.hostLiveConstructionAllowed !== false ||
    contract.workerContainer?.dynamicVerified !== false ||
    contract.workerContainer?.liveCodexExecuted !== false ||
    contract.workerContainer?.runtimeUser !== "10001:10001" ||
    contract.workerContainer?.privileged !== false ||
    contract.workerContainer?.readOnlyRootRequired !== true ||
    contract.workerContainer?.restartPolicy !== "no" ||
    JSON.stringify(contract.workerContainer?.capDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(contract.workerContainer?.capAdd) !== JSON.stringify([]) ||
    contract.workerContainer?.noNewPrivileges !== true ||
    contract.workerContainer?.pidsLimit !== 64 ||
    contract.workerContainer?.memoryBytes !== 1_073_741_824 ||
    contract.workerContainer?.cpus !== 1 ||
    contract.workerContainer?.memoryAndPidsRequestBound !== true ||
    contract.workerContainer?.maximumOutputBytes !== 4_194_304 ||
    contract.workerContainer?.memorySwapEqualsMemory !== true ||
    contract.workerContainer?.fileSizeLimitRequestBound !== true ||
    contract.workerContainer?.logDriver !== "local" ||
    contract.workerContainer?.maximumLogFiles !== 1 ||
    contract.workerContainer?.maximumLogBytesRequestBound !== true ||
    contract.workerContainer?.wallTimeScope !==
      "PREPARE_WORKER_VERIFIER_EXCLUDING_TEARDOWN_GRACE" ||
    contract.workerContainer?.cumulativeCpuTimeEnforcement !==
      "UNAVAILABLE_STATIC_DRIVER" ||
    contract.workerContainer?.staticCpuBudgetProofStatus !==
      "STATIC_FAKE_CONTROLLER_VERIFIED" ||
    contract.workerContainer?.staticCpuAccountingScope !==
      "POST_BASELINE_THREE_ROLE_AGGREGATE" ||
    contract.workerContainer?.staticCpuProofClaimsEnforcement !== false ||
    contract.workerContainer?.fixtureRoot !== "/workspace" ||
    contract.workerContainer?.fixtureRootReadOnly !== true ||
    JSON.stringify(contract.workerContainer?.writablePaths) !==
      JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"]) ||
    JSON.stringify(contract.workerContainer?.tmpfs) !==
      JSON.stringify(["/worker-home", "/tmp"]) ||
    contract.workerContainer?.network !== "PER_RUN_OBSERVED_ID" ||
    contract.workerContainer?.networkNamePattern !==
      "policytwin-worker-<32-lowercase-hex>" ||
    contract.workerContainer?.networkInternalRequired !== true ||
    contract.workerContainer?.creationNetworkReference !== "OBSERVED_ID_ONLY" ||
    contract.workerContainer?.proxyAuthority !== "policytwin-egress:8443" ||
    contract.workerContainer?.proxyTokenFile !== "/run/secrets/policytwin-proxy-token" ||
    contract.workerContainer?.proxyCaFile !== "/run/secrets/policytwin-egress-ca.pem" ||
    contract.workerContainer?.proxyBaseUrl !== "https://policytwin-egress:8443/v1" ||
    contract.workerContainer?.commandBackedProxyAuth !== true ||
    contract.workerContainer?.providerCredentialPresent !== false ||
    JSON.stringify(contract.workerContainer?.forbiddenMountTargets) !==
      JSON.stringify([
        "/var/run/docker.sock",
        "/root",
        "/host",
        "/evidence",
        "/expected-fixed",
      ]) ||
    contract.verifierContainer?.status !== "STATIC_PREPARED" ||
    contract.verifierContainer?.dockerfile !== "Dockerfile.verifier" ||
    contract.verifierContainer?.entrypoint !== "scripts/verifier-preflight.mjs" ||
    contract.verifierContainer?.dynamicVerified !== false ||
    contract.verifierContainer?.liveCodexExecuted !== false ||
    contract.verifierContainer?.runtimeUser !== "10002:10002" ||
    contract.verifierContainer?.privileged !== false ||
    contract.verifierContainer?.readOnlyRootRequired !== true ||
    contract.verifierContainer?.restartPolicy !== "no" ||
    JSON.stringify(contract.verifierContainer?.capDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(contract.verifierContainer?.capAdd) !== JSON.stringify([]) ||
    contract.verifierContainer?.noNewPrivileges !== true ||
    contract.verifierContainer?.pidsLimit !== 32 ||
    contract.verifierContainer?.memoryBytes !== 536_870_912 ||
    contract.verifierContainer?.memorySwapBytes !== 536_870_912 ||
    contract.verifierContainer?.cpus !== 1 ||
    contract.verifierContainer?.maximumOutputBytes !== 4_194_304 ||
    contract.verifierContainer?.fileSizeLimitRequestBound !== true ||
    contract.verifierContainer?.logDriver !== "local" ||
    contract.verifierContainer?.maximumLogFiles !== 1 ||
    contract.verifierContainer?.network !== "none" ||
    contract.verifierContainer?.fixtureRoot !== "/fixture" ||
    contract.verifierContainer?.fixtureRootReadOnly !== true ||
    JSON.stringify(contract.verifierContainer?.tmpfs) !==
      JSON.stringify(["/fixture/dist", "/tmp"]) ||
    JSON.stringify(contract.verifierContainer?.environment) !==
      JSON.stringify({
        HOME: "/tmp",
        PATH: "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin",
      }) ||
    JSON.stringify(contract.verifierContainer?.forbiddenCredentialPrefixes) !==
      JSON.stringify([
        "OPENAI_",
        "CODEX_",
        "AZURE_OPENAI_",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
      ]) ||
    JSON.stringify(contract.verifierContainer?.commandIds) !==
      JSON.stringify(["fixture-typecheck", "fixture-test"]) ||
    contract.egressProxy?.status !== "STATIC_PREPARED" ||
    contract.egressProxy?.dockerfile !== "Dockerfile.egress-proxy" ||
    contract.egressProxy?.entrypoint !== "scripts/openai-egress-proxy.mjs" ||
    contract.egressProxy?.dynamicVerified !== false ||
    contract.egressProxy?.liveCodexExecuted !== false ||
    contract.egressProxy?.runtimeUser !== "10003:10003" ||
    contract.egressProxy?.readOnlyRootRequired !== true ||
    contract.egressProxy?.restartPolicy !== "no" ||
    contract.egressProxy?.memoryBytes !== 268_435_456 ||
    contract.egressProxy?.memorySwapBytes !== 268_435_456 ||
    contract.egressProxy?.fileSizeLimitBytes !== 8_388_608 ||
    contract.egressProxy?.logDriver !== "local" ||
    contract.egressProxy?.maximumLogFiles !== 1 ||
    JSON.stringify(contract.egressProxy?.capDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(contract.egressProxy?.capAdd) !== JSON.stringify([]) ||
    contract.egressProxy?.noNewPrivileges !== true ||
    contract.egressProxy?.workerNetwork !== "PER_RUN_OBSERVED_ID" ||
    contract.egressProxy?.workerNetworkNamePattern !==
      "policytwin-worker-<32-lowercase-hex>" ||
    contract.egressProxy?.outboundNetwork !== "PER_RUN_OBSERVED_ID" ||
    contract.egressProxy?.outboundNetworkNamePattern !==
      "policytwin-egress-<32-lowercase-hex>" ||
    contract.egressProxy?.creationNetworkReference !== "OBSERVED_ID_ONLY" ||
    contract.egressProxy?.listenAuthority !== "policytwin-egress:8443" ||
    contract.egressProxy?.allowedAuthority !== "api.openai.com:443" ||
    contract.egressProxy?.allowedMethod !== "POST" ||
    contract.egressProxy?.allowedPath !== "/v1/responses" ||
    contract.egressProxy?.maximumRequestBytes !== 1_048_576 ||
    contract.egressProxy?.maximumResponseBytes !== 8_388_608 ||
    contract.egressProxy?.maximumRequestsPerLease !== 64 ||
    contract.egressProxy?.leaseMaximumLifetimeMs !== 900_000 ||
    contract.egressProxy?.maximumInFlight !== 2 ||
    contract.egressProxy?.upstreamDeadlineMs !== 120_000 ||
    contract.egressProxy?.upstreamIdleTimeoutMs !== 15_000 ||
    contract.egressProxy?.providerCredentialLocation !== "PROXY_FILE_MOUNT_ONLY" ||
    contract.egressProxy?.genericForwardProxy !== false ||
    contract.egressProxy?.arbitraryConnectAllowed !== false ||
    contract.egressProxy?.redirectsAllowed !== false ||
    contract.egressProxy?.compressedResponsesAllowed !== false ||
    contract.egressProxy?.publicIpv4PinRequired !== true ||
    contract.egressProxy?.tlsProbeOutboundObservation !== "NOT_MEASURED" ||
    contract.supervisorDockerExecutor?.status !== "STATIC_FAKE_RUNNER_VERIFIED" ||
    contract.supervisorDockerExecutor?.contractVersion !== "3" ||
    contract.supervisorDockerExecutor?.bindingDomain !== "policytwin-docker-v3" ||
    contract.supervisorDockerExecutor?.resourceSuffixHexLength !== 32 ||
    contract.supervisorDockerExecutor?.shell !== false ||
    contract.supervisorDockerExecutor?.adoptExistingResources !== false ||
    contract.supervisorDockerExecutor?.operateByObservedIdOnly !== true ||
    contract.supervisorDockerExecutor?.independentInspectRequired !== true ||
    contract.supervisorDockerExecutor?.canonicalDockerExecutableRequired !== true ||
    contract.supervisorDockerExecutor?.platformLocalDaemonRequired !== true ||
    contract.supervisorDockerExecutor?.dynamicGateDockerCliEnvironmentVariable !==
      "POLICYTWIN_DOCKER_CLI" ||
    contract.supervisorDockerExecutor?.dockerCliSha256Requirement !==
      "reviewed canonical Docker CLI binary SHA-256 as 64 lowercase hex" ||
    (contract.supervisorDockerExecutor?.dockerCliSha256 !== null &&
      !dockerCliSha256Pinned) ||
    contract.supervisorDockerExecutor?.dynamicGatePathSearchAllowed !== false ||
    contract.supervisorDockerExecutor?.dynamicGateRemoteDaemonAllowed !== false ||
    contract.supervisorDockerExecutor?.sealedWorkerImageRequired !== true ||
    contract.supervisorDockerExecutor?.requestLimitsBoundedBySupervisor !== true ||
    contract.supervisorDockerExecutor?.memorySwapEqualsMemory !== true ||
    contract.supervisorDockerExecutor?.fileSizeLimitRequired !== true ||
    contract.supervisorDockerExecutor?.boundedLocalLogDriverRequired !== true ||
    contract.supervisorDockerExecutor?.closedEnvironmentAndEntrypointInspection !== true ||
    contract.supervisorDockerExecutor?.restartPolicyRequired !== "no" ||
    contract.supervisorDockerExecutor?.restartCountMustRemainZero !== true ||
    contract.supervisorDockerExecutor?.egressIdentityReobservedAroundWorker !== true ||
    JSON.stringify(contract.supervisorDockerExecutor?.runningInstanceIdentityFields) !==
      JSON.stringify(["containerId", "pid", "startedAt", "restartCount"]) ||
    contract.supervisorDockerExecutor?.stoppedInstanceReobservedAroundLogs !== true ||
    contract.supervisorDockerExecutor?.cpuBudgetControllerPortRequired !== true ||
    JSON.stringify(contract.supervisorDockerExecutor?.cpuBudgetRoles) !==
      JSON.stringify(["egress", "worker", "verifier"]) ||
    contract.supervisorDockerExecutor?.cpuBudgetReceiptValidationOrder !==
      "FINALIZE_BUDGET_THEN_WORKER_THEN_VERIFIER" ||
    contract.supervisorDockerExecutor?.cpuBudgetControllerCleanupRequired !== true ||
    contract.supervisorDockerExecutor?.cpuControlTimeoutMsDefault !== 5_000 ||
    contract.supervisorDockerExecutor?.cpuControllerBoundaryBreachBlocksCleanupProof !== true ||
    contract.supervisorDockerExecutor?.staticCpuBudgetController !== "SERIAL_FAKE_ONLY" ||
    contract.supervisorDockerExecutor?.liveCpuBooleanTrustAllowed !== false ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverContractVersion !== "2" ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverPurpose !==
      "NON_LIVE_DYNAMIC_GATE_ONLY" ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverPrivateHandleRequired !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverDirectoryFdPinned !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverExactDockerIdentityRequired !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverCpuUsageUint64BigInt !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverDescendantQuiescenceRequired !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverOriginalReleaseRequired !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverCleanupActionFailureSticky !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverRuntimeVerified !== false ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverStartBarrierImplemented !== false ||
    contract.supervisorDockerExecutor?.linuxCgroupObserverLiveEvidenceAdapter !== false ||
    contract.supervisorDockerExecutor?.linuxStartBarrierProtocolImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxStartBarrierHostOwnedReceiptSlotsImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxStartBarrierConcurrentReleaseGuardImplemented !==
      true ||
    contract.supervisorDockerExecutor?.linuxStartBarrierDockerIntegrationImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxSupervisorSealedLifecyclePlanRequired !== true ||
    contract.supervisorDockerExecutor?.linuxDockerOwnerFactoryImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxDockerOwnedNetworkFactoryImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxDockerNetworkAbsenceRequired !== true ||
    contract.supervisorDockerExecutor?.linuxDockerBindReobservationRequired !== true ||
    contract.supervisorDockerExecutor?.linuxDockerRemovalReceiptRequiredBeforeCgroupRelease !==
      true ||
    contract.supervisorDockerExecutor?.linuxHelperForcedTerminationRequiresAllDockerRolesAbsent !==
      true ||
    contract.supervisorDockerExecutor?.linuxNativeHelperFixedBinaryProtocolImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxNativeHelperArtifactPackagingImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxNativeHelperLocalBuildReproducibilityVerified !==
      true ||
    contract.supervisorDockerExecutor?.linuxNativeHelperArtifactImageBuildVerified !== false ||
    contract.supervisorDockerExecutor?.linuxNativeHelperRuntimeVerified !== false ||
    contract.supervisorDockerExecutor?.linuxCgroupCpuActuationSourceImplemented !== true ||
    contract.supervisorDockerExecutor?.linuxCgroupCpuActuationImplemented !== true ||
    contract.supervisorDockerExecutor?.publishedPortsAllowed !== false ||
    JSON.stringify(contract.supervisorDockerExecutor?.policytwinLabelKeys) !==
      JSON.stringify([
        "com.policytwin.managed",
        "com.policytwin.contract-version",
        "com.policytwin.binding-sha256",
        "com.policytwin.request-sha256",
        "com.policytwin.run-id",
        "com.policytwin.role",
      ]) ||
    contract.supervisorDockerExecutor?.dynamicVerified !== false ||
    contract.supervisorDockerExecutor?.liveCodexExecuted !== false ||
    contract.workerBuildInputSha256 !== workerBuildInput?.sha256 ||
    contract.verifierBuildInputSha256 !== verifierBuildInput?.sha256 ||
    contract.egressProxyBuildInputSha256 !== egressBuildInput?.sha256 ||
    contract.nativeHelper?.buildInputSha256 !== helperBuildInput?.sha256
  ) {
    failures.push("Container contract does not preserve the static web/worker split.");
  }
  const baseImagePinned =
    typeof contract?.nodeBaseImage === "string" &&
    /^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u.test(contract.nodeBaseImage);
  if (contract?.nodeBaseImage !== null && !baseImagePinned) {
    failures.push("Configured Node base image is not an immutable Node 22.22.2 digest.");
  }
  const workerImagePinned =
    typeof contract?.workerImage === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(contract.workerImage);
  const verifierImagePinned =
    typeof contract?.verifierImage === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(contract.verifierImage);
  const egressProxyImagePinned =
    typeof contract?.egressProxyImage === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(contract.egressProxyImage);
  if (contract?.workerImage !== null && !workerImagePinned) {
    failures.push("Configured worker image is not immutable.");
  }
  if (contract?.verifierImage !== null && !verifierImagePinned) {
    failures.push("Configured verifier image is not immutable.");
  }
  if (contract?.egressProxyImage !== null && !egressProxyImagePinned) {
    failures.push("Configured egress proxy image is not immutable.");
  }
  if (contract?.nativeHelper?.image !== null && !nativeHelperImagePinned) {
    failures.push("Configured native helper artifact image is not immutable.");
  }

  const nativeHelperDockerfile = read(
    nativeHelperDockerfilePath,
    failures,
    "Native helper Dockerfile",
  );
  failures.push(...inspectNativeHelperDockerfile(nativeHelperDockerfile));
  const nativeHelperContract = read(
    nativeHelperContractPath,
    failures,
    "Native helper artifact contract",
  );
  for (const required of [
    "NATIVE_HELPER_COMPILER_ARGUMENTS",
    "inspectNativeHelperBinary",
    "interpreterPresent",
    "neededLibraryCount",
    "executableStack",
    "inspectNativeHelperPrerequisites",
  ]) {
    requireText(nativeHelperContract, required, failures, "Native helper artifact contract");
  }
  const nativeHelperBuild = read(
    nativeHelperBuildPath,
    failures,
    "Native helper local builder",
  );
  for (const required of [
    'status: "PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND"',
    "byteIdenticalRepeat: true",
    "toolchainPinned: false",
    "imageBuildVerified: false",
    "cgroupV2RuntimeVerified: false",
    "passClaim: false",
    "rmSync(resolve(ROOT, REPORT_RELATIVE_PATH), { force: true })",
  ]) {
    requireText(nativeHelperBuild, required, failures, "Native helper local builder");
  }
  const nativeHelperVerify = read(
    nativeHelperVerifyPath,
    failures,
    "Native helper image verifier",
  );
  for (const required of [
    '"--pull=false"',
    '"--network=none"',
    '"Dockerfile.cgroup-helper"',
    "inspectNativeHelperBinary",
    "expectedHelperImageId",
    "expectedBinarySha256",
    "docker.binary(args, 60_000)",
    "hostInstallVerified: false",
    "cgroupV2RuntimeVerified: false",
    "passSigningEligible: false",
  ]) {
    requireText(nativeHelperVerify, required, failures, "Native helper image verifier");
  }
  if (nativeHelperVerify.includes("spawnSync")) {
    failures.push("Native helper image verifier must not bypass the pinned Docker runner.");
  }
  const nativeHelperLocalReportBody = read(
    nativeHelperLocalReportPath,
    failures,
    "Native helper local build report",
  );
  try {
    const report = JSON.parse(nativeHelperLocalReportBody);
    if (
      report?.schemaVersion !== "1" ||
      report?.status !== "PASS_LOCAL_TOOLCHAIN_NOT_IMAGE_BOUND" ||
      report?.sourceSha256 !== helperSource?.sha256 ||
      report?.binarySha256 !== contract?.nativeHelper?.localToolchainBinarySha256 ||
      report?.byteIdenticalRepeat !== true ||
      report?.toolchainPinned !== false ||
      report?.elf?.staticPie !== true ||
      report?.elf?.interpreterPresent !== false ||
      report?.elf?.neededLibraryCount !== 0 ||
      report?.elf?.executableStack !== false ||
      report?.imageBuildVerified !== false ||
      report?.hostInstallVerified !== false ||
      report?.cgroupV2RuntimeVerified !== false ||
      report?.liveEvidenceSigningEligible !== false ||
      report?.passClaim !== false
    ) {
      failures.push("Native helper local build report overclaims or does not match its source.");
    }
  } catch {
    failures.push("Native helper local build report is not valid JSON.");
  }

  const dockerfile = read(dockerfilePath, failures, "Dockerfile");
  requireText(dockerfile, "ARG NODE_BASE_IMAGE", failures, "Dockerfile");
  if (/^#\s*syntax\s*=/gimu.test(dockerfile)) {
    failures.push("Dockerfile must use the daemon-built frontend declared by the contract.");
  }
  if ((dockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\}/gmu) ?? []).length !== 2) {
    failures.push("Dockerfile must derive both stages from the required immutable image argument.");
  }
  if (/^FROM\s+node:/gimu.test(dockerfile) || /NODE_BASE_IMAGE\s*=\s*\S+/u.test(dockerfile)) {
    failures.push("Dockerfile must not provide a mutable Node image fallback.");
  }
  if (
    (dockerfile.match(/NODE_BASE_IMAGE must be an immutable Node 22\.22\.2 digest\./gu) ?? [])
      .length !== 2 ||
    !dockerfile.includes("@sha256:[0-9a-f]{64}")
  ) {
    failures.push("Dockerfile stages must reject mutable build-argument image references.");
  }
  for (const required of [
    "RUN pnpm install --frozen-lockfile",
    "RUN pnpm opa:install",
    "RUN pnpm build",
    "COPY --from=build --chown=node:node /app/.next/standalone ./",
    "COPY --from=build --chown=node:node /app/.next/static ./.next/static",
    "COPY --from=build --chown=node:node /app/public ./public",
    "COPY --from=build --chown=node:node /app/.tools/opa/1.18.2/opa /usr/local/bin/opa",
    "ENV OPA_PATH=/usr/local/bin/opa",
    "ENV POLICYTWIN_DATABASE_PATH=/data/policytwin.sqlite",
    "USER node",
    "HEALTHCHECK",
    'CMD ["node", "server.js"]',
  ]) {
    requireText(dockerfile, required, failures, "Dockerfile");
  }
  const liveCpuAdapterCapability = read(
    liveCpuAdapterCapabilityPath,
    failures,
    "Private live Linux cgroup CPU adapter capability",
  );
  for (const required of [
    "PRIVATE_LIVE_LINUX_CGROUP_CPU_ADAPTER: unique symbol",
    "PRIVATE_LIVE_LINUX_CGROUP_CPU_FINALIZED_EVIDENCE: unique symbol",
    "interface PrivateLiveLinuxCgroupCpuAdapter",
    "interface PrivateLiveLinuxCgroupCpuFinalizedEvidence",
    'readonly status: "PRIVATE_CAPABILITY_SCAFFOLD_ONLY"',
    "readonly runtimeAvailable: false",
    "readonly passSigningEligible: false",
  ]) {
    requireText(
      liveCpuAdapterCapability,
      required,
      failures,
      "Private live Linux cgroup CPU adapter capability",
    );
  }
  const liveCpuAdapter = read(
    liveCpuAdapterPath,
    failures,
    "Private live Linux cgroup CPU adapter scaffold",
  );
  for (const required of [
    "const privateAdapterCapabilities = new WeakSet<object>();",
    "const finalizedEvidenceCapabilities = new WeakSet<object>();",
    "createPrivateLiveLinuxCgroupCpuAdapterScaffold",
    "privateAdapterCapabilities.add(adapter)",
    "assertPrivateLiveLinuxCgroupCpuAdapter",
    "privateAdapterCapabilities.has(value)",
    "assertPrivateLiveLinuxCgroupCpuFinalizedEvidence",
    "finalizedEvidenceCapabilities.has(value)",
    'status: "PRIVATE_CAPABILITY_SCAFFOLD_ONLY"',
    "runtimeAvailable: false",
    "liveEvidenceIssuanceEnabled: false",
    "passSigningEligible: false",
    'status: "DEDICATED_LIFECYCLE_CONTRACT_ONLY"',
    "runtimeImplemented: false",
    "startBarrierImplemented: false",
    "finalizedEvidenceIssuanceImplemented: false",
    "independentCleanupSignalRequired: true",
    "serialPollingRequired: true",
    "identityRevalidationEverySampleRequired: true",
    "cleanupFailureSticky: true",
    "finalizeAfterCleanupRequired: true",
  ]) {
    requireText(
      liveCpuAdapter,
      required,
      failures,
      "Private live Linux cgroup CPU adapter scaffold",
    );
  }
  requireStageOrder(
    liveCpuAdapter,
    [
      '"EGRESS_START_BARRIER_HELD"',
      '"EGRESS_CGROUP_BOUND"',
      '"EGRESS_BASELINE_RECORDED"',
      '"EGRESS_START_BARRIER_RELEASED"',
      '"WORKER_START_BARRIER_HELD"',
      '"WORKER_CGROUP_BOUND"',
      '"WORKER_BASELINE_RECORDED"',
      '"WORKER_START_BARRIER_RELEASED"',
      '"WORKER_DOCKER_RELEASED"',
      '"WORKER_CGROUP_RELEASED"',
      '"EGRESS_DOCKER_RELEASED"',
      '"EGRESS_CGROUP_RELEASED"',
      '"VERIFIER_START_BARRIER_HELD"',
      '"VERIFIER_CGROUP_BOUND"',
      '"VERIFIER_BASELINE_RECORDED"',
      '"VERIFIER_START_BARRIER_RELEASED"',
      '"VERIFIER_DOCKER_RELEASED"',
      '"VERIFIER_CGROUP_RELEASED"',
      '"CONTROLLER_STOPPED"',
      '"EVIDENCE_FINALIZED"',
    ],
    failures,
    "Private live Linux cgroup CPU adapter scaffold",
  );
  if (
    /export\s+function\s+register/iu.test(liveCpuAdapter) ||
    liveCpuAdapter.includes("finalizedEvidenceCapabilities.add")
  ) {
    failures.push(
      "Private live Linux cgroup CPU capability must expose neither a registrar nor a finalized-evidence issuer.",
    );
  }
  const roleStartBarrier = read(roleStartBarrierPath, failures, "Role start barrier launcher");
  for (const required of [
    "awaitPolicyTwinRoleStartBarrier",
    'status: "HELD_BEFORE_ROLE_EXECUTION"',
    'status: "HELD_RECEIPT_COMMITTED"',
    "writeExistingHostOwnedSlot",
    'release.status !== "RELEASED_BY_HOST_SUPERVISOR"',
    'process.env.NODE_OPTIONS !== ""',
    'childEnvironment.NODE_OPTIONS = ""',
    "exactTarget(options.role, target)",
    "shell: false",
  ]) {
    requireText(roleStartBarrier, required, failures, "Role start barrier launcher");
  }
  const linuxStartBarrier = read(
    linuxStartBarrierPath,
    failures,
    "Private Linux start barrier controller",
  );
  for (const required of [
    "const controllerStates = new WeakMap<object, ControllerState>()",
    "const preparedRoleStates = new WeakMap<object, PreparedRoleState>()",
    "createPrivateLinuxStartBarrierController",
    "preparePrivateLinuxStartBarrierRole",
    "awaitPrivateLinuxStartBarrierHeld",
    "releasePrivateLinuxStartBarrierRole",
    "createHostOwnedReceiptSlot",
    'join(receiptDirectory, "held.commit.json")',
    "LOCKED_RECEIPT_DIRECTORY_MODE",
    "LOCKED_CONTROL_DIRECTORY_MODE",
    'state.status = "RELEASING"',
    "await handle.chmod(0o444)",
    'NODE_OPTIONS: ""',
    "dynamicRuntimeVerified: false",
  ]) {
    requireText(
      linuxStartBarrier,
      required,
      failures,
      "Private Linux start barrier controller",
    );
  }
  const releaseWriterStart = linuxStartBarrier.indexOf(
    "async function writeAtomicProtocolFile",
  );
  const releaseWriterEnd = linuxStartBarrier.indexOf(
    "export async function releasePrivateLinuxStartBarrierRole",
    releaseWriterStart,
  );
  const releaseWriter =
    releaseWriterStart >= 0 && releaseWriterEnd > releaseWriterStart
      ? linuxStartBarrier.slice(releaseWriterStart, releaseWriterEnd)
      : "";
  const releaseModeIndex = releaseWriter.indexOf("await handle.chmod(0o444)");
  const releaseRenameIndex = releaseWriter.indexOf("await rename(temporaryPath, path)");
  if (
    releaseModeIndex < 0 ||
    releaseRenameIndex < 0 ||
    releaseModeIndex > releaseRenameIndex ||
    releaseWriter.slice(releaseRenameIndex).includes("await chmod(path")
  ) {
    failures.push(
      "The start-barrier release must validate its final mode before rename publishes it.",
    );
  }
  const dedicatedLifecycle = read(
    dedicatedLifecyclePath,
    failures,
    "Non-privileged dedicated CPU lifecycle harness",
  );
  for (const required of [
    'readonly provenance: "NON_PRIVILEGED_TEST_PORT"',
    "revalidateAndReadRoleCpuSample",
    "readQuiescentRoleCpuSample",
    "terminateControllerAfterCleanupTimeout",
    "FORCED_TERMINATION_SETTLE_MS",
    'status: "COMPLETED_NOT_FINALIZED"',
    "dynamicRuntimeVerified: false",
    "finalizedEvidenceIssued: false",
    "passSigningEligible: false",
    'finalizationBlockedReason: "FINALIZED_EVIDENCE_ISSUER_NOT_IMPLEMENTED"',
  ]) {
    requireText(
      dedicatedLifecycle,
      required,
      failures,
      "Non-privileged dedicated CPU lifecycle harness",
    );
  }
  const liveLinuxDockerRolePlan = read(
    liveLinuxDockerRolePlanPath,
    failures,
    "Private Linux barrier Docker role plan",
  );
  for (const required of [
    "const privateRolePlans = new WeakSet<object>()",
    "REQUIRED_BIND_MOUNTS",
    "REQUIRED_TMPFS_MOUNTS",
    "assertPrivateLiveLinuxBarrierDockerRolePlan",
    'status: "PRIVATE_BARRIER_PLAN_NOT_RUNTIME_VERIFIED"',
    'entrypoint: ["node"]',
    '"scripts/role-start-barrier.mjs"',
    "receipt.readOnly",
    "!control.readOnly",
    "assertFactoryIssuedSupervisorDockerLifecyclePlan(input.lifecyclePlan)",
    "ROLE_TARGETS",
    "processPlan.mounts",
    "input.observedNetworkIds",
    "dynamicRuntimeVerified: false",
    "passSigningEligible: false",
  ]) {
    requireText(
      liveLinuxDockerRolePlan,
      required,
      failures,
      "Private Linux barrier Docker role plan",
    );
  }
  const liveLinuxDockerOwner = read(
    liveLinuxDockerOwnerPath,
    failures,
    "Private Linux Docker owner",
  );
  for (const required of [
    "assertPrivateDockerCliCommandRunner(options.runner)",
    "assertFactoryIssuedSupervisorDockerLifecyclePlan(options.lifecyclePlan)",
    "parseDockerNetworkOwnershipInspection",
    "parseDockerNetworkInspection",
    "network.plan.createArgs",
    "buildLiveLinuxBarrierDockerRolePlan",
    "createPrivateLiveLinuxOwnedDockerContainers",
    "startPrivateLiveLinuxOwnedDockerRoleHeld",
    "parseDockerContainerOwnershipInspection",
    "issuePrivateLiveLinuxOwnedDockerRole",
    "reobservePrivateLiveLinuxOwnedDockerRole",
    "consumePrivateLiveLinuxDockerHelperBindIdentity",
    "removePrivateLiveLinuxOwnedDockerRole",
    "removePrivateLiveLinuxOwnedDockerNetworks",
    "assertNetworkAbsent",
    "assertPrivateLiveLinuxDockerRemovalReceipt",
    "finalizePrivateLiveLinuxDockerCleanupReceipt",
    "settlePrivateLiveLinuxDockerOwnerOperations",
    "nativeHelperBinarySha256: options.lifecyclePlan.nativeHelper.binarySha256",
    "removalPromise",
    "dynamicRuntimeVerified: false",
  ]) {
    requireText(liveLinuxDockerOwner, required, failures, "Private Linux Docker owner");
  }
  const liveLinuxSystemAdapter = read(
    liveLinuxSystemAdapterPath,
    failures,
    "Private Linux Docker/cgroup system adapter",
  );
  for (const required of [
    'provenance: "PRIVATE_LINUX_DOCKER_CGROUP_ADAPTER"',
    "awaitPrivateLinuxStartBarrierHeld",
    "reobservePrivateLiveLinuxOwnedDockerRole",
    "bindPrivateLinuxCgroupHelperRole",
    "releasePrivateLinuxStartBarrierRole",
    "freezePrivateLinuxCgroupHelperRole",
    "killPrivateLinuxCgroupHelperRole",
    "readQuiescentPrivateLinuxCgroupHelperRole",
    "removePrivateLiveLinuxOwnedDockerRole",
    "releasePrivateLinuxCgroupHelperRole",
    "finalizePrivateLiveLinuxDockerCleanupReceipt",
    "terminatePrivateLinuxCgroupHelperAfterDockerCleanup",
    "assertPrivateLiveLinuxDockerOwnerBarrierConfiguration",
    "removePrivateLiveLinuxOwnedDockerNetworks",
    "options.owner.runBindingSha256 !== options.barrierController.runBindingSha256",
    "options.owner.nativeHelperBinarySha256 !== options.helperClient.helperSha256",
    "dynamicRuntimeVerified: false",
    "finalizedEvidenceIssued: false",
    "passSigningEligible: false",
  ]) {
    requireText(
      liveLinuxSystemAdapter,
      required,
      failures,
      "Private Linux Docker/cgroup system adapter",
    );
  }
  const nativeHelperProtocol = read(
    nativeHelperProtocolPath,
    failures,
    "Linux cgroup helper fixed binary protocol",
  );
  for (const required of [
    'Buffer.from("PTLC", "ascii")',
    "FRAME_HEADER_BYTES = 24",
    "MAX_PAYLOAD_BYTES = 256",
    "encodeLinuxCgroupHelperFrame",
    "decodeLinuxCgroupHelperFrame",
    "encodeLinuxCgroupHelperBindPayload",
    "decodeLinuxCgroupHelperSampleResponse",
  ]) {
    requireText(
      nativeHelperProtocol,
      required,
      failures,
      "Linux cgroup helper fixed binary protocol",
    );
  }
  const nativeHelperClient = read(
    nativeHelperClientPath,
    failures,
    "Private Linux cgroup helper client",
  );
  for (const required of [
    "const helperClientStates = new WeakMap<object, HelperClientState>()",
    "createPrivateLinuxCgroupHelperClient",
    "const boundRoleStates = new WeakMap<object, BoundRoleState>()",
    "bindPrivateLinuxCgroupHelperRole",
    "samplePrivateLinuxCgroupHelperRole",
    "freezePrivateLinuxCgroupHelperRole",
    "killPrivateLinuxCgroupHelperRole",
    "readQuiescentPrivateLinuxCgroupHelperRole",
    "releasePrivateLinuxCgroupHelperRole",
    "terminatePrivateLinuxCgroupHelperAfterDockerCleanup",
    "MIN_HELPER_REQUEST_TIMEOUT_MS = 6_000",
    'spawn("/proc/self/fd/3", ["--stdio-v1"]',
    'shell: false',
    'createHash("sha256")',
    "dynamicContainerRuntimeVerified: false",
    "liveEvidenceIssuanceEnabled: false",
    "passSigningEligible: false",
  ]) {
    requireText(nativeHelperClient, required, failures, "Private Linux cgroup helper client");
  }
  const nativeHelperSource = read(nativeHelperSourcePath, failures, "Linux cgroup native helper");
  for (const required of [
    "CLOCK_MONOTONIC_RAW",
    "SYS_pidfd_open",
    "SYS_pidfd_send_signal",
    "SYS_openat2",
    "RESOLVE_BENEATH",
    "RESOLVE_NO_SYMLINKS",
    "RESOLVE_NO_MAGICLINKS",
    "RESOLVE_NO_XDEV",
    "CGROUP2_SUPER_MAGIC",
    '"cgroup.freeze"',
    '"cgroup.kill"',
    "role_seen",
    "ROLE_STATE_QUIESCENT",
    "PR_SET_PDEATHSIG",
    "sigaction(SIGINT",
  ]) {
    requireText(nativeHelperSource, required, failures, "Linux cgroup native helper");
  }
  if (/\bsystem\s*\(|\bpopen\s*\(|AF_INET|SOCK_STREAM/u.test(nativeHelperSource)) {
    failures.push("Linux cgroup native helper must expose no shell or network surface.");
  }
  if (/OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|PRIVATE KEY/iu.test(dockerfile)) {
    failures.push("Dockerfile must not name or embed live worker credentials.");
  }

  for (const [path, label, user, entrypoint] of [
    [workerDockerfilePath, "Worker Dockerfile", "10001:10001", "scripts/worker-preflight.mjs"],
    [
      verifierDockerfilePath,
      "Verifier Dockerfile",
      "10002:10002",
      "scripts/verifier-preflight.mjs",
    ],
  ]) {
    const body = read(path, failures, label);
    requireText(body, "ARG NODE_BASE_IMAGE", failures, label);
    if ((body.match(/^FROM \$\{NODE_BASE_IMAGE\}/gmu) ?? []).length !== 2) {
      failures.push(`${label} must derive both stages from the immutable image argument.`);
    }
    if (
      /^FROM\s+node:/gimu.test(body) ||
      /NODE_BASE_IMAGE\s*=\s*\S+/u.test(body) ||
      /^#\s*syntax=/gimu.test(body) ||
      !body.includes("@sha256:[0-9a-f]{64}")
    ) {
      failures.push(`${label} must not provide a mutable Node image fallback.`);
    }
    for (const required of [
      "RUN pnpm install --frozen-lockfile",
      `USER ${user}`,
      `ENTRYPOINT [\"node\", \"${entrypoint}\"]`,
      'CMD ["--static-preflight"]',
    ]) {
      requireText(body, required, failures, label);
    }
    if (
      /OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|PRIVATE KEY/iu.test(body) ||
      /fixtures\/refund-demo|expected-fixed|docker\.sock/iu.test(body) ||
      /^COPY\s+\.\s+\./gmu.test(body)
    ) {
      failures.push(`${label} must not bundle fixtures, credentials, Docker access, or the repository.`);
    }
  }

  const workerDockerfile = read(workerDockerfilePath, failures, "Worker Dockerfile");
  for (const required of [
    "RUN node scripts/build-core.mjs",
    "RUN pnpm prune --prod",
    "COPY --from=build --chown=10001:10001 /opt/policytwin/dist ./dist",
    "COPY --from=build --chown=10001:10001 /opt/policytwin/node_modules ./node_modules",
    "COPY --from=build --chown=10001:10001 /opt/policytwin/package.json ./package.json",
    "COPY --chown=10001:10001 scripts/worker-preflight.mjs ./scripts/worker-preflight.mjs",
    "COPY --chown=10001:10001 scripts/proxy-token-helper.mjs ./scripts/proxy-token-helper.mjs",
    "COPY --chown=10001:10001 scripts/worker-entrypoint.mjs ./scripts/worker-entrypoint.mjs",
    "COPY --chown=10001:10001 scripts/role-start-barrier.mjs ./scripts/role-start-barrier.mjs",
  ]) {
    requireText(workerDockerfile, required, failures, "Worker Dockerfile");
  }
  if (/\bapp\b|\.next|server\.js/iu.test(workerDockerfile)) {
    failures.push("Worker Dockerfile must not contain the web runtime.");
  }

  const verifierDockerfile = read(verifierDockerfilePath, failures, "Verifier Dockerfile");
  for (const required of [
    "fs.cpSync(fs.realpathSync('node_modules/typescript')",
    "COPY --from=build --chown=10002:10002 /tmp/policytwin-typescript ./typescript",
    "COPY --chown=10002:10002 scripts/verifier-preflight.mjs ./scripts/verifier-preflight.mjs",
    "COPY --chown=10002:10002 scripts/role-start-barrier.mjs ./scripts/role-start-barrier.mjs",
  ]) {
    requireText(verifierDockerfile, required, failures, "Verifier Dockerfile");
  }
  if (/codex-sdk|\/dist\s+\.\/dist|prompts|\.next|server\.js/iu.test(verifierDockerfile)) {
    failures.push("Verifier Dockerfile must contain only the fixed verification runtime.");
  }

  const egressDockerfile = read(egressDockerfilePath, failures, "Egress proxy Dockerfile");
  requireText(egressDockerfile, "ARG NODE_BASE_IMAGE", failures, "Egress proxy Dockerfile");
  if (
    (egressDockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\}/gmu) ?? []).length !== 2 ||
    /^FROM\s+node:/gimu.test(egressDockerfile) ||
    /NODE_BASE_IMAGE\s*=\s*\S+/u.test(egressDockerfile) ||
    /^#\s*syntax=/gimu.test(egressDockerfile) ||
    !egressDockerfile.includes("@sha256:[0-9a-f]{64}")
  ) {
    failures.push("Egress proxy Dockerfile must derive from only the immutable image argument.");
  }
  for (const required of [
    "RUN pnpm install --frozen-lockfile",
    "RUN node scripts/build-core.mjs",
    "openai-egress-contract.js ./dist/codex/openai-egress-contract.js",
    "openai-egress-proxy.js ./dist/codex/openai-egress-proxy.js",
    "COPY --chown=10003:10003 scripts/role-start-barrier.mjs ./scripts/role-start-barrier.mjs",
    "USER 10003:10003",
    'ENTRYPOINT ["node", "scripts/openai-egress-proxy.mjs"]',
  ]) {
    requireText(egressDockerfile, required, failures, "Egress proxy Dockerfile");
  }
  if (
    /fixtures\/refund-demo|expected-fixed|docker\.sock|\.next|server\.js/iu.test(
      egressDockerfile,
    ) ||
    /^COPY\s+\.\s+\./gmu.test(egressDockerfile)
  ) {
    failures.push("Egress proxy Dockerfile must not bundle fixtures, Docker access, web runtime, or the repository.");
  }

  const workerPreflight = read(workerPreflightPath, failures, "Worker preflight");
  for (const required of [
    'process.argv[2] !== "--static-preflight"',
    "live worker execution is not implemented",
    'assertReal("/workspace/src/refund.ts"',
    'assertReal("/workspace/tests/refund.test.mjs"',
    "token.fill(0)",
    'dynamicIsolationVerified: false',
    'liveCodexExecuted: false',
    'CODEX_CA_CERTIFICATE: "/run/secrets/policytwin-egress-ca.pem"',
  ]) {
    requireText(workerPreflight, required, failures, "Worker preflight");
  }
  const workerEntrypoint = read(workerEntrypointPath, failures, "Prepared worker entrypoint");
  for (const required of [
    'process.argv[2] !== "--validate-only"',
    "prepareWorkerEntrypointContract",
    "canonicalWorkerRpcJson(value)",
    "readdirSync(PATHS.codexHome)",
    "PolicyTwin live worker remains disabled",
    "tokenBytes.fill(0)",
    "requestBytes.fill(0)",
  ]) {
    requireText(workerEntrypoint, required, failures, "Prepared worker entrypoint");
  }
  if (/new\s+Codex\s*\(|LIVE_CODEX_SDK/iu.test(workerEntrypoint)) {
    failures.push("Prepared worker entrypoint must not construct or claim live Codex execution.");
  }
  const proxyTokenHelper = read(proxyTokenHelperPath, failures, "Proxy token helper");
  for (const required of [
    'const TOKEN_FILE = "/run/secrets/policytwin-proxy-token"',
    "TOKEN_PATTERN.test(token)",
    "decoded.byteLength === 32",
    "tokenBytes.fill(0)",
  ]) {
    requireText(proxyTokenHelper, required, failures, "Proxy token helper");
  }
  const egressProxy = read(egressProxyPath, failures, "Egress proxy entrypoint");
  for (const required of [
    '"/run/secrets/policytwin-egress-tls-cert.pem"',
    '"/run/secrets/policytwin-egress-tls-key.pem"',
    '"/run/secrets/policytwin-egress-lease.json"',
    '"/run/secrets/policytwin-openai-key"',
    'minVersion: "TLSv1.3"',
    'server.listen(8443, "0.0.0.0")',
    'process.once("SIGTERM", close)',
  ]) {
    requireText(egressProxy, required, failures, "Egress proxy entrypoint");
  }
  const egressContract = read(egressContractPath, failures, "Egress admission contract");
  for (const required of [
    'OPENAI_EGRESS_UPSTREAM_AUTHORITY = "api.openai.com:443"',
    'OPENAI_EGRESS_REQUEST_PATH = "/v1/responses"',
    "OPENAI_EGRESS_MAX_REQUEST_BYTES = 1024 * 1024",
    "OPENAI_EGRESS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024",
    'input.method !== "POST"',
    "selectPinnedOpenAiIpv4",
    "timingSafeEqual",
  ]) {
    requireText(egressContract, required, failures, "Egress admission contract");
  }
  const dockerRunner = read(dockerRunnerPath, failures, "Supervisor Docker command runner");
  for (const required of [
    "spawn(dockerExecutablePath, [...args]",
    "shell: false",
    "assertSupervisorDockerArguments(args)",
    'argument.startsWith("__POLICYTWIN_")',
    '"--privileged"',
    '"--publish"',
    "dockerExecutableStat.isFile()",
    "platform local daemon endpoint",
    'argument === "--restart" && next !== "no"',
  ]) {
    requireText(dockerRunner, required, failures, "Supervisor Docker command runner");
  }
  const dockerObserver = read(dockerObserverPath, failures, "Supervisor Docker observer");
  for (const required of [
    "parseCreatedDockerId",
    "parseDockerNetworkInspection",
    "parseDockerContainerInspection",
    "Docker network membership does not match the admitted run.",
    "Docker bind mounts do not match the admitted plan.",
    "Docker tmpfs mounts do not match the admitted plan.",
    "Docker memory+swap limit",
    "Docker file-size limit",
    "Docker log limits",
    "Docker restart policy",
    "Docker container restarted during the admitted run.",
    "parseDockerContainerOwnershipInspection",
    "Docker port bindings",
  ]) {
    requireText(dockerObserver, required, failures, "Supervisor Docker observer");
  }
  const dockerDriver = read(dockerDriverPath, failures, "Supervisor Docker lifecycle driver");
  for (const required of [
    "createPreparedSupervisorDockerLifecycle",
    "parseCreatedDockerId(result.stdout",
    '["network", "disconnect", "--force", network.id, container.id]',
    '["rm", "--force", container.id]',
    '["network", "rm", network.id]',
    "com.policytwin.binding-sha256",
    "processObserver.processTreeIsEmpty",
    "listedById?.exitCode === 0",
    "configuration.allowedWorkerImage !== request.policy.workerImageDigest",
    "nativeHelperImage",
    "nativeHelperBinarySha256",
    "nativeHelperBuildInputSha256",
    "nativeHelperSourceSha256",
    "maximumWorkerLimits",
    "running instance changed",
    "did not remain stopped",
    "cpuBudgetController",
    "finalizeExecutionBudget",
    "finishCpuAccounting",
    "rawDockerReceipt",
    "cpuBudgetControllerStopped",
    "boundedCpuControl",
    "cpuControlBoundaryBreached",
  ]) {
    requireText(dockerDriver, required, failures, "Supervisor Docker lifecycle driver");
  }
  const cpuBudgetContract = read(
    cpuBudgetContractPath,
    failures,
    "Supervisor CPU budget contract",
  );
  for (const required of [
    'SUPERVISOR_CPU_BUDGET_ROLES = ["egress", "worker", "verifier"]',
    'status: "STATIC_FAKE_CONTROLLER_VERIFIED"',
    'accountingScope: "POST_BASELINE_THREE_ROLE_AGGREGATE"',
    "cumulativeCpuTimeEnforced: false",
    "hardLimitEnforced: false",
    "overshootBounded: false",
    "createStaticSupervisorCpuBudgetController",
    "createUnavailableSupervisorCpuBudgetController",
  ]) {
    requireText(cpuBudgetContract, required, failures, "Supervisor CPU budget contract");
  }
  const liveCpuProofContract = read(
    liveCpuProofContractPath,
    failures,
    "Live Linux cgroup CPU proof contract",
  );
  for (const required of [
    'LIVE_LINUX_CGROUP_CPU_ROLES = ["egress", "worker", "verifier"]',
    'proofType: "LIVE_LINUX_CGROUP_V2_THREE_ROLE"',
    'status: "OBSERVED_WITHIN_BUDGET"',
    'samplingMode: "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES"',
    "cumulativeAccountingVerified: true",
    "failStopEnforcementArmed: true",
    "hardLimitEnforced: false",
    "overshootBounded: false",
    "parseLiveLinuxCgroupCpuProof",
    "sampleTranscriptSha256",
    "liveLinuxCgroupDockerBindingSha256",
  ]) {
    requireText(
      liveCpuProofContract,
      required,
      failures,
      "Live Linux cgroup CPU proof contract",
    );
  }
  const liveCpuProofSchema = read(
    liveCpuProofSchemaPath,
    failures,
    "Live Linux cgroup CPU proof JSON Schema",
  );
  for (const required of [
    '"proofType": { "const": "LIVE_LINUX_CGROUP_V2_THREE_ROLE" }',
    '"samplingMode": { "const": "LINUX_CGROUP_V2_EMBEDDED_ROLE_SAMPLES" }',
    '"hardLimitEnforced": { "const": false }',
    '"overshootBounded": { "const": false }',
    '"items": false',
  ]) {
    requireText(
      liveCpuProofSchema,
      required,
      failures,
      "Live Linux cgroup CPU proof JSON Schema",
    );
  }
  try {
    const schema = JSON.parse(liveCpuProofSchema);
    const required = schema?.required;
    const properties = schema?.properties;
    const role = schema?.$defs?.role;
    const uint64Pattern = schema?.$defs?.uint64Decimal?.pattern;
    const roles = properties?.roles;
    if (
      schema?.additionalProperties !== false ||
      !Array.isArray(required) ||
      !required.includes("dockerBindingSha256") ||
      !required.includes("roles") ||
      roles?.minItems !== 3 ||
      roles?.maxItems !== 3 ||
      !Array.isArray(roles?.prefixItems) ||
      roles.prefixItems.length !== 3 ||
      roles?.items !== false ||
      role?.additionalProperties !== false ||
      !Array.isArray(role?.required) ||
      !role.required.includes("samplesUsec") ||
      !role.required.includes("sampleTranscriptSha256") ||
      typeof uint64Pattern !== "string" ||
      !new RegExp(uint64Pattern, "u").test("18446744073709551615") ||
      new RegExp(uint64Pattern, "u").test("18446744073709551616")
    ) {
      failures.push("Live Linux cgroup CPU proof JSON Schema is structurally weakened.");
    }
  } catch {
    failures.push("Live Linux cgroup CPU proof JSON Schema is not valid JSON or regex.");
  }
  const liveCpuEvidenceContract = read(
    liveCpuEvidenceContractPath,
    failures,
    "Live Linux cgroup CPU evidence v2 contract",
  );
  for (const required of [
    'LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2_ROLES = [',
    '"egress",',
    '"worker",',
    '"verifier",',
    '"OBSERVED_WITHIN_BUDGET"',
    '"PRE_EXECUTION_REJECTED"',
    '"LINUX_CONTROLLER_FAILURE"',
    '"OBSERVED_OVER_BUDGET_CONTAINED"',
    '"CONTAINMENT_INCOMPLETE"',
    '"CLOCK_MONOTONIC_RAW_NS"',
    '"LINUX_CGROUP_V2_GLOBAL_MONOTONIC_EVENT_TRANSCRIPT"',
    "liveLinuxCgroupCpuEvidenceV2EventTranscriptSha256",
    "liveLinuxCgroupCpuEvidenceV2AttemptBindingSha256",
    "liveLinuxCgroupCpuEvidenceV2Sha256",
    "parseLiveLinuxCgroupCpuEvidenceV2",
    "PRE_EXECUTION_CODES_BY_STAGE",
    "FAILURE_PHASE_BY_CODE",
    "hardLimitEnforced: false",
    "overshootBounded: false",
  ]) {
    requireText(
      liveCpuEvidenceContract,
      required,
      failures,
      "Live Linux cgroup CPU evidence v2 contract",
    );
  }
  const liveCpuEvidenceProducer = read(
    liveCpuEvidenceProducerPath,
    failures,
    "Live Linux cgroup CPU evidence v2 producer state machine",
  );
  for (const required of [
    'status: "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE";',
    "liveClaim: false;",
    "passSigningEligible: false;",
    "createLinuxCgroupCpuEvidenceV2Producer",
    "parseLiveLinuxCgroupCpuEvidenceV2",
    'clock: "CLOCK_MONOTONIC_RAW_NS"',
  ]) {
    requireText(
      liveCpuEvidenceProducer,
      required,
      failures,
      "Live Linux cgroup CPU evidence v2 producer state machine",
    );
  }
  const liveCpuEvidenceSchema = read(
    liveCpuEvidenceSchemaPath,
    failures,
    "Live Linux cgroup CPU evidence v2 JSON Schema",
  );
  try {
    const schema = JSON.parse(liveCpuEvidenceSchema);
    const uint64Pattern = schema?.$defs?.uint64Decimal?.pattern;
    const runNoncePattern = schema?.properties?.runNonce?.pattern;
    if (
      schema?.additionalProperties !== false ||
      schema?.properties?.schemaVersion?.const !== "2" ||
      schema?.properties?.evidenceType?.const !== "LIVE_LINUX_CGROUP_CPU_EVIDENCE_V2" ||
      !Array.isArray(schema?.oneOf) ||
      schema.oneOf.length !== 6 ||
      !Array.isArray(schema?.$defs?.event?.oneOf) ||
      schema.$defs.event.oneOf.length !== 5 ||
      schema?.$defs?.roleProof?.additionalProperties !== false ||
      schema?.$defs?.observedRole?.additionalProperties !== false ||
      schema?.$defs?.containment?.additionalProperties !== false ||
      !Array.isArray(schema?.$defs?.containment?.oneOf) ||
      schema.$defs.containment.oneOf.length !== 3 ||
      !Array.isArray(schema?.oneOf?.[5]?.anyOf) ||
      schema.oneOf[5].anyOf.length !== 5 ||
      !Array.isArray(schema?.$defs?.failurePair?.oneOf) ||
      schema.$defs.failurePair.oneOf.length !== 8 ||
      !Array.isArray(schema?.oneOf?.[2]?.allOf?.[0]?.oneOf) ||
      schema.oneOf[2].allOf[0].oneOf.length !== 3 ||
      !Array.isArray(schema?.$defs?.observedDockerBindingProfile?.oneOf) ||
      schema.$defs.observedDockerBindingProfile.oneOf.length !== 2 ||
      schema.oneOf.slice(3).some(
        (branch) =>
          !Array.isArray(branch?.allOf) ||
          !branch.allOf.some(
            (entry) => entry?.$ref === "#/$defs/observedDockerBindingProfile",
          ),
      ) ||
      schema?.properties?.budgetUsec?.$ref !== "#/$defs/positiveUint64Decimal" ||
      schema?.$defs?.positiveUint64Decimal?.allOf?.[1]?.not?.const !== "0" ||
      typeof runNoncePattern !== "string" ||
      !new RegExp(runNoncePattern, "u").test(Buffer.alloc(32, 7).toString("base64url")) ||
      new RegExp(runNoncePattern, "u").test(`${"A".repeat(42)}B`) ||
      typeof uint64Pattern !== "string" ||
      !new RegExp(uint64Pattern, "u").test("18446744073709551615") ||
      new RegExp(uint64Pattern, "u").test("18446744073709551616")
    ) {
      failures.push("Live Linux cgroup CPU evidence v2 JSON Schema is structurally weakened.");
    }
  } catch {
    failures.push("Live Linux cgroup CPU evidence v2 JSON Schema is not valid JSON or regex.");
  }
  const workerRpcContract = read(workerRpcContractPath, failures, "Worker RPC contract");
  for (const required of [
    'WORKER_RPC_V2_PROTOCOL = "policytwin.codex.repair.v2"',
    "WORKER_RPC_V2_SIGNATURE_DOMAIN",
    "WORKER_RPC_V2_EXECUTION_BINDING_DOMAIN",
    "workerRpcV2ExecutionBindingSha256",
    "parseWorkerRpcV2Request",
    "parseWorkerRpcV2Response",
    "workerRpcV2SignaturePayload",
    "parseLiveLinuxCgroupCpuEvidenceV2",
    '"cpuEvidence"',
    "status is inconsistent with its CPU evidence outcome",
    "cpuEvidenceSha256",
  ]) {
    requireText(workerRpcContract, required, failures, "Worker RPC contract");
  }
  const workerRpcClient = read(workerRpcClientPath, failures, "Worker RPC client");
  for (const required of [
    "createExternalWorkerRpcV2Client",
    "createWorkerRpcTrustBundle",
    "assertWorkerRpcTrustBundleSigner",
    "assertMutualTlsWorkerRpcV2Transport",
    "LIVE_LINUX_CGROUP_RPC_V2",
    "reuses Ed25519 key material",
    'startsWith("live-cpu-")',
    "workerRpcV2SignaturePayload",
    "request.policy.limits.cpuTimeMs",
    "Docker execution binding was replayed",
  ]) {
    requireText(workerRpcClient, required, failures, "Worker RPC client");
  }
  const workerRpcMtls = read(workerRpcMtlsPath, failures, "Worker RPC mTLS transport");
  for (const required of [
    "createMutualTlsWorkerRpcV2Transport",
    "createMutualTlsWorkerRpcV2Supervisor",
    "buildSignedV2Response",
    "request.policy.limits.cpuTimeMs",
    "DURABLE_SQLITE",
    "POLICYTWIN_SIGNERS",
    "options.trustBundle",
    "PASS signing is disabled until the live Linux controller is wired",
    "lacks the live CPU proof purpose",
  ]) {
    requireText(workerRpcMtls, required, failures, "Worker RPC mTLS transport");
  }
  const workerRpcMtlsTransport = read(
    workerRpcMtlsTransportPath,
    failures,
    "Worker RPC concrete mTLS client transport",
  );
  for (const required of [
    'WORKER_RPC_V2_MTLS_ALPN = "policytwin-worker-rpc/2"',
    'WORKER_RPC_V2_MTLS_REQUEST_MAGIC = "PTQ2"',
    'WORKER_RPC_V2_MTLS_RESPONSE_MAGIC = "PTS2"',
    "const MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS = new WeakSet<object>()",
    "createMutualTlsWorkerRpcV2Transport",
    "snapshotMutualTlsWorkerRpcTransportOptions",
    "Buffer.from(value)",
    "Object.freeze(copied)",
    "const snapshot = snapshotMutualTlsWorkerRpcTransportOptions(options)",
    "Object.freeze(",
    "MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS.add(transport)",
    "assertMutualTlsWorkerRpcV2Transport",
    "MUTUAL_TLS_WORKER_RPC_V2_TRANSPORTS.has(transport)",
    "must be created by the concrete mutual TLS v2 transport factory",
  ]) {
    requireText(
      workerRpcMtlsTransport,
      required,
      failures,
      "Worker RPC concrete mTLS client transport",
    );
  }
  const workerRpcTransportCapability = read(
    workerRpcTransportCapabilityPath,
    failures,
    "Worker RPC v2 transport capability",
  );
  for (const required of [
    "interface MutualTlsWorkerRpcV2Transport",
    "declare const MUTUAL_TLS_WORKER_RPC_V2_TRANSPORT: unique symbol",
    "readonly [MUTUAL_TLS_WORKER_RPC_V2_TRANSPORT]: true",
  ]) {
    requireText(
      workerRpcTransportCapability,
      required,
      failures,
      "Worker RPC v2 transport capability",
    );
  }
  if (
    workerRpcMtls.includes("registerMutualTls") ||
    workerRpcMtlsTransport.includes("registerMutualTls") ||
    workerRpcTransportCapability.includes("registerMutualTls") ||
    workerRpcClient.includes("registerMutualTls")
  ) {
    failures.push("Worker RPC v2 must not expose an arbitrary transport registrar.");
  }
  const rootIndex = read(rootIndexPath, failures, "Root package index");
  if (
    rootIndex.includes("worker-rpc-transport-capability") ||
    rootIndex.includes("worker-rpc-mtls-transport") ||
    rootIndex.includes("linux-cgroup-cpu-evidence-producer") ||
    rootIndex.includes("live-linux-cgroup-cpu-adapter") ||
    rootIndex.includes("live-linux-cgroup-cpu-adapter-capability") ||
    rootIndex.includes("live-linux-cgroup-cpu-dedicated-lifecycle") ||
    rootIndex.includes("linux-start-barrier") ||
    rootIndex.includes("linux-cgroup-helper-protocol") ||
    rootIndex.includes("linux-cgroup-helper-client") ||
    rootIndex.includes("registerMutualTlsWorkerRpcV2TransportInternal") ||
    rootIndex.includes("assertMutualTlsWorkerRpcV2Transport")
  ) {
    failures.push("Root package index must not expose Worker RPC v2 capability internals.");
  }
  const liveGateContract = read(liveGateContractPath, failures, "Live gate contract");
  for (const required of [
    "scripts/native-helper-container-verify.mjs",
    "HELPER_REPORT_INVALID",
    "report?.imageBuildVerified === true",
    "CUMULATIVE_CPU_PROOF_UNAVAILABLE",
    "report boolean or static fake-controller proof cannot advance the live gate",
    "report?.facts?.cumulativeCpuTimeEnforced === false",
  ]) {
    requireText(liveGateContract, required, failures, "Live gate contract");
  }
  const pinnedDockerCli = read(pinnedDockerCliPath, failures, "Pinned dynamic Docker CLI");
  for (const required of [
    "realpathSync.native(dockerExecutablePath) !== dockerExecutablePath",
    "dockerExecutableSha256",
    "assertReviewedDockerExecutable()",
    'createHash("sha256")',
    "The dynamic Docker CLI does not match the reviewed SHA-256.",
    "assertBinaryDockerArguments(args)",
    "encoding: binary ? null : \"utf8\"",
    'Object.defineProperty(docker, "binary"',
    "DOCKER_HOST: localDaemonHost",
    'DOCKER_CLI_HINTS: "false"',
    "spawnSync(dockerExecutablePath, args",
    "shell: false",
    '"exec",',
    'volume: new Set(["create", "inspect", "ls", "rm"])',
    'throw new Error("The dynamic Docker command is not allowlisted.")',
  ]) {
    requireText(pinnedDockerCli, required, failures, "Pinned dynamic Docker CLI");
  }
  const webContainerRuntime = read(
    webContainerRuntimePath,
    failures,
    "Web container resource owner",
  );
  for (const required of [
    "inspectWebContainerPrerequisites",
    "createWebContainerResourceOwner",
    'update("policytwin-web-container-verify-v1", "utf8")',
    '"com.policytwin.binding-sha256"',
    '"--pull=false"',
    "Immutable Node base image is not present locally; no pull was attempted.",
    "assertWebContainerRuntimeObservation(value, role",
    "host?.MemorySwap !== WEB_CONTAINER_MEMORY_BYTES",
    "host?.RestartPolicy?.Name !== \"no\"",
    "host?.LogConfig?.Type !== \"local\"",
    "ulimit?.Soft !== WEB_CONTAINER_OUTPUT_BYTES",
    "recoverContainerForCleanup",
    '["image", "rm", "--force", ownedImageId]',
  ]) {
    requireText(webContainerRuntime, required, failures, "Web container resource owner");
  }
  const containerVerify = read(containerVerifyPath, failures, "Web container verifier");
  for (const required of [
    'from "./pinned-docker-cli.mjs"',
    'from "./web-container-runtime.mjs"',
    "createPinnedDockerSync",
    "process.env.POLICYTWIN_DOCKER_CLI",
    "owner.preflight()",
    '"volume-init"',
    '"volume-probe"',
    '"web-first"',
    '"web-second"',
    "resourceIdentityBindingVerified",
    "boundedRuntimeResourcesVerified",
    "restartPolicyVerified",
    "cleanupPassed",
    "Container restart did not preserve the SQLite workspace decision.",
    'scope: "DYNAMIC_WEB_CONTAINER"',
    "fileURLToPath(import.meta.url)",
  ]) {
    requireText(containerVerify, required, failures, "Web container verifier");
  }
  for (const forbidden of [
    'spawnSync("docker"',
    '"run",',
    '"--pull",',
  ]) {
    if (containerVerify.includes(forbidden)) {
      failures.push(`Web container verifier must not contain ${JSON.stringify(forbidden)}.`);
    }
  }
  const verifierPreflight = read(verifierPreflightPath, failures, "Verifier preflight");
  for (const required of [
    'from "node:child_process"',
    'process.argv[2] !== "--static-preflight"',
    'process.argv[2] !== "--verify"',
    'env: SAFE_ENVIRONMENT',
    'shell: false',
    '"/opt/policytwin/typescript/bin/tsc"',
    '"/fixture/tests/refund.test.mjs"',
    'network: "UNVERIFIED_BY_PROCESS"',
    'credentialsPresent: false',
    'dynamicIsolationVerified: false',
  ]) {
    requireText(verifierPreflight, required, failures, "Verifier preflight");
  }
  const workerVerify = read(workerVerifyPath, failures, "Worker container verifier");
  for (const required of [
    'contract?.schemaVersion !== "15"',
    'from "./pinned-docker-cli.mjs"',
    "createPinnedDockerSync",
    "assertLinuxCgroupV2SupervisorPreflight",
    '"Dockerfile.worker"',
    '"Dockerfile.verifier"',
    'computeContainerBuildInput("worker")',
    'computeContainerBuildInput("verifier")',
    '"build"',
    '"{{.Id}}"',
    "reconstructVerificationWorkspace",
    "supervisorDockerBindingSha256",
    "requiredDockerId",
    'docker(["network", "inspect", workerNetworkId])',
    "parseDockerContainerInspection",
    "assertStoppedSameContainerInstance",
    "runningInstanceIdentityVerified",
    "facts.roleCpuBudgetsPostExitObserved",
    "facts.cgroupSubtreesQuiescent",
    "facts.originalCgroupsReleased",
    "Worker role-local CPU usage exceeded or regressed against its budget.",
    "Verifier role-local CPU usage exceeded or regressed against its budget.",
    "Worker final cgroup CPU observation failed.",
    "Verifier final cgroup CPU observation failed.",
    "Worker normal-path network-disconnect action failed.",
    "Worker normal-path removal action failed.",
    "Verifier normal-path removal action failed.",
    "const stopped = docker(",
    "const disconnected = docker(",
    'docker(["rm", "--force", id]',
    "Worker run workspace cleanup failed.",
  ]) {
    requireText(workerVerify, required, failures, "Worker container verifier");
  }
  requireOrderedText(
    workerVerify,
    [
      'if (failures.length > 0) throw new Error("Worker container prerequisites are incomplete.");',
      "assertLinuxCgroupV2SupervisorPreflight();",
      'const build = spawnSync(process.execPath, ["scripts/build-core.mjs"]',
    ],
    failures,
    "Worker container verifier",
  );
  requireOrderedText(
    workerVerify,
    [
      "const stoppedWorkerBeforeLogs = parseDockerContainerInspection(",
      'const workerLogs = docker(["logs", workerId]);',
      "const stoppedWorkerAfterLogs = parseDockerContainerInspection(",
    ],
    failures,
    "Worker container verifier",
  );
  requireOrderedText(
    workerVerify,
    [
      "const stoppedVerifierBeforeLogs = parseDockerContainerInspection(",
      'const verifierLogs = docker(["logs", verifierId]);',
      "const stoppedVerifierAfterLogs = parseDockerContainerInspection(",
    ],
    failures,
    "Worker container verifier",
  );
  const egressVerify = read(egressVerifyPath, failures, "Egress container verifier");
  for (const required of [
    'contract?.schemaVersion !== "15"',
    'from "./pinned-docker-cli.mjs"',
    "createPinnedDockerSync",
    "assertLinuxCgroupV2SupervisorPreflight",
    'scope: "DYNAMIC_EGRESS_PROXY_TLS_HANDSHAKE_ONLY_OUTBOUND_NOT_MEASURED"',
    "inspectEgressContainerPrerequisites",
    "createTlsMaterial",
    "OBSERVED_OUTBOUND_NETWORK_ID",
    "parseDockerContainerInspection",
    "assertSameRunningContainerInstance",
    "runningInstanceIdentityVerified",
    "facts.cgroupSubtreesQuiescent",
    "facts.originalCgroupsReleased",
    "const stopped = docker(",
    "const disconnected = docker(",
    "probeHttpRequestSent: false",
    'proxyUpstreamTrafficObservation: "NOT_MEASURED"',
    "probeModelInvocation: false",
    "liveCodexExecuted: false",
  ]) {
    requireText(egressVerify, required, failures, "Egress container verifier");
  }
  requireOrderedText(
    egressVerify,
    [
      'if (failures.length > 0) throw new Error("Egress container prerequisites are incomplete.");',
      "assertLinuxCgroupV2SupervisorPreflight();",
      'const build = spawnSync(process.execPath, ["scripts/build-core.mjs"]',
    ],
    failures,
    "Egress container verifier",
  );
  const linuxCgroupObserver = read(
    linuxCgroupObserverPath,
    failures,
    "Linux cgroup observer",
  );
  for (const required of [
    "const observations = new WeakMap();",
    "validateLinuxCgroupV2SupervisorPreflight",
    "assertLinuxCgroupV2SupervisorPreflight",
    'requiredLinuxOpenFlag("O_DIRECTORY")',
    "realpathSync.native(`/proc/self/fd/${directoryFileDescriptor}`) !== path",
    "parseLinuxCgroupPopulated",
    "populated || processIds.length !== 0",
    "const UINT64_MAX = (1n << 64n) - 1n;",
    "finalUsageUsec >= initialUsageUsec",
    "closeObservationState(state)",
  ]) {
    requireText(linuxCgroupObserver, required, failures, "Linux cgroup observer");
  }
  if (linuxCgroupObserver.includes('requiredLinuxOpenFlag("O_CLOEXEC")')) {
    failures.push("Linux cgroup observer must not require Node to expose O_CLOEXEC.");
  }
  requireOrderedText(
    egressVerify,
    [
      "const stoppedProbeBeforeLogs = parseDockerContainerInspection(",
      'const probeLogs = docker(["logs", probeId]).stdout.trim();',
      "const stoppedProbeAfterLogs = parseDockerContainerInspection(",
    ],
    failures,
    "Egress container verifier",
  );

  const dockerignore = read(dockerignorePath, failures, ".dockerignore");
  const ignored = new Set(
    dockerignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  for (const line of REQUIRED_DOCKERIGNORE_LINES) {
    if (!ignored.has(line)) failures.push(`.dockerignore must exclude ${line}.`);
  }
  for (const forbidden of ["artifacts/evidence", "artifacts/evidence/", "public", "fixtures/interpreter"] ) {
    if (ignored.has(forbidden)) failures.push(`.dockerignore must retain ${forbidden}.`);
  }

  const nextConfig = read(nextConfigPath, failures, "Next.js configuration");
  requireText(nextConfig, 'output: "standalone"', failures, "Next.js configuration");
  requireText(
    nextConfig,
    '"./fixtures/interpreter/seeded-refund-policy.txt"',
    failures,
    "Next.js configuration",
  );
  if (nextConfig.includes('"./fixtures/**/*"')) {
    failures.push("Next.js standalone tracing must not include the evaluation-only fixture tree.");
  }

  const healthRoute = read(healthRoutePath, failures, "Production health route");
  for (const field of ['status: "ok"', 'service: "policytwin"', 'schemaVersion: "1"']) {
    requireText(healthRoute, field, failures, "Production health route");
  }

  return {
    schemaVersion: "1",
    status: failures.length === 0 ? "PASS" : "FAIL",
    scope: "STATIC_WEB_WORKER_VERIFIER_EGRESS_HELPER_CONTAINERS",
    sourceInspectionMethod: "STRUCTURAL_JSON_AND_REQUIRED_SOURCE_MARKERS",
    behavioralVerification: "SEPARATE_UNIT_AND_INTEGRATION_TESTS",
    targetPlatform: contract?.targetPlatform ?? null,
    contractStatus: contract?.status ?? null,
    baseImagePinned,
    dockerCliSha256Pinned,
    nodeBaseImage: baseImagePinned ? contract.nodeBaseImage : null,
    workerImagePinned,
    verifierImagePinned,
    egressProxyImagePinned,
    nativeHelperBuilderImagePinned,
    nativeHelperImagePinned,
    nativeHelperBinaryPinned,
    workerBuildInputSha256: workerBuildInput?.sha256 ?? null,
    verifierBuildInputSha256: verifierBuildInput?.sha256 ?? null,
    egressProxyBuildInputSha256: egressBuildInput?.sha256 ?? null,
    nativeHelperBuildInputSha256: helperBuildInput?.sha256 ?? null,
    nativeHelperSourceSha256: helperSource?.sha256 ?? null,
    opaVersion: contract?.opaVersion ?? null,
    webContainerIncludesLiveCodexWorker:
      contract?.webContainer?.includesLiveCodexWorker ?? null,
    workerContainerStatus: contract?.workerContainer?.status ?? null,
    verifierContainerStatus: contract?.verifierContainer?.status ?? null,
    egressProxyStatus: contract?.egressProxy?.status ?? null,
    nativeHelperStatus: contract?.nativeHelper?.status ?? null,
    dynamicContainerVerified: false,
    releaseReady: false,
    failures,
  };
}

function main() {
  const report = inspectStaticContainerContract();
  const directory = resolve(ROOT, "artifacts", "security");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "container-static-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (report.status !== "PASS") {
    console.error(`Static container check failed: ${report.failures.join(" ")}`);
    process.exit(1);
  }
  console.log(
    "Static web, worker, verifier, egress proxy, and native helper contracts passed; immutable images, Docker daemon, dynamic isolation, live proxy traffic, and live Codex evidence remain required.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
