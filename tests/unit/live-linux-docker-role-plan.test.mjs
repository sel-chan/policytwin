import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSupervisorDockerArguments } from "../../dist/codex/docker-command-runner.js";
import {
  createPrivateLinuxStartBarrierController,
  destroyPrivateLinuxStartBarrierController,
  preparePrivateLinuxStartBarrierRole,
} from "../../dist/codex/linux-start-barrier.js";
import { createWorkerRuntimeLayout } from "../../dist/codex/worker-runtime-contract.js";
import { createOpenAiEgressLease } from "../../dist/codex/openai-egress-contract.js";
import { buildSupervisorDockerLifecyclePlan } from "../../dist/codex/egress-runtime-contract.js";
import {
  assertPrivateLiveLinuxBarrierDockerRolePlan,
  buildLiveLinuxBarrierDockerRolePlan,
} from "../../dist/codex/live-linux-docker-role-plan.js";

const digest = "c".repeat(64);
const proxyToken = Buffer.alloc(32, 17).toString("base64url");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "policytwin-live-role-plan-"));
  const secretRoot = await mkdtemp(join(tmpdir(), "policytwin-live-role-secrets-"));
  const runId = "run-live-role-12345678";
  const layout = createWorkerRuntimeLayout({ repositoryRoot: root, runId });
  const baselineRoot = join(root, "fixtures", "refund-demo", "baseline");
  for (const directory of [
    join(baselineRoot, "src"),
    join(baselineRoot, "tests"),
    join(layout.repairRoot, "src"),
    join(layout.repairRoot, "tests"),
    join(layout.verificationRoot, "src"),
    join(layout.verificationRoot, "tests"),
    join(layout.verificationRoot, "dist"),
  ]) {
    await mkdir(directory, { recursive: true });
  }
  for (const [path, body] of [
    [join(baselineRoot, "package.json"), "{}\n"],
    [join(baselineRoot, "tsconfig.json"), "{}\n"],
    [join(baselineRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(baselineRoot, "tests", "refund.test.mjs"), "// baseline\n"],
    [join(layout.repairRoot, "src", "refund.ts"), "export const repaired = true;\n"],
    [join(layout.repairRoot, "tests", "refund.test.mjs"), "// repaired\n"],
    [join(layout.verificationRoot, "package.json"), "{}\n"],
    [join(layout.verificationRoot, "tsconfig.json"), "{}\n"],
    [join(layout.verificationRoot, "src", "refund.ts"), "export const baseline = true;\n"],
    [join(layout.verificationRoot, "tests", "refund.test.mjs"), "// baseline\n"],
    [layout.requestPath, "{}\n"],
    [layout.responsePath, "\n"],
    [layout.proxyTokenPath, `${proxyToken}\n`],
    [layout.proxyCaPath, "test-ca\n"],
  ]) {
    await writeFile(path, body, "utf8");
  }
  const tlsCertificatePath = join(secretRoot, "server-cert.pem");
  const tlsPrivateKeyPath = join(secretRoot, "server-key.pem");
  const leasePath = join(secretRoot, "lease.json");
  const providerCredentialPath = join(secretRoot, "provider-token");
  const lease = createOpenAiEgressLease({
    runId,
    token: proxyToken,
    issuedAt: "2026-07-16T00:00:00.000Z",
    expiresAt: "2026-07-16T00:05:00.000Z",
    maxRequests: 16,
  });
  await writeFile(tlsCertificatePath, "certificate\n", "utf8");
  await writeFile(tlsPrivateKeyPath, "private-key\n", "utf8");
  await writeFile(leasePath, `${JSON.stringify(lease)}\n`, "utf8");
  await writeFile(providerCredentialPath, "provider-credential\n", "utf8");
  const lifecyclePlan = buildSupervisorDockerLifecyclePlan({
    repositoryRoot: root,
    runId,
    workerImage: `sha256:${digest}`,
    verifierImage: `sha256:${digest}`,
    egressProxyImage: `sha256:${digest}`,
    ownershipNonce: "b".repeat(32),
    requestSha256: "d".repeat(64),
    limits: {
      wallTimeMs: 60_000,
      cpuTimeMs: 30_000,
      memoryBytes: 268_435_456,
      pids: 32,
      outputBytes: 4_194_304,
    },
    egressSecrets: {
      tlsCertificatePath,
      tlsPrivateKeyPath,
      leasePath,
      providerCredentialPath,
    },
  });
  const barrier = await createPrivateLinuxStartBarrierController({
    rootDirectory: join(root, "barrier"),
    runBindingSha256: lifecyclePlan.ownership.bindingSha256,
    holdTimeoutMs: 5_000,
    pollIntervalMs: 5,
    randomBytes: () => Buffer.alloc(32, 7),
  });
  const prepared = await preparePrivateLinuxStartBarrierRole(barrier, "worker");
  return { barrier, prepared, lifecyclePlan, root, secretRoot };
}

