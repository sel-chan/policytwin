import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertPrivateLinuxStartBarrierController,
  awaitPrivateLinuxStartBarrierHeld,
  createPrivateLinuxStartBarrierController,
  destroyPrivateLinuxStartBarrierController,
  preparePrivateLinuxStartBarrierRole,
  releasePrivateLinuxStartBarrierRole,
} from "../../dist/codex/linux-start-barrier.js";
import { awaitPolicyTwinRoleStartBarrier } from "../../scripts/role-start-barrier.mjs";

const RUN_BINDING_SHA256 = "7".repeat(64);

async function withController(callback, controllerOptions = {}) {
  const parent = await mkdtemp(join(tmpdir(), "policytwin-barrier-test-"));
  const rootDirectory = join(parent, "barriers");
  const controller = await createPrivateLinuxStartBarrierController({
    rootDirectory,
    runBindingSha256: RUN_BINDING_SHA256,
    holdTimeoutMs: 2_000,
    pollIntervalMs: 5,
    randomBytes: controllerOptions.randomBytes,
    testOnlyBeforeReleasePublish: controllerOptions.testOnlyBeforeReleasePublish,
  });
  try {
    await callback(controller);
  } finally {
    await destroyPrivateLinuxStartBarrierController(controller);
    await rm(parent, { recursive: true, force: true });
  }
}

test("host-owned one-shot barrier holds role code until an atomic control release", async () => {
  await withController(async (controller) => {
    const prepared = await preparePrivateLinuxStartBarrierRole(controller, "worker");
    assert.equal(prepared.status, "PREPARED_HELD_BARRIER");
    assert.equal(prepared.containerConfiguration.controlMount.readOnly, true);
    assert.equal(prepared.containerConfiguration.receiptMount.readOnly, false);
    assert.deepEqual(prepared.containerConfiguration.entrypointPrefix, [
      "node",
      "scripts/role-start-barrier.mjs",
      "--",
    ]);
    assert.equal(
      Object.hasOwn(prepared.containerConfiguration.environment, "POLICYTWIN_START_BARRIER_RELEASE"),
      false,
    );
    assert.equal(prepared.containerConfiguration.environment.NODE_OPTIONS, "");
    const heldPath = join(prepared.hostPaths.receiptDirectory, "held.json");
    const heldCommitPath = join(prepared.hostPaths.receiptDirectory, "held.commit.json");
    const [heldBefore, heldCommitBefore, receiptDirectoryBefore] = await Promise.all([
      lstat(heldPath, { bigint: true }),
      lstat(heldCommitPath, { bigint: true }),
      lstat(prepared.hostPaths.receiptDirectory, { bigint: true }),
    ]);
    assert.equal(heldBefore.size, 0n);
    assert.equal(heldCommitBefore.size, 0n);
    if (process.platform === "linux") {
      assert.equal(Number(heldBefore.mode) & 0o777, 0o622);
      assert.equal(Number(heldCommitBefore.mode) & 0o777, 0o622);
      assert.equal(Number(receiptDirectoryBefore.mode) & 0o222, 0);
      const controlDirectory = await lstat(prepared.hostPaths.controlDirectory, { bigint: true });
      assert.equal(Number(controlDirectory.mode) & 0o777, 0o711);
    }

    let roleExecuted = false;
    const roleWait = awaitPolicyTwinRoleStartBarrier({
      ...prepared.roleProtocol,
      receiptDirectory: prepared.hostPaths.receiptDirectory,
      controlDirectory: prepared.hostPaths.controlDirectory,
      holdTimeoutMs: 2_000,
      pollIntervalMs: 5,
    }).then((result) => {
      roleExecuted = true;
      return result;
    });

    const held = await awaitPrivateLinuxStartBarrierHeld(controller, prepared);
    assert.equal(held.status, "HELD_BEFORE_ROLE_EXECUTION");
    assert.equal(roleExecuted, false);
    const [heldAfter, heldCommitAfter] = await Promise.all([
      lstat(heldPath, { bigint: true }),
      lstat(heldCommitPath, { bigint: true }),
    ]);
    assert.equal(heldAfter.dev, heldBefore.dev);
    assert.equal(heldAfter.ino, heldBefore.ino);
    assert.equal(heldCommitAfter.dev, heldCommitBefore.dev);
    assert.equal(heldCommitAfter.ino, heldCommitBefore.ino);
    assert.ok(heldAfter.size > 0n);
    assert.ok(heldCommitAfter.size > 0n);
    if (process.platform === "linux") {
      assert.equal(Number(heldAfter.mode) & 0o777, 0o444);
      assert.equal(Number(heldCommitAfter.mode) & 0o777, 0o444);
    }

    const concurrentReleases = await Promise.allSettled([
      releasePrivateLinuxStartBarrierRole(controller, prepared),
      releasePrivateLinuxStartBarrierRole(controller, prepared),
    ]);
    assert.equal(
      concurrentReleases.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrentReleases.filter((result) => result.status === "rejected").length,
      1,
    );
    const rejectedRelease = concurrentReleases.find((result) => result.status === "rejected");
    assert.match(rejectedRelease.reason.message, /already in progress/u);
    const release = concurrentReleases.find((result) => result.status === "fulfilled").value;
    assert.equal(release.status, "RELEASED_BY_HOST_SUPERVISOR");
    const roleResult = await roleWait;
    assert.equal(roleResult.status, "ROLE_START_BARRIER_RELEASED");
    assert.equal(roleExecuted, true);
    assert.equal(Object.isFrozen(roleResult), true);

    const persistedRelease = JSON.parse(
      await readFile(join(prepared.hostPaths.controlDirectory, "release.json"), "utf8"),
    );
    assert.equal(persistedRelease.barrierId, prepared.roleProtocol.barrierId);
    assert.match(persistedRelease.releaseNonce, /^[A-Za-z0-9_-]{43}$/u);

    await assert.rejects(
      releasePrivateLinuxStartBarrierRole(controller, prepared),
      /already released/u,
    );
  });
});

