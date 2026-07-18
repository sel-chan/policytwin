import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPinnedDockerSync } from "./pinned-docker-cli.mjs";
import { ROOT } from "./process.mjs";
import {
  WEB_CONTAINER_MEMORY_BYTES,
  WEB_CONTAINER_OUTPUT_BYTES,
  WEB_CONTAINER_PIDS,
  assertWebContainerRuntimeObservation,
  createWebContainerResourceOwner,
  inspectWebContainerPrerequisites,
} from "./web-container-runtime.mjs";

function boundedRuntimeArguments() {
  return [
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    String(WEB_CONTAINER_PIDS),
    "--memory",
    String(WEB_CONTAINER_MEMORY_BYTES),
    "--memory-swap",
    String(WEB_CONTAINER_MEMORY_BYTES),
    "--cpus",
    "1",
    "--ulimit",
    `fsize=${WEB_CONTAINER_OUTPUT_BYTES}:${WEB_CONTAINER_OUTPUT_BYTES}`,
    "--log-driver",
    "local",
    "--log-opt",
    `max-size=${WEB_CONTAINER_OUTPUT_BYTES}`,
    "--log-opt",
    "max-file=1",
  ];
}

export function webRuntimeArguments(owner) {
  return [
    "--user",
    "node",
    ...boundedRuntimeArguments(),
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=67108864",
    "--mount",
    `type=volume,source=${owner.identity.volumeName},target=/data`,
    "--env",
    "HOME=/tmp",
    "--env",
    "POLICYTWIN_PUBLIC_ORIGIN=https://policytwin.invalid",
    "--publish",
    "127.0.0.1::3000",
    owner.identity.imageTag,
  ];
}

export function initializeVolume(owner, facts) {
  owner.createContainer("volume-init", [
    "--user",
    "0:0",
    ...boundedRuntimeArguments(),
    "--cap-add",
    "CHOWN",
    "--mount",
    `type=volume,source=${owner.identity.volumeName},target=/data`,
    "--entrypoint",
    "chown",
    owner.identity.imageTag,
    "node:node",
    "/data",
  ]);
  owner.startContainer("volume-init", false);
  if (owner.waitContainer("volume-init") !== 0) {
    throw new Error("Web verification volume initialization failed.");
  }
  assertWebContainerRuntimeObservation(
    owner.observeContainer("volume-init", false),
    "volume-init",
  );
  owner.removeContainer("volume-init");

  owner.createContainer("volume-probe", [
    "--user",
    "node",
    ...boundedRuntimeArguments(),
    "--mount",
    `type=volume,source=${owner.identity.volumeName},target=/data`,
    "--entrypoint",
    "node",
    owner.identity.imageTag,
    "-e",
    "process.stdout.write(String(require('node:fs').statSync('/data').uid))",
  ]);
  owner.startContainer("volume-probe", false);
  if (owner.waitContainer("volume-probe") !== 0) {
    throw new Error("Web verification volume ownership probe failed.");
  }
  assertWebContainerRuntimeObservation(
    owner.observeContainer("volume-probe", false),
    "volume-probe",
  );
  facts.volumeOwnerUid = owner.logsContainer("volume-probe").trim();
  owner.removeContainer("volume-probe");
  facts.initializationResourceLimitsVerified = true;
}

