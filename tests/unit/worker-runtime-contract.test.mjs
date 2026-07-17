import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildWorkerRuntimePlan,
  createWorkerRuntimeLayout,
  OBSERVED_WORKER_NETWORK_ID,
  reconstructVerificationWorkspace,
  verifierEnvironment,
  WORKER_WRITABLE_PATHS,
} from "../../dist/codex/worker-runtime-contract.js";
import { createOpenAiEgressLease } from "../../dist/codex/openai-egress-contract.js";
import {
  assertFactoryIssuedSupervisorDockerLifecyclePlan,
  buildSupervisorDockerLifecyclePlan,
  OBSERVED_OUTBOUND_NETWORK_ID,
} from "../../dist/codex/egress-runtime-contract.js";

const DIGEST = "a".repeat(64);
const PROXY_TOKEN = Buffer.alloc(32, 13).toString("base64url");
const OWNERSHIP_NONCE = "b".repeat(32);
const REQUEST_SHA256 = "d".repeat(64);
const WORKER_NETWORK = `policytwin-worker-${"c".repeat(32)}`;
const LIMITS = {
  wallTimeMs: 60_000,
  cpuTimeMs: 30_000,
  memoryBytes: 1_073_741_824,
  pids: 64,
  outputBytes: 4_194_304,
};

function optionValues(args, option) {
  return args.flatMap((value, index) => (value === option ? [args[index + 1]] : []));
}