test("a fake release in the receipt mount cannot self-release the barrier", async () => {
  await withController(async (controller) => {
    const prepared = await preparePrivateLinuxStartBarrierRole(controller, "verifier");
    const roleWait = awaitPolicyTwinRoleStartBarrier({
      ...prepared.roleProtocol,
      receiptDirectory: prepared.hostPaths.receiptDirectory,
      controlDirectory: prepared.hostPaths.controlDirectory,
      holdTimeoutMs: 150,
      pollIntervalMs: 5,
    });
    await awaitPrivateLinuxStartBarrierHeld(controller, prepared);
    try {
      await writeFile(
        join(prepared.hostPaths.receiptDirectory, "release.json"),
        '{"status":"RELEASED_BY_HOST_SUPERVISOR"}\n',
        "utf8",
      );
    } catch (error) {
      assert.match(error.code, /^(?:EACCES|EPERM)$/u);
    }
    await assert.rejects(roleWait, /timed out/u);
  });
});

test("a committed receipt hash mismatch fails before host release", async () => {
  await withController(async (controller) => {
    const prepared = await preparePrivateLinuxStartBarrierRole(controller, "worker");
    await writeFile(
      join(prepared.hostPaths.receiptDirectory, "held.json"),
      `${JSON.stringify({
        schemaVersion: "1",
        status: "HELD_BEFORE_ROLE_EXECUTION",
        role: "worker",
        barrierId: prepared.roleProtocol.barrierId,
        runBindingSha256: prepared.roleProtocol.runBindingSha256,
        namespacePid: 1,
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(prepared.hostPaths.receiptDirectory, "held.commit.json"),
      `${JSON.stringify({
        schemaVersion: "1",
        status: "HELD_RECEIPT_COMMITTED",
        receiptSha256: "0".repeat(64),
      })}\n`,
      "utf8",
    );
    await assert.rejects(
      awaitPrivateLinuxStartBarrierHeld(controller, prepared),
      /does not match its commit/u,
    );
  });
});

test("a prepublish release failure never exposes a release frame", async () => {
  await withController(
    async (controller) => {
      const prepared = await preparePrivateLinuxStartBarrierRole(controller, "verifier");
      const roleOutcome = awaitPolicyTwinRoleStartBarrier({
        ...prepared.roleProtocol,
        receiptDirectory: prepared.hostPaths.receiptDirectory,
        controlDirectory: prepared.hostPaths.controlDirectory,
        holdTimeoutMs: 150,
        pollIntervalMs: 5,
      }).then(
        () => new Error("The role unexpectedly passed its start barrier."),
        (error) => error,
      );
      await awaitPrivateLinuxStartBarrierHeld(controller, prepared);
      await assert.rejects(
        releasePrivateLinuxStartBarrierRole(controller, prepared),
        /simulated prepublish failure/u,
      );
      await assert.rejects(
        lstat(join(prepared.hostPaths.controlDirectory, "release.json")),
        /ENOENT/u,
      );
      assert.match((await roleOutcome).message, /timed out/u);
    },
    {
      testOnlyBeforeReleasePublish: () => {
        throw new Error("simulated prepublish failure");
      },
    },
  );
});

test("release nonce failure leaves the barrier failed rather than releasing", async () => {
  let randomCalls = 0;
  await withController(
    async (controller) => {
      const prepared = await preparePrivateLinuxStartBarrierRole(controller, "worker");
      const roleOutcome = awaitPolicyTwinRoleStartBarrier({
        ...prepared.roleProtocol,
        receiptDirectory: prepared.hostPaths.receiptDirectory,
        controlDirectory: prepared.hostPaths.controlDirectory,
        holdTimeoutMs: 150,
        pollIntervalMs: 5,
      }).then(
        () => new Error("The role unexpectedly passed its start barrier."),
        (error) => error,
      );
      await awaitPrivateLinuxStartBarrierHeld(controller, prepared);
      await assert.rejects(
        releasePrivateLinuxStartBarrierRole(controller, prepared),
        /random source returned an invalid value/u,
      );
      await assert.rejects(
        releasePrivateLinuxStartBarrierRole(controller, prepared),
        /must be observed as held/u,
      );
      assert.match((await roleOutcome).message, /timed out/u);
    },
    {
      randomBytes: (size) => {
        randomCalls += 1;
        return new Uint8Array(randomCalls === 2 ? size - 1 : size).fill(randomCalls);
      },
    },
  );
});

test("barrier authority rejects early release, copied handles, duplicate roles, and stale roots", async () => {
  await withController(async (controller) => {
    assert.doesNotThrow(() => assertPrivateLinuxStartBarrierController(controller));
    assert.throws(
      () => assertPrivateLinuxStartBarrierController({ ...controller }),
      /private start-barrier factory/u,
    );
    const prepared = await preparePrivateLinuxStartBarrierRole(controller, "egress");
    await assert.rejects(
      releasePrivateLinuxStartBarrierRole(controller, prepared),
      /must be observed as held/u,
    );
    await assert.rejects(
      preparePrivateLinuxStartBarrierRole(controller, "egress"),
      /already prepared/u,
    );
    await assert.rejects(
      awaitPrivateLinuxStartBarrierHeld(controller, { ...prepared }),
      /issued by this controller/u,
    );
  });

  const parent = await mkdtemp(join(tmpdir(), "policytwin-barrier-stale-"));
  const staleRoot = join(parent, "barriers");
  await writeFile(staleRoot, "stale", "utf8");
  await assert.rejects(
    createPrivateLinuxStartBarrierController({
      rootDirectory: staleRoot,
      runBindingSha256: RUN_BINDING_SHA256,
      holdTimeoutMs: 2_000,
      pollIntervalMs: 5,
    }),
    /fresh root/u,
  );
  await rm(parent, { recursive: true, force: true });
});
