import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildWorkerRuntimePlan,
  createWorkerRuntimeLayout,
  reconstructVerificationWorkspace,
  verifierEnvironment,
  WORKER_WRITABLE_PATHS,
} from "../../dist/codex/worker-runtime-contract.js";
import { createOpenAiEgressLease } from "../../dist/codex/openai-egress-contract.js";
import { buildSupervisorDockerLifecyclePlan } from "../../dist/codex/egress-runtime-contract.js";

const DIGEST = "a".repeat(64);
const PROXY_TOKEN = Buffer.alloc(32, 13).toString("base64url");

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
  });

  assert.deepEqual(WORKER_WRITABLE_PATHS, ["src/refund.ts", "tests/refund.test.mjs"]);
  assert.equal(plan.schemaVersion, "1");
  assert.equal(plan.status, "STATIC_PLAN_ONLY");
  assert.equal(plan.dynamicIsolationVerified, false);
  assert.equal(plan.liveCodexExecuted, false);
  assert.equal(plan.worker.network, "policytwin-worker-internal");
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
    egressSecrets: {
      tlsCertificatePath,
      tlsPrivateKeyPath,
      leasePath,
      providerCredentialPath,
    },
  });
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
  assert.deepEqual(plan.egressConnectInternalArgs.slice(0, 5), [
    "network",
    "connect",
    "--alias",
    "policytwin-egress",
    "policytwin-worker-internal",
  ]);
  assert.deepEqual(plan.networkInspectArgs, [
    ["network", "inspect", "policytwin-worker-internal"],
    ["network", "inspect", "policytwin-egress-outbound"],
  ]);
  assert.deepEqual(plan.executionOrder.slice(0, 7), [
    "EGRESS_CREATE",
    "EGRESS_CONNECT_INTERNAL",
    "EGRESS_START",
    "WORKER_CREATE",
    "WORKER_START",
    "WORKER_WAIT",
    "WORKER_LOGS",
  ]);
  assert.equal(
    plan.executionOrder.indexOf("EGRESS_STOP") < plan.executionOrder.indexOf("VERIFIER_CREATE"),
    true,
  );
  assert.deepEqual(plan.cleanupOrder.slice(-3), [
    "DELETE_VERIFICATION_WORKSPACE",
    "DELETE_REPAIR_WORKSPACE",
    "OBSERVE_ZERO_REMAINING_PROCESSES",
  ]);
  assert.equal(optionValues(plan.egress.createArgs, "--mount").length, 4);
  assert.equal(
    optionValues(plan.egress.createArgs, "--mount").every((mount) => mount.endsWith(",readonly")),
    true,
  );
  assert.deepEqual(plan.egress.removeArgs.slice(0, 2), ["rm", "--force"]);
  assert.deepEqual(plan.worker.stopArgs.slice(0, 3), ["stop", "--time", "5"]);
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
