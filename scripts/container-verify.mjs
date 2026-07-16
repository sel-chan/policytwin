import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./process.mjs";

const contract = JSON.parse(
  readFileSync(resolve(ROOT, "container-contract.json"), "utf8"),
);
const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const imageTag = `policytwin-verify:${suffix}`;
const containerName = `policytwin-verify-${suffix}`;
const volumeName = `policytwin-verify-data-${suffix}`;
const failures = [];
const facts = {
  dockerServerVersion: null,
  imageId: null,
  baseImage: null,
  opaVersion: null,
  opaSha256: null,
  runtimeUid: null,
  readOnlyRoot: false,
  healthStatus: null,
  healthResponse: null,
  persistentVolume: false,
  sqliteStatePersisted: false,
  volumeOwnerUid: null,
};
let cleanupStarted = false;
let imageCreated = false;
let volumeCreated = false;
let containerCreated = false;

function docker(args, timeoutMs = 60_000, allowFailure = false) {
  const result = spawnSync("docker", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (!allowFailure && (result.error !== undefined || result.status !== 0)) {
    throw new Error(`docker ${args[0] ?? "command"} failed with exit code ${result.status ?? 1}.`);
  }
  return result;
}

function startContainer() {
  docker(
    [
      "run",
      "--detach",
      "--name",
      containerName,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=67108864",
      "--mount",
      `type=volume,source=${volumeName},target=/data`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "64",
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--env",
      "HOME=/tmp",
      "--env",
      "POLICYTWIN_PUBLIC_ORIGIN=https://policytwin.invalid",
      "--publish",
      "127.0.0.1::3000",
      imageTag,
    ],
    60_000,
  );
  containerCreated = true;
}

function initializeVolume() {
  docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "CHOWN",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=volume,source=${volumeName},target=/data`,
    "--entrypoint",
    "chown",
    imageTag,
    "node:node",
    "/data",
  ]);
  facts.volumeOwnerUid = docker([
    "run",
    "--rm",
    "--user",
    "node",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=volume,source=${volumeName},target=/data`,
    "--entrypoint",
    "node",
    imageTag,
    "-e",
    "process.stdout.write(String(require('node:fs').statSync('/data').uid))",
  ]).stdout.trim();
}

async function waitForHealth() {
  const portResult = docker(["port", containerName, "3000/tcp"]);
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
        const health = docker([
          "inspect",
          "--format",
          "{{.State.Health.Status}}",
          containerName,
        ]).stdout.trim();
        if (health !== "healthy") {
          lastError = `Docker health status is ${health || "unset"}`;
        } else {
          return { body, health, url };
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

function removeContainerForRestart() {
  if (!containerCreated) return;
  const result = docker(["rm", "--force", containerName], 30_000, true);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`docker container cleanup failed with exit code ${result.status ?? 1}.`);
  }
  containerCreated = false;
}

function cleanup() {
  if (cleanupStarted) return [];
  cleanupStarted = true;
  const cleanupFailures = [];
  for (const resource of [
    {
      created: containerCreated,
      label: "container",
      args: ["rm", "--force", containerName],
      timeoutMs: 30_000,
      cleared: () => { containerCreated = false; },
    },
    {
      created: volumeCreated,
      label: "volume",
      args: ["volume", "rm", "--force", volumeName],
      timeoutMs: 30_000,
      cleared: () => { volumeCreated = false; },
    },
    {
      created: imageCreated,
      label: "image",
      args: ["image", "rm", "--force", imageTag],
      timeoutMs: 60_000,
      cleared: () => { imageCreated = false; },
    },
  ]) {
    if (!resource.created) continue;
    const result = docker(resource.args, resource.timeoutMs, true);
    if (result.error !== undefined || result.status !== 0) {
      cleanupFailures.push(
        `Docker ${resource.label} cleanup failed with exit code ${result.status ?? 1}.`,
      );
    } else {
      resource.cleared();
    }
  }
  return cleanupFailures;
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    const cleanupFailures = cleanup();
    if (cleanupFailures.length > 0) {
      console.error(`Container verification signal cleanup failed: ${cleanupFailures.join(" ")}`);
    }
    process.exit(exitCode);
  });
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

try {
  if (
    contract.schemaVersion !== "10" ||
    typeof contract.nodeBaseImage !== "string" ||
    !/^node:22\.22\.2-[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u.test(
      contract.nodeBaseImage,
    )
  ) {
    throw new Error("Container verification requires a verified immutable Node 22.22.2 image.");
  }
  facts.baseImage = contract.nodeBaseImage;
  const info = docker(["info", "--format", "{{.ServerVersion}}"], 10_000);
  facts.dockerServerVersion = info.stdout.trim();
  docker(
    [
      "build",
      "--pull",
      "--platform",
      contract.targetPlatform,
      "--build-arg",
      `NODE_BASE_IMAGE=${contract.nodeBaseImage}`,
      "--tag",
      imageTag,
      ".",
    ],
    20 * 60_000,
  );
  imageCreated = true;
  facts.imageId = docker(["image", "inspect", "--format", "{{.Id}}", imageTag]).stdout.trim();
  docker(["volume", "create", volumeName]);
  volumeCreated = true;
  initializeVolume();
  startContainer();
  const firstHealth = await waitForHealth();
  facts.healthStatus = firstHealth.health;
  facts.healthResponse = firstHealth.body;
  facts.readOnlyRoot =
    docker(["inspect", "--format", "{{.HostConfig.ReadonlyRootfs}}", containerName])
      .stdout.trim() === "true";
  facts.runtimeUid = docker([
    "exec",
    containerName,
    "node",
    "-p",
    "process.getuid()",
  ]).stdout.trim();
  const opaVersion = docker(["exec", containerName, "/usr/local/bin/opa", "version"]).stdout;
  facts.opaVersion = /^Version:\s*(\S+)/mu.exec(opaVersion)?.[1] ?? null;
  facts.opaSha256 = docker([
    "exec",
    containerName,
    "node",
    "-e",
    "const fs=require('node:fs');const c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('/usr/local/bin/opa')).digest('hex'))",
  ]).stdout.trim();
  const persistedSession = await persistWorkspaceDecision(firstHealth.url);
  removeContainerForRestart();
  startContainer();
  const secondHealth = await waitForHealth();
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
    !facts.sqliteStatePersisted
  ) {
    throw new Error("Container runtime evidence does not satisfy the pinned security contract.");
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  failures.push(...cleanup());
}

const report = {
  schemaVersion: "3",
  status: failures.length === 0 ? "PASS" : "FAIL",
  scope: "DYNAMIC_WEB_CONTAINER",
  workerContainerVerified: false,
  releaseReady: false,
  facts,
  failures,
};
const directory = resolve(ROOT, "artifacts", "security");
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, "container-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
if (failures.length > 0) {
  console.error(`Dynamic container verification failed: ${failures.join(" ")}`);
  process.exit(1);
}
console.log(
  "Dynamic web-container verification passed; the separate Codex worker and deployment remain unverified.",
);