async function createRuntimeFixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-runtime-"));
  const baselineRoot = join(repositoryRoot, "fixtures", "refund-demo", "baseline");
  const runId = "run-12345678";
  const layout = createWorkerRuntimeLayout({ repositoryRoot, runId });
  await mkdir(join(baselineRoot, "src"), { recursive: true });
  await mkdir(join(baselineRoot, "tests"), { recursive: true });
  await mkdir(join(layout.repairRoot, "src"), { recursive: true });
  await mkdir(join(layout.repairRoot, "tests"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "src"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "tests"), { recursive: true });
  await mkdir(join(layout.verificationRoot, "dist"), { recursive: true });
  for (const [path, body] of [
    [join(baselineRoot, "package.json"), "{}\n"],
    [join(baselineRoot, "tsconfig.json"), "{}\n"],
    [join(baselineRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(baselineRoot, "tests", "refund.test.mjs"), "// baseline test\n"],
    [join(layout.repairRoot, "src", "refund.ts"), "export const repaired = true;\n"],
    [join(layout.repairRoot, "tests", "refund.test.mjs"), "// repaired test\n"],
    [join(layout.verificationRoot, "package.json"), "{}\n"],
    [join(layout.verificationRoot, "tsconfig.json"), "{}\n"],
    [join(layout.verificationRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(layout.verificationRoot, "tests", "refund.test.mjs"), "// baseline test\n"],
    [layout.requestPath, "{}\n"],
    [layout.responsePath, "\n"],
    [layout.proxyTokenPath, `${PROXY_TOKEN}\n`],
    [layout.proxyCaPath, "test-ca\n"],
  ]) {
    await writeFile(path, body, "utf8");
  }
  return { repositoryRoot, runId, layout };
}

test("worker runtime plan fixes the two-file write set and credential-free verifier", async (t) => {
  const fixture = await createRuntimeFixture();
  t.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const plan = buildWorkerRuntimePlan({
    repositoryRoot: fixture.repositoryRoot,
    runId: fixture.runId,
    workerImage: `sha256:${DIGEST}`,
    verifierImage: `sha256:${DIGEST}`,
    workerNetwork: WORKER_NETWORK,
    ownershipNonce: OWNERSHIP_NONCE,
    requestSha256: REQUEST_SHA256,
    limits: LIMITS,
  });

  assert.deepEqual(WORKER_WRITABLE_PATHS, ["src/refund.ts", "tests/refund.test.mjs"]);
  assert.equal(plan.schemaVersion, "1");
  assert.equal(plan.status, "STATIC_PLAN_ONLY");
  assert.equal(plan.dynamicIsolationVerified, false);
  assert.equal(plan.liveCodexExecuted, false);
  assert.equal(plan.worker.network, WORKER_NETWORK);
  assert.deepEqual(plan.worker.labels, {
    "com.policytwin.managed": "true",
    "com.policytwin.contract-version": "3",
    "com.policytwin.binding-sha256": plan.worker.labels["com.policytwin.binding-sha256"],
    "com.policytwin.request-sha256": REQUEST_SHA256,
    "com.policytwin.run-id": fixture.runId,
    "com.policytwin.role": "worker",
  });
  assert.match(plan.worker.labels["com.policytwin.binding-sha256"], /^[0-9a-f]{64}$/u);
  assert.equal(optionValues(plan.worker.dockerArgs, "--label").length, 6);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--network"), [
    OBSERVED_WORKER_NETWORK_ID,
  ]);
  assert.equal(plan.verifier.network, "none");
  assert.deepEqual(plan.verifier.environment, verifierEnvironment());
  assert.equal(plan.worker.mounts.filter((mount) => mount.readOnly === false).length, 3);
  assert.deepEqual(
    plan.worker.mounts
      .filter((mount) => mount.target.startsWith("/workspace/") && !mount.readOnly)
      .map((mount) => mount.target),
    ["/workspace/src/refund.ts", "/workspace/tests/refund.test.mjs"],
  );
  assert.equal(
    plan.worker.mounts.find((mount) => mount.target === "/workspace")?.readOnly,
    true,
  );
  assert.equal(
    plan.verifier.mounts.find((mount) => mount.target === "/fixture")?.readOnly,
    true,
  );
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /expected-fixed|docker\.sock|OPENAI_API_KEY|CODEX_API_KEY/u);
  assert.match(serialized, /--read-only/u);
  assert.match(serialized, /no-new-privileges:true/u);
  assert.match(serialized, /--network","none/u);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--user"), ["10001:10001"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--user"), ["10002:10002"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--cap-drop"), ["ALL"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--cap-drop"), ["ALL"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--pids-limit"), ["64"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--pids-limit"), ["32"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--memory"), ["1073741824"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--memory"), ["536870912"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--cpus"), ["1"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--cpus"), ["1"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--stop-timeout"), ["5"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--stop-timeout"), ["5"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--restart"), ["no"]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--restart"), ["no"]);
  assert.equal(plan.worker.restartPolicy, "no");
  assert.equal(plan.verifier.restartPolicy, "no");
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--security-opt"), [
    "no-new-privileges:true",
  ]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--security-opt"), [
    "no-new-privileges:true",
  ]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--tmpfs"), [
    "/worker-home:rw,noexec,nosuid,nodev,size=67108864",
    "/tmp:rw,noexec,nosuid,nodev,size=67108864",
  ]);
  assert.deepEqual(optionValues(plan.verifier.dockerArgs, "--tmpfs"), [
    "/tmp:rw,noexec,nosuid,nodev,size=67108864",
    "/fixture/dist:rw,noexec,nosuid,nodev,size=67108864",
  ]);
  const workerMounts = optionValues(plan.worker.dockerArgs, "--mount");
  assert.equal(workerMounts.length, 7);
  assert.match(workerMounts[0], /target=\/workspace,readonly$/u);
  assert.match(workerMounts[1], /target=\/workspace\/src\/refund\.ts$/u);
  assert.match(workerMounts[2], /target=\/workspace\/tests\/refund\.test\.mjs$/u);
  assert.match(workerMounts[3], /target=\/run\/policytwin\/request\.json,readonly$/u);
  assert.match(workerMounts[4], /target=\/run\/policytwin\/response\.json$/u);
  assert.match(
    workerMounts[5],
    /target=\/run\/secrets\/policytwin-proxy-token,readonly$/u,
  );
  assert.match(
    workerMounts[6],
    /target=\/run\/secrets\/policytwin-egress-ca\.pem,readonly$/u,
  );
  assert.equal(plan.worker.dockerArgs.includes("--privileged"), false);
  assert.equal(plan.verifier.dockerArgs.includes("--privileged"), false);
});

