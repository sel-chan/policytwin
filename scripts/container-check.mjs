import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeContainerBuildInput } from "./container-build-inputs.mjs";
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

export function inspectStaticContainerContract(root = ROOT) {
  const failures = [];
  const contractPath = resolve(root, "container-contract.json");
  const dockerfilePath = resolve(root, "Dockerfile");
  const workerDockerfilePath = resolve(root, "Dockerfile.worker");
  const verifierDockerfilePath = resolve(root, "Dockerfile.verifier");
  const egressDockerfilePath = resolve(root, "Dockerfile.egress-proxy");
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
  const workerRpcContractPath = resolve(root, "src", "codex", "worker-rpc-contract.ts");
  const workerRpcClientPath = resolve(root, "src", "codex", "worker-rpc-client.ts");
  const workerRpcMtlsPath = resolve(root, "src", "codex", "worker-rpc-mtls.ts");
  const liveGateContractPath = resolve(root, "scripts", "live-gate-contract.mjs");
  const pinnedDockerCliPath = resolve(root, "scripts", "pinned-docker-cli.mjs");
  const containerVerifyPath = resolve(root, "scripts", "container-verify.mjs");
  const workerVerifyPath = resolve(root, "scripts", "worker-container-verify.mjs");
  const egressVerifyPath = resolve(root, "scripts", "egress-container-verify.mjs");
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
  try {
    workerBuildInput = computeContainerBuildInput("worker", root);
    verifierBuildInput = computeContainerBuildInput("verifier", root);
    egressBuildInput = computeContainerBuildInput("egress", root);
  } catch {
    failures.push("Container build inputs are absent or unsafe.");
  }
  if (
    contract === null ||
    contract.schemaVersion !== "7" ||
    contract.status !== "STATIC_PREPARED" ||
    contract.targetPlatform !== "linux/amd64" ||
    contract.dockerfileFrontend !== "DAEMON_BUILTIN_NO_EXTERNAL_FRONTEND" ||
    contract.nodeVersion !== "22.22.2" ||
    contract.opaVersion !== "1.18.2" ||
    !/^[0-9a-f]{64}$/u.test(contract.opaLinuxAmd64StaticSha256 ?? "") ||
    contract.applicationPort !== 3000 ||
    contract.healthPath !== "/api/health" ||
    contract.dataPath !== "/data/policytwin.sqlite" ||
    contract.webContainer?.includesLiveCodexWorker !== false ||
    contract.webContainer?.runtimeUser !== "node" ||
    contract.webContainer?.readOnlyRootRequired !== true ||
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
    contract.workerContainer?.liveCpuProofSchema !==
      "schemas/live-linux-cgroup-cpu-proof.v1.schema.json" ||
    contract.workerContainer?.liveCpuProofType !== "LIVE_LINUX_CGROUP_V2_THREE_ROLE" ||
    contract.workerContainer?.liveCpuPassProofRequired !== true ||
    contract.workerContainer?.liveCpuFailMayCarrySuccessProof !== false ||
    contract.workerContainer?.liveCpuExecutionBindingClientDerived !== true ||
    contract.workerContainer?.liveCpuDockerBindingDerivedFromRequestAndRoles !== true ||
    contract.workerContainer?.liveCpuKeyPurposePrefix !== "live-cpu-" ||
    contract.workerContainer?.liveCpuDedicatedKeyMaterialRequired !== true ||
    contract.workerContainer?.liveCpuUnifiedTrustBundleRequired !== true ||
    contract.workerContainer?.liveCpuDurableReplayRequired !== true ||
    contract.workerContainer?.liveCpuMtlsAlpn !== "policytwin-worker-rpc/2" ||
    contract.workerContainer?.liveCpuMtlsRequestMagic !== "PTQ2" ||
    contract.workerContainer?.liveCpuMtlsResponseMagic !== "PTS2" ||
    contract.workerContainer?.liveCpuHardLimitClaim !== false ||
    contract.workerContainer?.liveCpuOvershootBoundClaim !== false ||
    contract.workerContainer?.liveCpuGlobalEventTranscriptImplemented !== false ||
    contract.workerContainer?.liveCpuFailureEvidenceImplemented !== false ||
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
    contract.supervisorDockerExecutor?.contractVersion !== "2" ||
    contract.supervisorDockerExecutor?.bindingDomain !== "policytwin-docker-v2" ||
    contract.supervisorDockerExecutor?.resourceSuffixHexLength !== 32 ||
    contract.supervisorDockerExecutor?.shell !== false ||
    contract.supervisorDockerExecutor?.adoptExistingResources !== false ||
    contract.supervisorDockerExecutor?.operateByObservedIdOnly !== true ||
    contract.supervisorDockerExecutor?.independentInspectRequired !== true ||
    contract.supervisorDockerExecutor?.canonicalDockerExecutableRequired !== true ||
    contract.supervisorDockerExecutor?.platformLocalDaemonRequired !== true ||
    contract.supervisorDockerExecutor?.dynamicGateDockerCliEnvironmentVariable !==
      "POLICYTWIN_DOCKER_CLI" ||
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
    contract.supervisorDockerExecutor?.linuxCgroupCpuActuationImplemented !== false ||
    contract.supervisorDockerExecutor?.cgroupV2ProcessTreeRequiredForDynamicGate !== true ||
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
    contract.egressProxyBuildInputSha256 !== egressBuildInput?.sha256
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

  const dockerfile = read(dockerfilePath, failures, "Dockerfile");
  requireText(dockerfile, "ARG NODE_BASE_IMAGE", failures, "Dockerfile");
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
  const workerRpcContract = read(workerRpcContractPath, failures, "Worker RPC contract");
  for (const required of [
    'WORKER_RPC_V2_PROTOCOL = "policytwin.codex.repair.v2"',
    "WORKER_RPC_V2_SIGNATURE_DOMAIN",
    "WORKER_RPC_V2_EXECUTION_BINDING_DOMAIN",
    "workerRpcV2ExecutionBindingSha256",
    "parseWorkerRpcV2Request",
    "parseWorkerRpcV2Response",
    "workerRpcV2SignaturePayload",
    "parseLiveLinuxCgroupCpuProof",
    "FAIL receipt cannot carry a success CPU proof",
  ]) {
    requireText(workerRpcContract, required, failures, "Worker RPC contract");
  }
  const workerRpcClient = read(workerRpcClientPath, failures, "Worker RPC client");
  for (const required of [
    "createExternalWorkerRpcV2Client",
    "createWorkerRpcTrustBundle",
    "assertWorkerRpcTrustBundleSigner",
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
    'WORKER_RPC_V2_MTLS_ALPN = "policytwin-worker-rpc/2"',
    'WORKER_RPC_V2_MTLS_REQUEST_MAGIC = "PTQ2"',
    'WORKER_RPC_V2_MTLS_RESPONSE_MAGIC = "PTS2"',
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
  const liveGateContract = read(liveGateContractPath, failures, "Live gate contract");
  for (const required of [
    "CUMULATIVE_CPU_PROOF_UNAVAILABLE",
    "report boolean or static fake-controller proof cannot advance the live gate",
    "report?.facts?.cumulativeCpuTimeEnforced === false",
  ]) {
    requireText(liveGateContract, required, failures, "Live gate contract");
  }
  const pinnedDockerCli = read(pinnedDockerCliPath, failures, "Pinned dynamic Docker CLI");
  for (const required of [
    "realpathSync.native(dockerExecutablePath) !== dockerExecutablePath",
    "DOCKER_HOST: localDaemonHost",
    'DOCKER_CLI_HINTS: "false"',
    "spawnSync(dockerExecutablePath, args",
    "shell: false",
    'throw new Error("The dynamic Docker command is not allowlisted.")',
  ]) {
    requireText(pinnedDockerCli, required, failures, "Pinned dynamic Docker CLI");
  }
  const containerVerify = read(containerVerifyPath, failures, "Web container verifier");
  for (const required of [
    'contract.schemaVersion !== "7"',
    "Container restart did not preserve the SQLite workspace decision.",
    'scope: "DYNAMIC_WEB_CONTAINER"',
  ]) {
    requireText(containerVerify, required, failures, "Web container verifier");
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
    'contract?.schemaVersion !== "7"',
    'from "./pinned-docker-cli.mjs"',
    "createPinnedDockerSync",
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
    'docker(["rm", "--force", id]',
    "Worker run workspace cleanup failed.",
  ]) {
    requireText(workerVerify, required, failures, "Worker container verifier");
  }
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
    'contract?.schemaVersion !== "7"',
    'from "./pinned-docker-cli.mjs"',
    "createPinnedDockerSync",
    'scope: "DYNAMIC_EGRESS_PROXY_TLS_HANDSHAKE_ONLY_OUTBOUND_NOT_MEASURED"',
    "inspectEgressContainerPrerequisites",
    "createTlsMaterial",
    "OBSERVED_OUTBOUND_NETWORK_ID",
    "parseDockerContainerInspection",
    "assertSameRunningContainerInstance",
    "runningInstanceIdentityVerified",
    'docker(["network", "disconnect", "--force", networkId, containerId]',
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
    scope: "STATIC_WEB_WORKER_VERIFIER_EGRESS_CONTAINERS",
    sourceInspectionMethod: "STRUCTURAL_JSON_AND_REQUIRED_SOURCE_MARKERS",
    behavioralVerification: "SEPARATE_UNIT_AND_INTEGRATION_TESTS",
    targetPlatform: contract?.targetPlatform ?? null,
    contractStatus: contract?.status ?? null,
    baseImagePinned,
    nodeBaseImage: baseImagePinned ? contract.nodeBaseImage : null,
    workerImagePinned,
    verifierImagePinned,
    egressProxyImagePinned,
    workerBuildInputSha256: workerBuildInput?.sha256 ?? null,
    verifierBuildInputSha256: verifierBuildInput?.sha256 ?? null,
    egressProxyBuildInputSha256: egressBuildInput?.sha256 ?? null,
    opaVersion: contract?.opaVersion ?? null,
    webContainerIncludesLiveCodexWorker:
      contract?.webContainer?.includesLiveCodexWorker ?? null,
    workerContainerStatus: contract?.workerContainer?.status ?? null,
    verifierContainerStatus: contract?.verifierContainer?.status ?? null,
    egressProxyStatus: contract?.egressProxy?.status ?? null,
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
    "Static web, worker, verifier, and egress proxy container contracts passed; immutable images, Docker daemon, dynamic isolation, live proxy traffic, and live Codex evidence remain required.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