async function waitForHealth(docker, owner, role) {
  const containerId = owner.containerId(role);
  const portResult = docker(["port", containerId, "3000/tcp"]);
  const match = /127\.0\.0\.1:(\d+)/u.exec(portResult.stdout);
  if (match === null) throw new Error("Docker did not publish the health port on loopback.");
  const url = `http://127.0.0.1:${match[1]}/api/health`;
  const deadline = Date.now() + 60_000;
  let lastError = "health endpoint did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json();
      if (
        response.ok &&
        body.status === "ok" &&
        body.service === "policytwin" &&
        body.schemaVersion === "1"
      ) {
        const observation = assertWebContainerRuntimeObservation(
          owner.observeContainer(role, true),
          role,
        );
        const health = observation?.State?.Health?.Status;
        if (health !== "healthy") {
          lastError = `Docker health status is ${health || "unset"}`;
        } else {
          return { body, health, observation, url };
        }
      } else {
        lastError = "health endpoint returned an unexpected body";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Container health timed out: ${lastError}.`);
}

function cookieHeader(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "")
          .split(/,\s*(?=[^;,]+=)/u)
          .filter((value) => value.length > 0);
  const cookies = setCookies.map((value) => value.split(";", 1)[0]);
  if (cookies.length !== 2) {
    throw new Error("Container workspace response did not issue both bounded session cookies.");
  }
  return cookies.join("; ");
}

async function persistWorkspaceDecision(baseUrl) {
  const workspaceResponse = await fetch(
    `${baseUrl}/api/policies/policy-seeded-refund/workspace`,
    { headers: { "Sec-Fetch-Site": "same-origin" }, signal: AbortSignal.timeout(5_000) },
  );
  if (!workspaceResponse.ok) {
    throw new Error(`Container workspace initialization failed with ${workspaceResponse.status}.`);
  }
  const cookie = cookieHeader(workspaceResponse);
  const initial = await workspaceResponse.json();
  if (
    initial?.schemaVersion !== "1" ||
    initial?.workspace?.project?.currentVersion !== 1 ||
    typeof initial?.csrfToken !== "string"
  ) {
    throw new Error("Container workspace initialization returned an invalid contract.");
  }
  const decisionResponse = await fetch(
    `${baseUrl}/api/policies/policy-seeded-refund/versions/1/ambiguities/ambiguity-purchase-day-index/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: "https://policytwin.invalid",
        "Sec-Fetch-Site": "same-origin",
        "X-PolicyTwin-CSRF": initial.csrfToken,
      },
      body: JSON.stringify({ selectedOptionId: "purchase-day-zero" }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  const decision = await decisionResponse.json();
  if (
    !decisionResponse.ok ||
    decision?.schemaVersion !== "1" ||
    decision?.workspace?.project?.currentVersion !== 2
  ) {
    throw new Error(`Container SQLite mutation failed with ${decisionResponse.status}.`);
  }
  return {
    cookie,
    projectId: decision.workspace.project.id,
  };
}

async function verifyWorkspaceDecision(baseUrl, session) {
  const response = await fetch(`${baseUrl}/api/policies/policy-seeded-refund/workspace`, {
    headers: {
      Cookie: session.cookie,
      "Sec-Fetch-Site": "same-origin",
    },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json();
  const persistedDecision = body?.workspace?.decisionRecords?.find(
    (record) =>
      record?.ambiguityId === "ambiguity-purchase-day-index" &&
      record?.selectedOptionId === "purchase-day-zero",
  );
  if (
    !response.ok ||
    body?.schemaVersion !== "1" ||
    body?.workspace?.project?.id !== session.projectId ||
    body?.workspace?.project?.currentVersion !== 2 ||
    persistedDecision === undefined
  ) {
    throw new Error("Container restart did not preserve the SQLite workspace decision.");
  }
}

async function main() {
  const contract = JSON.parse(
    readFileSync(resolve(ROOT, "container-contract.json"), "utf8"),
  );
  const readiness = inspectWebContainerPrerequisites(contract);
  const failures = [...readiness.failures];
  const facts = {
    dockerServerVersion: null,
    canonicalDockerCliVerified: false,
    platformLocalDaemonSelected: false,
    dockerCliSha256: null,
    nodeBaseImagePresent: false,
    imageId: null,
    baseImage: contract.nodeBaseImage ?? null,
    resourceIdentityBindingVerified: false,
    firstContainerId: null,
    secondContainerId: null,
    initializationResourceLimitsVerified: false,
    boundedRuntimeResourcesVerified: false,
    restartPolicyVerified: false,
    opaVersion: null,
    opaSha256: null,
    runtimeUid: null,
    readOnlyRoot: false,
    healthStatus: null,
    healthResponse: null,
    persistentVolume: false,
    sqliteStatePersisted: false,
    volumeOwnerUid: null,
    cleanupPassed: false,
  };
  let pinnedDocker = null;
  let owner = null;
  let cleanupStarted = false;

  function docker(args, timeoutMs = 60_000, allowFailure = false) {
    if (pinnedDocker === null) throw new Error("The pinned Docker CLI is not initialized.");
    return pinnedDocker(args, timeoutMs, allowFailure);
  }

  function cleanup() {
    if (cleanupStarted) return [];
    cleanupStarted = true;
    return owner?.cleanup() ?? [];
  }

  const signalHandlers = new Map();
  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const handler = () => {
      const cleanupFailures = cleanup();
      if (cleanupFailures.length > 0) {
        console.error(
          `Container verification signal cleanup failed: ${cleanupFailures.join(" ")}`,
        );
      }
      process.exit(exitCode);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    if (failures.length > 0) {
      throw new Error("Web container prerequisites are incomplete.");
    }
    pinnedDocker = createPinnedDockerSync({
      repositoryRoot: ROOT,
      dockerExecutablePath: process.env.POLICYTWIN_DOCKER_CLI,
      dockerExecutableSha256: contract.supervisorDockerExecutor?.dockerCliSha256,
    });
    facts.canonicalDockerCliVerified = true;
    facts.platformLocalDaemonSelected = true;
    facts.dockerCliSha256 = contract.supervisorDockerExecutor.dockerCliSha256;
    owner = createWebContainerResourceOwner({
      docker,
      contract,
      nonce: randomBytes(16).toString("hex"),
    });
    owner.preflight();
    facts.nodeBaseImagePresent = true;
    facts.dockerServerVersion = docker([
      "info",
      "--format",
      "{{.ServerVersion}}",
    ], 10_000).stdout.trim();
    facts.imageId = owner.buildImage();
    owner.createVolume();
    initializeVolume(owner, facts);

    facts.firstContainerId = owner.createContainer(
      "web-first",
      webRuntimeArguments(owner),
    );
    owner.startContainer("web-first");
    const firstObservation = assertWebContainerRuntimeObservation(
      owner.observeContainer("web-first", true),
      "web-first",
    );
    const firstHealth = await waitForHealth(docker, owner, "web-first");
    facts.healthStatus = firstHealth.health;
    facts.healthResponse = firstHealth.body;
    facts.readOnlyRoot = firstObservation.HostConfig.ReadonlyRootfs === true;
    facts.resourceIdentityBindingVerified = true;
    facts.restartPolicyVerified = true;
    facts.boundedRuntimeResourcesVerified = true;

    const firstContainerId = owner.containerId("web-first");
    facts.runtimeUid = docker([
      "exec",
      firstContainerId,
      "node",
      "-p",
      "process.getuid()",
    ]).stdout.trim();
    const opaVersion = docker([
      "exec",
      firstContainerId,
      "/usr/local/bin/opa",
      "version",
    ]).stdout;
    facts.opaVersion = /^Version:\s*(\S+)/mu.exec(opaVersion)?.[1] ?? null;
    facts.opaSha256 = docker([
      "exec",
      firstContainerId,
      "node",
      "-e",
      "const fs=require('node:fs');const c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('/usr/local/bin/opa')).digest('hex'))",
    ]).stdout.trim();
    const persistedSession = await persistWorkspaceDecision(firstHealth.url);
    owner.removeContainer("web-first");

    facts.secondContainerId = owner.createContainer(
      "web-second",
      webRuntimeArguments(owner),
    );
    owner.startContainer("web-second");
    assertWebContainerRuntimeObservation(
      owner.observeContainer("web-second", true),
      "web-second",
    );
    const secondHealth = await waitForHealth(docker, owner, "web-second");
    await verifyWorkspaceDecision(secondHealth.url, persistedSession);
    facts.persistentVolume = true;
    facts.sqliteStatePersisted = true;
    if (
      facts.opaVersion !== contract.opaVersion ||
      facts.opaSha256 !== contract.opaLinuxAmd64StaticSha256 ||
      facts.runtimeUid === "0" ||
      facts.volumeOwnerUid === "0" ||
      facts.volumeOwnerUid !== facts.runtimeUid ||
      !facts.readOnlyRoot ||
      !facts.persistentVolume ||
      !facts.sqliteStatePersisted ||
      !facts.resourceIdentityBindingVerified ||
      !facts.restartPolicyVerified ||
      !facts.boundedRuntimeResourcesVerified
    ) {
      throw new Error("Container runtime evidence does not satisfy the pinned security contract.");
    }
  } catch (error) {
    if (failures.length === 0) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } finally {
    const cleanupFailures = cleanup();
    failures.push(...cleanupFailures);
    facts.cleanupPassed = owner !== null && cleanupFailures.length === 0;
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  }

  const report = {
    schemaVersion: "3",
    status: failures.length === 0 ? "PASS" : "FAIL",
    scope: "DYNAMIC_WEB_CONTAINER",
    workerContainerVerified: false,
    releaseReady: false,
    facts,
    failures: [...new Set(failures)],
  };
  const directory = resolve(ROOT, "artifacts", "security");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "container-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (report.status !== "PASS") {
    console.error(`Dynamic container verification failed: ${report.failures.join(" ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Dynamic web-container verification passed; the separate Codex worker and deployment remain unverified.",
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
