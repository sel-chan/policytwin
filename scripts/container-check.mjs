import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  const dockerignorePath = resolve(root, ".dockerignore");
  const nextConfigPath = resolve(root, "next.config.ts");
  const healthRoutePath = resolve(root, "app", "api", "health", "route.ts");
  const contractBody = read(contractPath, failures, "Container contract");
  let contract = null;
  try {
    contract = contractBody.length === 0 ? null : JSON.parse(contractBody);
  } catch {
    failures.push("Container contract is not valid JSON.");
  }
  if (
    contract === null ||
    contract.schemaVersion !== "2" ||
    contract.status !== "STATIC_PREPARED" ||
    contract.targetPlatform !== "linux/amd64" ||
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
    contract.workerContainer?.status !== "NOT_IMPLEMENTED" ||
    contract.workerContainer?.rpcProtocol !== "policytwin.codex.repair.v1" ||
    contract.workerContainer?.hostLiveConstructionAllowed !== false
  ) {
    failures.push("Container contract does not preserve the static web/worker split.");
  }
  const baseImagePinned =
    typeof contract?.nodeBaseImage === "string" &&
    /^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u.test(contract.nodeBaseImage);
  if (contract?.nodeBaseImage !== null && !baseImagePinned) {
    failures.push("Configured Node base image is not an immutable Node 22.22.2 digest.");
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
    scope: "STATIC_WEB_CONTAINER",
    targetPlatform: contract?.targetPlatform ?? null,
    contractStatus: contract?.status ?? null,
    baseImagePinned,
    nodeBaseImage: baseImagePinned ? contract.nodeBaseImage : null,
    opaVersion: contract?.opaVersion ?? null,
    webContainerIncludesLiveCodexWorker:
      contract?.webContainer?.includesLiveCodexWorker ?? null,
    workerContainerStatus: contract?.workerContainer?.status ?? null,
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
    "Static web-container contract passed; immutable base digest, Docker daemon, worker image, and dynamic health evidence remain required.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
