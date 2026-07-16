import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES,
  assertPrivateLiveLinuxCgroupCpuAdapter,
  assertPrivateLiveLinuxCgroupCpuFinalizedEvidence,
  createPrivateLiveLinuxCgroupCpuAdapterScaffold,
  createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract,
} from "../../dist/codex/live-linux-cgroup-cpu-adapter.js";

const EXPECTED_SUCCESS_STAGES = [
  "REQUEST_VALIDATED",
  "PRIVATE_ADAPTER_ADMITTED",
  "OWNED_CONTAINERS_CREATED",
  "EGRESS_START_BARRIER_HELD",
  "EGRESS_CGROUP_BOUND",
  "EGRESS_BASELINE_RECORDED",
  "EGRESS_START_BARRIER_RELEASED",
  "WORKER_START_BARRIER_HELD",
  "WORKER_CGROUP_BOUND",
  "WORKER_BASELINE_RECORDED",
  "WORKER_START_BARRIER_RELEASED",
  "WORKER_EXECUTION_OBSERVED",
  "WORKER_STOPPED_OR_CONTAINED",
  "WORKER_DOCKER_RELEASED",
  "WORKER_CGROUP_RELEASED",
  "EGRESS_STOPPED_OR_CONTAINED",
  "EGRESS_DOCKER_RELEASED",
  "EGRESS_CGROUP_RELEASED",
  "VERIFIER_START_BARRIER_HELD",
  "VERIFIER_CGROUP_BOUND",
  "VERIFIER_BASELINE_RECORDED",
  "VERIFIER_START_BARRIER_RELEASED",
  "VERIFIER_EXECUTION_OBSERVED",
  "VERIFIER_STOPPED_OR_CONTAINED",
  "VERIFIER_DOCKER_RELEASED",
  "VERIFIER_CGROUP_RELEASED",
  "CONTROLLER_STOPPED",
  "EVIDENCE_FINALIZED",
];

test("private adapter scaffold snapshots its options once and cannot make live claims", () => {
  let cleanupTimeoutReads = 0;
  const options = {
    get cleanupTimeoutMs() {
      cleanupTimeoutReads += 1;
      return 30_000;
    },
  };
  const adapter = createPrivateLiveLinuxCgroupCpuAdapterScaffold(options);

  assert.equal(cleanupTimeoutReads, 1);
  assert.deepEqual(adapter, {
    schemaVersion: "1",
    status: "PRIVATE_CAPABILITY_SCAFFOLD_ONLY",
    runtimeAvailable: false,
    liveEvidenceIssuanceEnabled: false,
    passSigningEligible: false,
    cleanupTimeoutMs: 30_000,
    requiredClock: "CLOCK_MONOTONIC_RAW_NS",
    roles: ["egress", "worker", "verifier"],
  });
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(adapter.roles), true);
  assert.doesNotThrow(() => assertPrivateLiveLinuxCgroupCpuAdapter(adapter));
  assert.throws(
    () => Object.defineProperty(adapter, "runtimeAvailable", { value: true }),
    TypeError,
  );
});

test("private adapter admission rejects structural lookalikes and copies", () => {
  const adapter = createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs: 30_000 });
  const candidates = [
    {},
    { ...adapter },
    { adapter },
    Object.create(adapter),
    Object.create(Object.getPrototypeOf(adapter), Object.getOwnPropertyDescriptors(adapter)),
    JSON.parse(JSON.stringify(adapter)),
  ];

  for (const candidate of candidates) {
    assert.throws(
      () => assertPrivateLiveLinuxCgroupCpuAdapter(candidate),
      /private real-Linux adapter factory/u,
    );
  }
});

