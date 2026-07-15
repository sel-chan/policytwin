import assert from "node:assert/strict";
import { cp, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { computeContainerBuildInput } from "../../scripts/container-build-inputs.mjs";
import { inspectStaticContainerContract } from "../../scripts/container-check.mjs";
import { inspectEgressContainerPrerequisites } from "../../scripts/egress-container-verify.mjs";
import {
  inspectWorkerContainerPrerequisites,
  prepareWorkerRunRoot,
  removeSafeWorkerRunRoot,
} from "../../scripts/worker-container-verify.mjs";

test("static web, worker, and verifier contracts remain non-live and fail closed", () => {
  const report = inspectStaticContainerContract();
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");
  assert.equal(report.scope, "STATIC_WEB_WORKER_VERIFIER_EGRESS_CONTAINERS");
  assert.equal(report.baseImagePinned, false);
  assert.equal(report.workerImagePinned, false);
  assert.equal(report.verifierImagePinned, false);
  assert.equal(report.egressProxyImagePinned, false);
  assert.equal(report.dynamicContainerVerified, false);
  assert.equal(report.webContainerIncludesLiveCodexWorker, false);
  assert.equal(report.workerContainerStatus, "STATIC_PREPARED");
  assert.equal(report.verifierContainerStatus, "STATIC_PREPARED");
  assert.equal(report.egressProxyStatus, "STATIC_PREPARED");
  assert.equal(report.releaseReady, false);
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

test("egress dynamic verification rejects missing base and build-input tampering before Docker", async () => {
  const contract = JSON.parse(await readFile(resolve("container-contract.json"), "utf8"));
  const report = inspectEgressContainerPrerequisites(contract);
  assert.equal(report.status, "FAIL");
  assert.deepEqual(report.failures, ["immutable Node base image is unset"]);
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
    ".dockerignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prompts",
    "src",
    "tsconfig.build.json",
    "tsconfig.json",
    "next.config.ts",
    "app/api/health/route.ts",
    "scripts/build-core.mjs",
    "scripts/process.mjs",
    "scripts/worker-preflight.mjs",
    "scripts/egress-tls-probe.mjs",
    "scripts/worker-entrypoint.mjs",
    "scripts/proxy-token-helper.mjs",
    "scripts/openai-egress-proxy.mjs",
    "scripts/verifier-preflight.mjs",
    "scripts/worker-container-verify.mjs",
    "scripts/egress-container-verify.mjs",
    "scripts/container-verify.mjs",
    "scripts/live-gate-contract.mjs",
    "scripts/pinned-docker-cli.mjs",
  ]) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(path), destination, { recursive: true });
  }
}

test("static container inspection detects weakened verifier networking and fixture bundling", async (t) => {
  const target = await mkdtemp(join(tmpdir(), "policytwin-container-contract-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await copyStaticContainerInputs(target);
  const contractPath = join(target, "container-contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  let report = inspectStaticContainerContract(target);
  assert.deepEqual(report.failures, []);
  assert.equal(report.status, "PASS");

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
