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

export function inspectStaticContainerContract(root = ROOT) {
  const failures = [];
  const contractPath = resolve(root, "container-contract.json");
  const dockerfilePath = resolve(root, "Dockerfile");
  const workerDockerfilePath = resolve(root, "Dockerfile.worker");
  const verifierDockerfilePath = resolve(root, "Dockerfile.verifier");
  const dockerignorePath = resolve(root, ".dockerignore");
  const nextConfigPath = resolve(root, "next.config.ts");
  const healthRoutePath = resolve(root, "app", "api", "health", "route.ts");
  const workerPreflightPath = resolve(root, "scripts", "worker-preflight.mjs");
  const verifierPreflightPath = resolve(root, "scripts", "verifier-preflight.mjs");
  const workerVerifyPath = resolve(root, "scripts", "worker-container-verify.mjs");
  const contractBody = read(contractPath, failures, "Container contract");
  let contract = null;
  try {
    contract = contractBody.length === 0 ? null : JSON.parse(contractBody);
  } catch {
    failures.push("Container contract is not valid JSON.");
  }
  let workerBuildInput = null;
  let verifierBuildInput = null;
  try {
    workerBuildInput = computeContainerBuildInput("worker", root);
    verifierBuildInput = computeContainerBuildInput("verifier", root);
  } catch {
    failures.push("Container build inputs are absent or unsafe.");
  }
  if (
    contract === null ||
    contract.schemaVersion !== "3" ||
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
    contract.workerContainer?.rpcProtocol !== "policytwin.codex.repair.v1" ||
    contract.workerContainer?.hostLiveConstructionAllowed !== false ||
    contract.workerContainer?.dynamicVerified !== false ||
    contract.workerContainer?.liveCodexExecuted !== false ||
    contract.workerContainer?.runtimeUser !== "10001:10001" ||
    contract.workerContainer?.privileged !== false ||
    contract.workerContainer?.readOnlyRootRequired !== true ||
    JSON.stringify(contract.workerContainer?.capDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(contract.workerContainer?.capAdd) !== JSON.stringify([]) ||
    contract.workerContainer?.noNewPrivileges !== true ||
    contract.workerContainer?.pidsLimit !== 64 ||
    contract.workerContainer?.memoryBytes !== 1_073_741_824 ||
    contract.workerContainer?.cpus !== 1 ||
    contract.workerContainer?.fixtureRoot !== "/workspace" ||
    contract.workerContainer?.fixtureRootReadOnly !== true ||
    JSON.stringify(contract.workerContainer?.writablePaths) !==
      JSON.stringify(["src/refund.ts", "tests/refund.test.mjs"]) ||
    JSON.stringify(contract.workerContainer?.tmpfs) !==
      JSON.stringify(["/worker-home", "/tmp"]) ||
    contract.workerContainer?.network !== "policytwin-worker-internal" ||
    contract.workerContainer?.networkInternalRequired !== true ||
    contract.workerContainer?.proxyAuthority !== "policytwin-egress:8443" ||
    contract.workerContainer?.proxyTokenFile !== "/run/secrets/policytwin-proxy-token" ||
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
    JSON.stringify(contract.verifierContainer?.capDrop) !== JSON.stringify(["ALL"]) ||
    JSON.stringify(contract.verifierContainer?.capAdd) !== JSON.stringify([]) ||
    contract.verifierContainer?.noNewPrivileges !== true ||
    contract.verifierContainer?.pidsLimit !== 32 ||
    contract.verifierContainer?.memoryBytes !== 536_870_912 ||
    contract.verifierContainer?.cpus !== 1 ||
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
    contract.egressProxy?.status !== "NOT_IMPLEMENTED" ||
    contract.egressProxy?.dynamicVerified !== false ||
    contract.egressProxy?.workerNetwork !== "policytwin-worker-internal" ||
    contract.egressProxy?.allowedAuthority !== "api.openai.com:443" ||
    contract.egressProxy?.arbitraryConnectAllowed !== false ||
    contract.workerBuildInputSha256 !== workerBuildInput?.sha256 ||
    contract.verifierBuildInputSha256 !== verifierBuildInput?.sha256
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
  if (contract?.workerImage !== null && !workerImagePinned) {
    failures.push("Configured worker image is not immutable.");
  }
  if (contract?.verifierImage !== null && !verifierImagePinned) {
    failures.push("Configured verifier image is not immutable.");
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

  const workerPreflight = read(workerPreflightPath, failures, "Worker preflight");
  for (const required of [
    'process.argv[2] !== "--static-preflight"',
    "live worker execution is not implemented",
    'assertReal("/workspace/src/refund.ts"',
    'assertReal("/workspace/tests/refund.test.mjs"',
    "token.fill(0)",
    'dynamicIsolationVerified: false',
    'liveCodexExecuted: false',
  ]) {
    requireText(workerPreflight, required, failures, "Worker preflight");
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
    '"Dockerfile.worker"',
    '"Dockerfile.verifier"',
    'computeContainerBuildInput("worker")',
    'computeContainerBuildInput("verifier")',
    '"build"',
    '"{{.Id}}"',
    "reconstructVerificationWorkspace",
    'docker(["network", "inspect", contract.workerContainer.network])',
    'docker(["image", "rm", "--force", tag]',
    "Worker run workspace cleanup failed.",
  ]) {
    requireText(workerVerify, required, failures, "Worker container verifier");
  }

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
    scope: "STATIC_WEB_WORKER_VERIFIER_CONTAINERS",
    targetPlatform: contract?.targetPlatform ?? null,
    contractStatus: contract?.status ?? null,
    baseImagePinned,
    nodeBaseImage: baseImagePinned ? contract.nodeBaseImage : null,
    workerImagePinned,
    verifierImagePinned,
    workerBuildInputSha256: workerBuildInput?.sha256 ?? null,
    verifierBuildInputSha256: verifierBuildInput?.sha256 ?? null,
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
    "Static web, worker, and verifier container contracts passed; immutable images, Docker daemon, egress proxy, dynamic isolation, and live Codex evidence remain required.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