function base(prepared, lifecyclePlan) {
  return {
    role: "worker",
    lifecyclePlan,
    observedNetworkIds: { worker: "e".repeat(64), outbound: "f".repeat(64) },
    preparedBarrier: prepared,
  };
}

test("live role plan fixes barrier entrypoint, exact environment, and RW/RO mounts", async () => {
  const { barrier, prepared, lifecyclePlan, root, secretRoot } = await fixture();
  try {
    const plan = buildLiveLinuxBarrierDockerRolePlan(
      barrier,
      base(prepared, lifecyclePlan),
    );
    assert.equal(plan.status, "PRIVATE_BARRIER_PLAN_NOT_RUNTIME_VERIFIED");
    assert.equal(plan.dynamicRuntimeVerified, false);
    assert.deepEqual(plan.entrypoint, ["node"]);
    assert.deepEqual(plan.commandArgs, [
      "scripts/role-start-barrier.mjs",
      "--",
      "node",
      "scripts/worker-entrypoint.mjs",
      "--validate-only",
    ]);
    assert.equal(plan.requiredEnvironment.POLICYTWIN_START_BARRIER_MODE, "REQUIRED_V1");
    assert.equal(plan.requiredEnvironment.NODE_OPTIONS, "");
    const receipt = plan.bindMounts.find((mount) => mount.destination.endsWith("/receipt"));
    const control = plan.bindMounts.find((mount) => mount.destination.endsWith("/control"));
    assert.equal(receipt.readOnly, false);
    assert.equal(control.readOnly, true);
    assertSupervisorDockerArguments(plan.createArgs);
    assertPrivateLiveLinuxBarrierDockerRolePlan(plan);
    assert.throws(
      () => assertPrivateLiveLinuxBarrierDockerRolePlan({ ...plan }),
      /private plan factory/u,
    );
  } finally {
    await destroyPrivateLinuxStartBarrierController(barrier);
    await rm(root, { recursive: true, force: true });
    await rm(secretRoot, { recursive: true, force: true });
  }
});

test("dedicated Docker validator rejects barrier target, environment, and mount tampering", async () => {
  const { barrier, prepared, lifecyclePlan, root, secretRoot } = await fixture();
  try {
    const plan = buildLiveLinuxBarrierDockerRolePlan(
      barrier,
      base(prepared, lifecyclePlan),
    );
    const targetTamper = [...plan.createArgs];
    targetTamper[targetTamper.indexOf("scripts/worker-entrypoint.mjs")] = "scripts/untrusted.mjs";
    assert.throws(() => assertSupervisorDockerArguments(targetTamper), /barrier invocation/u);

    const envTamper = [...plan.createArgs];
    const modeIndex = envTamper.indexOf("POLICYTWIN_START_BARRIER_MODE=REQUIRED_V1");
    envTamper[modeIndex] = "POLICYTWIN_START_BARRIER_MODE=OPTIONAL";
    assert.throws(() => assertSupervisorDockerArguments(envTamper), /barrier invocation/u);

    const mountTamper = [...plan.createArgs];
    const receiptIndex = mountTamper.findIndex((value) => value.includes("target=/run/policytwin-start-barrier/worker/receipt"));
    mountTamper[receiptIndex] = `${mountTamper[receiptIndex]},readonly`;
    assert.throws(() => assertSupervisorDockerArguments(mountTamper), /barrier invocation/u);

    for (const copiedLifecyclePlan of [
      {
        ...lifecyclePlan,
        worker: {
          ...lifecyclePlan.worker,
          mounts: lifecyclePlan.worker.mounts.map((mount, index) =>
            index === 0 ? { ...mount, source: "/etc" } : mount,
          ),
        },
      },
      {
        ...lifecyclePlan,
        worker: {
          ...lifecyclePlan.worker,
          environment: {
            ...lifecyclePlan.worker.environment,
            ["OPENAI" + "_API_KEY"]: "forbidden",
          },
        },
      },
      {
        ...lifecyclePlan,
        worker: { ...lifecyclePlan.worker, image: `sha256:${"9".repeat(64)}` },
      },
      {
        ...lifecyclePlan,
        networks: {
          ...lifecyclePlan.networks,
          worker: { ...lifecyclePlan.networks.worker, internal: false },
        },
      },
    ]) {
      assert.throws(
        () =>
          buildLiveLinuxBarrierDockerRolePlan(
            barrier,
            base(prepared, copiedLifecyclePlan),
          ),
        /sealed factory/u,
      );
    }
  } finally {
    await destroyPrivateLinuxStartBarrierController(barrier);
    await rm(root, { recursive: true, force: true });
    await rm(secretRoot, { recursive: true, force: true });
  }
});
