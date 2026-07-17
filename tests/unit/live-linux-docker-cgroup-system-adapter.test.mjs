import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPrivateLiveLinuxDockerCgroupSystemAdapter } from "../../dist/codex/live-linux-docker-cgroup-system-adapter.js";

test("private Docker/cgroup adapter rejects copied objects and preserves the non-live boundary", async () => {
  assert.throws(
    () => assertPrivateLiveLinuxDockerCgroupSystemAdapter({}),
    /active private capability/u,
  );
  const source = await readFile(
    new URL("../../src/codex/live-linux-docker-cgroup-system-adapter.ts", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "startPrivateLiveLinuxOwnedDockerRoleHeld",
    "assertPrivateLiveLinuxDockerOwnerBarrierConfiguration",
    "awaitPrivateLinuxStartBarrierHeld",
    "reobservePrivateLiveLinuxOwnedDockerRole",
    "bindPrivateLinuxCgroupHelperRole",
    "releasePrivateLinuxStartBarrierRole",
    "freezePrivateLinuxCgroupHelperRole",
    "killPrivateLinuxCgroupHelperRole",
    "readQuiescentPrivateLinuxCgroupHelperRole",
    "removePrivateLiveLinuxOwnedDockerRole",
    "removePrivateLiveLinuxOwnedDockerNetworks",
    "releasePrivateLinuxCgroupHelperRole",
    "finalizePrivateLiveLinuxDockerCleanupReceipt",
    "options.owner.nativeHelperBinarySha256 !== options.helperClient.helperSha256",
  ]) {
    assert.ok(source.includes(marker), `missing private system-adapter marker ${marker}`);
  }
  for (const marker of [
    "dynamicRuntimeVerified: false",
    "finalizedEvidenceIssued: false",
    "passSigningEligible: false",
  ]) {
    assert.ok(source.includes(marker), `missing fail-closed adapter marker ${marker}`);
  }
});