test("verification reconstruction copies only the approved repair overlays", async (t) => {
  const fixture = await createRuntimeFixture();
  t.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const repairedSource = "export const repaired = 'bound-to-verifier';\n";
  const repairedTest = "// exact reconstructed repair test\n";
  await writeFile(join(fixture.layout.repairRoot, "src", "refund.ts"), repairedSource, "utf8");
  await writeFile(
    join(fixture.layout.repairRoot, "tests", "refund.test.mjs"),
    repairedTest,
    "utf8",
  );
  const receipt = reconstructVerificationWorkspace(fixture.layout);
  assert.deepEqual(receipt.copiedPaths, ["src/refund.ts", "tests/refund.test.mjs"]);
  assert.match(receipt.baselineContentSha256, /^[0-9a-f]{64}$/u);
  assert.match(receipt.repairOverlaySha256, /^[0-9a-f]{64}$/u);
  assert.match(receipt.verificationContentSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    await readFile(join(fixture.layout.verificationRoot, "src", "refund.ts"), "utf8"),
    repairedSource,
  );
  assert.equal(
    await readFile(
      join(fixture.layout.verificationRoot, "tests", "refund.test.mjs"),
      "utf8",
    ),
    repairedTest,
  );
});

test("worker runtime plan binds the admitted memory, PID, wall, CPU, and output limits", async (t) => {
  const fixture = await createRuntimeFixture();
  t.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  const limits = {
    wallTimeMs: 12_000,
    cpuTimeMs: 4_000,
    memoryBytes: 256 * 1024 * 1024,
    pids: 8,
    outputBytes: 1024 * 1024,
  };
  const plan = buildWorkerRuntimePlan({
    repositoryRoot: fixture.repositoryRoot,
    runId: fixture.runId,
    workerImage: `sha256:${DIGEST}`,
    verifierImage: `sha256:${DIGEST}`,
    workerNetwork: WORKER_NETWORK,
    ownershipNonce: OWNERSHIP_NONCE,
    requestSha256: REQUEST_SHA256,
    limits,
  });
  assert.equal(plan.worker.memoryBytes, limits.memoryBytes);
  assert.equal(plan.worker.memorySwapBytes, limits.memoryBytes);
  assert.equal(plan.worker.pidsLimit, limits.pids);
  assert.equal(plan.worker.wallTimeMs, limits.wallTimeMs);
  assert.equal(plan.worker.cpuTimeMs, limits.cpuTimeMs);
  assert.equal(plan.worker.outputBytes, limits.outputBytes);
  assert.equal(plan.worker.fileSizeLimitBytes, limits.outputBytes);
  assert.equal(plan.worker.logDriver, "local");
  assert.deepEqual(plan.worker.logOptions, {
    "max-size": String(limits.outputBytes),
    "max-file": "1",
  });
  assert.equal(plan.worker.cpuTimeEnforcement, "UNAVAILABLE_STATIC_DRIVER");
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--memory"), [String(limits.memoryBytes)]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--memory-swap"), [
    String(limits.memoryBytes),
  ]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--ulimit"), [
    `fsize=${limits.outputBytes}:${limits.outputBytes}`,
  ]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--log-driver"), ["local"]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--log-opt"), [
    `max-size=${limits.outputBytes}`,
    "max-file=1",
  ]);
  assert.deepEqual(optionValues(plan.worker.dockerArgs, "--pids-limit"), [String(limits.pids)]);
});

test("worker runtime plan rejects mutable images, path traversal, and incomplete layouts", async (t) => {
  const fixture = await createRuntimeFixture();
  t.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  assert.throws(
    () =>
      buildWorkerRuntimePlan({
        repositoryRoot: fixture.repositoryRoot,
        runId: fixture.runId,
        workerImage: "policytwin-worker:latest",
        verifierImage: `sha256:${DIGEST}`,
        workerNetwork: WORKER_NETWORK,
        ownershipNonce: OWNERSHIP_NONCE,
        requestSha256: REQUEST_SHA256,
        limits: LIMITS,
      }),
    /immutable/u,
  );
  assert.throws(
    () =>
      buildWorkerRuntimePlan({
        repositoryRoot: fixture.repositoryRoot,
        runId: fixture.runId,
        workerImage: `https://registry.invalid/policytwin-worker@sha256:${DIGEST}`,
        verifierImage: `sha256:${DIGEST}`,
        workerNetwork: WORKER_NETWORK,
        ownershipNonce: OWNERSHIP_NONCE,
        requestSha256: REQUEST_SHA256,
        limits: LIMITS,
      }),
    /immutable/u,
  );
  assert.throws(
    () => createWorkerRuntimeLayout({ repositoryRoot: fixture.repositoryRoot, runId: "../escape" }),
    /run ID/u,
  );
  await rm(fixture.layout.proxyTokenPath);
  assert.throws(
    () =>
      buildWorkerRuntimePlan({
        repositoryRoot: fixture.repositoryRoot,
        runId: fixture.runId,
        workerImage: `sha256:${DIGEST}`,
        verifierImage: `sha256:${DIGEST}`,
        workerNetwork: WORKER_NETWORK,
        ownershipNonce: OWNERSHIP_NONCE,
        requestSha256: REQUEST_SHA256,
        limits: LIMITS,
      }),
    /runtime layout/u,
  );
});

