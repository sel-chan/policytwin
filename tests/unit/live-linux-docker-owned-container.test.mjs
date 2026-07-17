import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertPrivateLiveLinuxDockerOwner,
  createPrivateLiveLinuxDockerOwner,
} from "../../dist/codex/live-linux-docker-owned-container.js";

test("private Docker owner rejects an injected runner and copied capability", () => {
  const fakeRunner = { async run() { throw new Error("must not run"); } };
  assert.throws(
    () =>
      createPrivateLiveLinuxDockerOwner({
        runner: fakeRunner,
        lifecyclePlan: {},
        barrierController: {},
        preparedBarriers: {},
      }),
    /private CLI factory/u,
  );
  assert.throws(
    () => assertPrivateLiveLinuxDockerOwner({}),
    /private Linux Docker factory/u,
  );
});

test("Docker role authority is issued only after factory-owned create/start/inspect", async () => {
  const source = await readFile(
    new URL("../../src/codex/live-linux-docker-owned-container.ts", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "assertPrivateDockerCliCommandRunner(options.runner)",
    "assertFactoryIssuedSupervisorDockerLifecyclePlan(options.lifecyclePlan)",
    "parseDockerNetworkOwnershipInspection",
    "parseDockerNetworkInspection",
    "buildLiveLinuxBarrierDockerRolePlan",
    "createPrivateLiveLinuxOwnedDockerContainers",
    "startPrivateLiveLinuxOwnedDockerRoleHeld",
    "parseDockerContainerOwnershipInspection",
    "issuePrivateLiveLinuxOwnedDockerRole",
    "reobservePrivateLiveLinuxOwnedDockerRole",
    "consumePrivateLiveLinuxDockerHelperBindIdentity",
    "removePrivateLiveLinuxOwnedDockerRole",
    "removePrivateLiveLinuxOwnedDockerNetworks",
    "finalizePrivateLiveLinuxDockerCleanupReceipt",
  ]) {
    assert.ok(source.includes(marker), `missing private Docker ownership marker ${marker}`);
  }
  assert.equal(source.includes("options: {\n    role: LinuxCgroupHelperRole;\n    observation:"), false);
  assert.equal(source.includes("markPrivateLiveLinuxOwnedDockerRoleRemoved"), false);
  const ownerFactory = source.slice(
    source.indexOf("export function createPrivateLiveLinuxDockerOwner(options:"),
    source.indexOf("): PrivateLiveLinuxDockerOwner", source.indexOf("export function createPrivateLiveLinuxDockerOwner(options:")),
  );
  assert.equal(ownerFactory.includes("plans:"), false);
  assert.equal(ownerFactory.includes("runBindingSha256:"), false);
  assert.equal(ownerFactory.includes("observedNetworkIds:"), false);
});

test("lost or foreign create output enters exact-name owned recovery without deletion authority", async () => {
  const source = await readFile(
    new URL("../../src/codex/live-linux-docker-owned-container.ts", import.meta.url),
    "utf8",
  );
  const createStart = source.indexOf("resource.creationSideEffectUnresolved = true", source.indexOf("for (const role of ROLE_ORDER)"));
  const createEnd = source.indexOf("for (const network of plan.networks)", createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  const createBlock = source.slice(createStart, createEnd);
  const attemptedAt = createBlock.indexOf("const created = await mustRun(");
  const parsedAt = createBlock.indexOf("resource.id = parseCreatedDockerId");
  const ownershipAt = createBlock.indexOf("await verifyResourceOwnership(state, resource, signal)");
  const recoveryAt = createBlock.indexOf("await recoverFailedDockerCreation(");
  assert.ok(attemptedAt >= 0 && parsedAt > attemptedAt && ownershipAt > parsedAt && recoveryAt > ownershipAt);

  const recoveryStart = source.indexOf("async function recoverFailedDockerCreation(");
  const recoveryEnd = source.indexOf("export function createPrivateLiveLinuxDockerOwner", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recoveryBlock = source.slice(recoveryStart, recoveryEnd);
  for (const marker of [
    "resource.id = undefined",
    "resource.ownershipVerified = false",
    "resource.creationSideEffectUnresolved = true",
    "recovered = await idsForExactName",
    "recovered.length === 0",
    "recovered.length !== 1",
    "resource.id = recovered[0]!",
    "await verifyResourceOwnership(state, resource, signal)",
    "await removePrivateLiveLinuxOwnedDockerRole(owner, resource.role, signal)",
    "throw new AggregateError",
    "Docker container creation side effects remain unresolved after an empty exact-name observation.",
  ]) {
    assert.ok(recoveryBlock.includes(marker), `missing creation recovery marker ${marker}`);
  }
  assert.match(
    source,
    /if \(resource\.creationSideEffectUnresolved\)[\s\S]*const recovered = await idsForExactName[\s\S]*await verifyResourceOwnership/u,
  );
  assert.doesNotMatch(
    recoveryBlock,
    /if \(recovered\.length === 0\) \{\s*resource\.creationSideEffectUnresolved = false/u,
  );
  const removalStart = source.indexOf("export async function removePrivateLiveLinuxOwnedDockerRole(");
  const removalEnd = source.indexOf(
    "export function assertPrivateLiveLinuxDockerRemovalReceipt(",
    removalStart,
  );
  const removalBlock = source.slice(removalStart, removalEnd);
  assert.ok(removalBlock.indexOf("await assertAbsent(state, resource, signal)") > 0);
  assert.doesNotMatch(
    removalBlock,
    /if \(recovered\.length === 0\) \{\s*resource\.creationSideEffectUnresolved = false/u,
  );
});

test("owned networks precede role plans and have equivalent lost-create recovery", async () => {
  const source = await readFile(
    new URL("../../src/codex/live-linux-docker-owned-container.ts", import.meta.url),
    "utf8",
  );
  const networkCreate = source.indexOf("network.creationSideEffectUnresolved = true");
  const rolePlan = source.indexOf("const plans = Object.freeze({", networkCreate);
  const containerCreate = source.indexOf("resource.creationSideEffectUnresolved = true", rolePlan);
  assert.ok(networkCreate >= 0 && rolePlan > networkCreate && containerCreate > rolePlan);
  for (const marker of [
    "network.plan.createArgs",
    "parseDockerNetworkOwnershipInspection",
    "parseDockerNetworkInspection",
    "recoverFailedDockerNetworkCreation",
    "AbortSignal.timeout(CONTROL_TIMEOUT_MS)",
    "removePrivateLiveLinuxOwnedDockerNetworks",
    "await assertNetworkAbsent",
    "Docker network creation side effects remain unresolved after an empty exact-name observation.",
  ]) {
    assert.ok(source.includes(marker), `missing owned-network safety marker ${marker}`);
  }
  assert.match(
    source,
    /await removePrivateLiveLinuxOwnedDockerNetworks\(owner, signal\)[\s\S]*ALL_DOCKER_ROLE_ABSENCE_REOBSERVED_NOT_RUNTIME_VERIFIED/u,
  );
  const networkRecoveryStart = source.indexOf("async function recoverFailedDockerNetworkCreation(");
  const networkRecoveryEnd = source.indexOf(
    "async function verifyResourceOwnership(",
    networkRecoveryStart,
  );
  assert.doesNotMatch(
    source.slice(networkRecoveryStart, networkRecoveryEnd),
    /if \(recovered\.length === 0\) \{\s*resource\.creationSideEffectUnresolved = false/u,
  );
});