test("dedicated lifecycle contract fixes barrier-before-baseline and finalize-after-cleanup order", () => {
  const adapter = createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs: 30_000 });
  const contract = createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract(adapter);

  assert.deepEqual(LIVE_LINUX_CGROUP_CPU_DEDICATED_SUCCESS_STAGES, EXPECTED_SUCCESS_STAGES);
  assert.deepEqual(contract.successStages, EXPECTED_SUCCESS_STAGES);
  assert.equal(contract.status, "DEDICATED_LIFECYCLE_CONTRACT_ONLY");
  assert.equal(contract.runtimeImplemented, false);
  assert.equal(contract.startBarrierImplemented, false);
  assert.equal(contract.startBarrierProtocolImplemented, true);
  assert.equal(contract.startBarrierHostOwnedReceiptSlotsImplemented, true);
  assert.equal(contract.startBarrierReceiptCommitBindingImplemented, true);
  assert.equal(contract.startBarrierConcurrentReleaseGuardImplemented, true);
  assert.equal(contract.nonPrivilegedLifecycleHarnessImplemented, true);
  assert.equal(contract.nativeHelperBoundaryPrepared, true);
  assert.equal(contract.nativeHelperBuildVerified, false);
  assert.equal(contract.nativeHelperRuntimeVerified, false);
  assert.equal(contract.finalizedEvidenceIssuanceImplemented, false);
  assert.equal(contract.liveEvidenceIssuanceEnabled, false);
  assert.equal(contract.passSigningEligible, false);
  assert.equal(contract.cleanupTimeoutMs, 30_000);
  assert.equal(contract.independentCleanupSignalRequired, true);
  assert.equal(contract.serialPollingRequired, true);
  assert.equal(contract.identityRevalidationEverySampleRequired, true);
  assert.equal(contract.cleanupFailureSticky, true);
  assert.equal(contract.finalizeAfterCleanupRequired, true);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.successStages), true);

  for (const role of ["EGRESS", "WORKER", "VERIFIER"]) {
    const held = contract.successStages.indexOf(`${role}_START_BARRIER_HELD`);
    const bound = contract.successStages.indexOf(`${role}_CGROUP_BOUND`);
    const baseline = contract.successStages.indexOf(`${role}_BASELINE_RECORDED`);
    const released = contract.successStages.indexOf(`${role}_START_BARRIER_RELEASED`);
    assert.ok(held < bound && bound < baseline && baseline < released);
  }
  assert.ok(
    contract.successStages.indexOf("VERIFIER_CGROUP_RELEASED") <
      contract.successStages.indexOf("CONTROLLER_STOPPED"),
  );
  assert.ok(
    contract.successStages.indexOf("CONTROLLER_STOPPED") <
      contract.successStages.indexOf("EVIDENCE_FINALIZED"),
  );
});

test("no current raw, synthetic, non-live, or wrapped value is finalized-evidence authority", () => {
  const adapter = createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs: 30_000 });
  const lifecycle = createPrivateLiveLinuxCgroupCpuDedicatedLifecycleContract(adapter);
  const candidates = [
    adapter,
    lifecycle,
    { outcome: "OBSERVED_WITHIN_BUDGET", cpuEvidenceSha256: "a".repeat(64) },
    {
      schemaVersion: "1",
      status: "UNSIGNED_CPU_EVIDENCE_V2_CANDIDATE",
      sourceProvenance: "SYNTHETIC_CONTRACT",
      liveClaim: false,
      passSigningEligible: false,
      evidence: {},
    },
    {
      schemaVersion: "2",
      mode: "NON_LIVE_DYNAMIC_GATE_ONLY",
      initialCpuUsageUsec: "0",
    },
    { finalizedEvidence: {} },
  ];

  for (const candidate of candidates) {
    assert.throws(
      () => assertPrivateLiveLinuxCgroupCpuFinalizedEvidence(candidate),
      /finalized by the private real-Linux lifecycle/u,
    );
  }
});

test("adapter scaffold remains internal and exposes no registrar or package subpath", async () => {
  const [rootSource, adapterSource, packageSource] = await Promise.all([
    readFile(new URL("../../src/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/codex/live-linux-cgroup-cpu-adapter.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(rootSource.includes("live-linux-cgroup-cpu-adapter"), false);
  assert.deepEqual(Object.keys(packageJson.exports), ["."]);
  assert.equal(/export\s+function\s+register/iu.test(adapterSource), false);
  assert.equal(adapterSource.includes("finalizedEvidenceCapabilities.add"), false);
  await assert.rejects(
    import("policytwin/dist/codex/live-linux-cgroup-cpu-adapter.js"),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});

for (const value of [999, 60_001, 1.5, Number.NaN]) {
  test(`adapter scaffold rejects cleanup timeout ${String(value)}`, () => {
    assert.throws(
      () => createPrivateLiveLinuxCgroupCpuAdapterScaffold({ cleanupTimeoutMs: value }),
      /cleanup timeout/u,
    );
  });
}