test("worker runtime plan rejects a symlinked managed run root", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "policytwin-worker-link-"));
  const outside = await mkdtemp(join(tmpdir(), "policytwin-worker-outside-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const runId = "run-link-12345678";
  const parent = join(repositoryRoot, ".tmp", "worker-runs");
  await mkdir(parent, { recursive: true });
  try {
    await symlink(outside, join(parent, runId), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("This Windows host does not permit a test junction.");
      return;
    }
    throw error;
  }
  assert.throws(
    () =>
      buildWorkerRuntimePlan({
        repositoryRoot,
        runId,
        workerImage: `sha256:${DIGEST}`,
        verifierImage: `sha256:${DIGEST}`,
        workerNetwork: WORKER_NETWORK,
        ownershipNonce: OWNERSHIP_NONCE,
        requestSha256: REQUEST_SHA256,
        limits: LIMITS,
      }),
    /runtime layout/u,
  );
});

test("verifier environment never inherits host credentials or proxies", () => {
  const environment = verifierEnvironment({
    HOME: "host-home",
    OPENAI_API_KEY: "must-not-pass",
    CODEX_HOME: "host-codex-home",
    HTTPS_PROXY: "https://proxy.invalid",
    PATH: "host-path",
  });
  assert.deepEqual(environment, {
    HOME: "/tmp",
    PATH: "/opt/policytwin/bin:/usr/local/bin:/usr/bin:/bin",
  });
});

test("supervisor Docker lifecycle uses explicit create/start/wait/remove and external proxy secrets", async (t) => {
  const fixture = await createRuntimeFixture();
  const secretRoot = await mkdtemp(join(tmpdir(), "policytwin-egress-secrets-"));
  t.after(() => rm(fixture.repositoryRoot, { recursive: true, force: true }));
  t.after(() => rm(secretRoot, { recursive: true, force: true }));
  const tlsCertificatePath = join(secretRoot, "server-cert.pem");
  const tlsPrivateKeyPath = join(secretRoot, "server-key.pem");
  const leasePath = join(secretRoot, "lease.json");
  const providerCredentialPath = join(secretRoot, "provider-token");
  const lease = createOpenAiEgressLease({
    runId: fixture.runId,
    token: PROXY_TOKEN,
    issuedAt: "2026-07-15T00:00:00.000Z",
    expiresAt: "2026-07-15T00:05:00.000Z",
    maxRequests: 16,
  });
  await writeFile(tlsCertificatePath, "certificate-material\n", "utf8");
  await writeFile(tlsPrivateKeyPath, "private-key-material\n", "utf8");
  await writeFile(leasePath, `${JSON.stringify(lease)}\n`, "utf8");
  await writeFile(providerCredentialPath, "provider-secret-material\n", "utf8");

  const plan = buildSupervisorDockerLifecyclePlan({
    repositoryRoot: fixture.repositoryRoot,
    runId: fixture.runId,
    workerImage: `sha256:${DIGEST}`,
    verifierImage: `sha256:${DIGEST}`,
    egressProxyImage: `sha256:${DIGEST}`,
    nativeHelperImage: `sha256:${DIGEST}`,
    nativeHelperBinarySha256: DIGEST,
    nativeHelperBuildInputSha256: DIGEST,
    nativeHelperSourceSha256: DIGEST,
    ownershipNonce: OWNERSHIP_NONCE,
    requestSha256: REQUEST_SHA256,
    limits: LIMITS,
    egressSecrets: {
      tlsCertificatePath,
      tlsPrivateKeyPath,
      leasePath,
      providerCredentialPath,
    },
  });
  assert.equal(plan.schemaVersion, "3");
  assert.equal(Object.isFrozen(plan), true);
  assertFactoryIssuedSupervisorDockerLifecyclePlan(plan);
  assert.throws(
    () => assertFactoryIssuedSupervisorDockerLifecyclePlan({ ...plan }),
    /sealed factory/u,
  );
  assert.throws(
    () => assertFactoryIssuedSupervisorDockerLifecyclePlan(plan.networks.worker),
    /sealed factory/u,
  );
  assert.equal(plan.status, "STATIC_PLAN_ONLY");
  assert.equal(plan.dynamicIsolationVerified, false);
  assert.equal(plan.liveCodexExecuted, false);
  assert.equal(plan.egress.createArgs[0], "create");
  assert.equal(plan.worker.createArgs[0], "create");
  assert.equal(plan.verifier.createArgs[0], "create");
  assert.equal(plan.egress.createArgs.includes("--rm"), false);
  assert.equal(plan.worker.createArgs.includes("--rm"), false);
  assert.equal(plan.verifier.createArgs.includes("--rm"), false);
  assert.equal(plan.egress.createArgs.includes("--publish"), false);
  assert.equal(plan.egress.createArgs.includes("--privileged"), false);
  assert.equal(plan.egress.createArgs.includes("--env"), false);
  assert.match(plan.workerNetwork, /^policytwin-worker-[0-9a-f]{32}$/u);
  assert.match(plan.outboundNetwork, /^policytwin-egress-[0-9a-f]{32}$/u);
  assert.notEqual(plan.workerNetwork, WORKER_NETWORK);
  assert.equal(plan.ownership.requestSha256, REQUEST_SHA256);
  assert.match(plan.ownership.bindingSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(plan.nativeHelper, {
    image: `sha256:${DIGEST}`,
    imagePath: "/policytwin-linux-cgroup-helper",
    binarySha256: DIGEST,
    buildInputSha256: DIGEST,
    sourceSha256: DIGEST,
  });
  assert.equal(Object.isFrozen(plan.nativeHelper), true);
  assert.equal(plan.networks.worker.operateByObservedId, true);
  assert.equal(plan.networks.outbound.operateByObservedId, true);
  assert.deepEqual(plan.egress.attachments, [
    { network: "outbound", aliases: [] },
    { network: "worker", aliases: ["policytwin-egress"] },
  ]);
  assert.deepEqual(plan.worker.attachments, [{ network: "worker", aliases: [] }]);
  assert.deepEqual(plan.verifier.attachments, []);
  assert.equal(plan.egress.operateByObservedId, true);
  assert.equal(plan.worker.operateByObservedId, true);
  assert.equal(plan.verifier.operateByObservedId, true);
  assert.deepEqual(
    [plan.egress.restartPolicy, plan.worker.restartPolicy, plan.verifier.restartPolicy],
    ["no", "no", "no"],
  );
  assert.deepEqual(optionValues(plan.egress.createArgs, "--restart"), ["no"]);
  assert.deepEqual(optionValues(plan.worker.createArgs, "--restart"), ["no"]);
  assert.deepEqual(optionValues(plan.verifier.createArgs, "--restart"), ["no"]);
  assert.deepEqual(optionValues(plan.egress.createArgs, "--network"), [
    OBSERVED_OUTBOUND_NETWORK_ID,
  ]);
  assert.deepEqual(optionValues(plan.worker.createArgs, "--network"), [
    OBSERVED_WORKER_NETWORK_ID,
  ]);
  assert.equal(plan.networks.worker.internal, true);
  assert.equal(plan.networks.outbound.internal, false);
  assert.equal(plan.networks.worker.createArgs.includes("--internal"), true);
  assert.equal(plan.networks.outbound.createArgs.includes("--internal"), false);
  assert.deepEqual(plan.executionOrder.slice(0, 9), [
    "ASSERT_RESOURCE_NAMES_ABSENT",
    "WORKER_NETWORK_CREATE",
    "OUTBOUND_NETWORK_CREATE",
    "NETWORKS_INSPECT_EMPTY",
    "EGRESS_CREATE_CAPTURE_ID",
    "EGRESS_CONNECT_OUTBOUND_BY_ID",
    "EGRESS_CONNECT_INTERNAL_BY_ID",
    "EGRESS_INSPECT_BY_ID",
    "EGRESS_START",
  ]);
  for (const required of [
    "EGRESS_IDENTITY_PIN",
    "EGRESS_IDENTITY_REOBSERVE_BEFORE_WORKER",
    "EGRESS_IDENTITY_REOBSERVE_AFTER_WORKER",
    "EGRESS_IDENTITY_REOBSERVE_BEFORE_STOP",
    "WORKER_STOPPED_IDENTITY_VERIFY_BEFORE_LOGS",
    "WORKER_STOPPED_IDENTITY_REOBSERVE_AFTER_LOGS",
    "EGRESS_STOPPED_IDENTITY_VERIFY_BEFORE_LOGS",
    "EGRESS_STOPPED_IDENTITY_REOBSERVE_AFTER_LOGS",
    "VERIFIER_STOPPED_IDENTITY_VERIFY_BEFORE_LOGS",
    "VERIFIER_STOPPED_IDENTITY_REOBSERVE_AFTER_LOGS",
  ]) {
    assert.equal(plan.executionOrder.includes(required), true);
  }
  assert.equal(
    plan.executionOrder.indexOf("WORKER_STOPPED_IDENTITY_VERIFY_BEFORE_LOGS") <
      plan.executionOrder.indexOf("WORKER_LOGS") &&
      plan.executionOrder.indexOf("WORKER_LOGS") <
        plan.executionOrder.indexOf("WORKER_STOPPED_IDENTITY_REOBSERVE_AFTER_LOGS"),
    true,
  );
  assert.equal(
    plan.executionOrder.indexOf("EGRESS_IDENTITY_REOBSERVE_AFTER_WORKER") <
      plan.executionOrder.indexOf("EGRESS_STOP"),
    true,
  );
  assert.equal(
    plan.executionOrder.indexOf("EGRESS_STOP") <
      plan.executionOrder.indexOf("VERIFIER_CREATE_CAPTURE_ID"),
    true,
  );
  assert.deepEqual(plan.cleanupOrder.slice(-6), [
    "OUTBOUND_NETWORK_REMOVE_BY_ID",
    "WORKER_NETWORK_REMOVE_BY_ID",
    "NETWORKS_INSPECT_ABSENT",
    "DELETE_VERIFICATION_WORKSPACE",
    "DELETE_REPAIR_WORKSPACE",
    "OBSERVE_ZERO_REMAINING_PROCESSES",
  ]);
  assert.equal(optionValues(plan.egress.createArgs, "--mount").length, 4);
  assert.equal(
    optionValues(plan.egress.createArgs, "--mount").every((mount) => mount.endsWith(",readonly")),
    true,
  );
  assert.equal("removeArgs" in plan.egress, false);
  assert.equal("stopArgs" in plan.worker, false);
  assert.doesNotMatch(JSON.stringify(plan), /provider-secret-material/u);

  const inRepositoryCredential = join(fixture.layout.runRoot, "provider-credential");
  await writeFile(inRepositoryCredential, "not-allowed-here\n", "utf8");
  assert.throws(
    () =>
      buildSupervisorDockerLifecyclePlan({
        repositoryRoot: fixture.repositoryRoot,
        runId: fixture.runId,
        workerImage: `sha256:${DIGEST}`,
        verifierImage: `sha256:${DIGEST}`,
        egressProxyImage: `sha256:${DIGEST}`,
        nativeHelperImage: `sha256:${DIGEST}`,
        nativeHelperBinarySha256: DIGEST,
        nativeHelperBuildInputSha256: DIGEST,
        nativeHelperSourceSha256: DIGEST,
        ownershipNonce: OWNERSHIP_NONCE,
        requestSha256: REQUEST_SHA256,
        limits: LIMITS,
        egressSecrets: {
          tlsCertificatePath,
          tlsPrivateKeyPath,
          leasePath,
          providerCredentialPath: inRepositoryCredential,
        },
      }),
    /outside the repository/u,
  );
});
